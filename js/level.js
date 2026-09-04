// level.js — level data, tilemap loading, spawn points, rendering

const Level = (() => {
  const TILE = {
    EMPTY: 0,
    GROUND: 1,
    PLATFORM: 2,
    // Stone that will not take your weight twice. Solid until somebody stands
    // on it, gone a moment later, back a moment after that — so it is ground
    // for the purpose of getting somewhere and never ground for the purpose of
    // standing about.
    CRUMBLE: 3,
    DOOR: 4,
    LAVA: 5,
  };

  // The movement envelope the generator promises never to exceed. Levels are
  // traversable by construction, not by generate-then-test-then-retry.
  const RULES = {
    // Measured from the physics, not guessed: how far the body travels while
    // still R tiles above the height it jumped from. envelope-test asserts the
    // player can actually do this; generation never exceeds it.
    reach: [5, 4, 4, 3],
    maxGap: 4,
    maxStepUp: 3,
    maxWallClimb: 9, // with a face to bounce off, a climb can be far taller
    maxStepDown: 4,
    landing: 3,
    runUp: 3,
  };

  // Deep, because the route is dug through it rather than laid on top of it.
  const HEIGHT = 72;
  const METERS_PER_TILE = 1;

  // The run is the goal: cross this far to the right and reach the door.
  const MODES = [
    { id: "500m", label: "500 m", meters: 500 },
    { id: "1k", label: "1000 m", meters: 1000 },
    { id: "2k", label: "2 km", meters: 2000 },
    { id: "5k", label: "5 km", meters: 5000 },
  ];

  // Lengths the menu used to offer and does not any more. Nothing generates one
  // and no chip picks one, so they are not playable — but a run history outlives
  // the menu that made it, and a 10 km run somebody finished has to keep saying
  // 10 km rather than being relabelled as whatever now sits first in the list.
  const RETIRED = [
    { id: "10k", label: "10 km", meters: 10000 },
  ];

  function checksum(tiles) {
    let h = 0x811c9dc5;
    for (let i = 0; i < tiles.length; i++) {
      h ^= tiles[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  function resolveMode(id) {
    return (
      MODES.find((mode) => mode.id === id) ||
      RETIRED.find((mode) => mode.id === id) ||
      MODES[0]
    );
  }

  // ---------------------------------------------------------------- carving
  //
  // The world starts as one solid block and the maze is dug out of it. Nothing
  // is "the surface": every passage has rock above it as well as below, so the
  // only way to learn what is around a corner or at the bottom of a drop is to
  // pan the camera and look. That is the whole point of the free camera.
  //
  // The shape is a graph, not a line. Cells of a coarse grid become junctions —
  // pockets a few tiles across where passages meet, not halls; a randomised
  // depth-first spanning tree links them, which is what guarantees every one
  // connects to every other; extra links are laid on top of the tree to close
  // loops back into junctions already visited; and any junction still left with
  // a single link is given a second, so the network forks rather than ends.
  //
  // None of that can strand you. A branch you can walk into is one you can walk
  // back out of: horizontal passages never step more than a tile at a time and
  // every vertical link carries rungs, so down is never a one-way trip. verify()
  // then proves it independently rather than taking my word for it.

  const ROOF = 5; // never carve higher than this
  const HEADROOM = 3; // clear rows above a walking floor: room to move, not to stand tall in
  const LEDGE_RISE = 3; // rung spacing — one plain jump
  const CHIMNEY_RISE = 8; // resting points in a chimney, inside one wall climb
  const CELL_W = 26;
  const CELL_H = 14;
  const BAND_TOP = 7; // first row the grid may use
  const SHAFT_W = 3;
  const LOOP_CHANCE = 0.38; // links added beyond the spanning tree
  const CRUST = 2; // rows of rock that must sit under a pool of lava
  const CRAWL = 2; // a crawlway: room to walk, none to jump
  const CRAWL_CHANCE = 0.4;
  const DUCT = 1; // a slit through the rock: no room to be anything but sliding
  const DUCT_CHANCE = 0.3;

  // Carving costs a fraction of a millisecond and the audit little more, so an
  // unlucky layout is recarved from the next stream rather than special-cased.
  // The attempt number is part of the stream name, so a seed still produces the
  // same map every time — it just may not be the first one that was tried.
  function generate(seedText, options = {}) {
    // One seed is not a seed. TUTORIAL is a level someone wrote.
    if (String(seedText).trim().toUpperCase() === "TUTORIAL") return createTutorial();

    const seed = Rng.keyFor(seedText);
    const mode = resolveMode(options.mode);
    const width = Math.max(120, options.width || Math.round(mode.meters / METERS_PER_TILE));

    // One hash lands on a fault, and the carver steps around it.
    if (Rng.numberFor(seedText) === FAULT_HASH) {
      return carveFaultFormation(seed);
    }

    let level = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      level = carveLevel(seed, mode, width, attempt);
      level.attempt = attempt;
      if (verify(level).ok) return level;
    }
    return level;
  }

  function carveLevel(seed, mode, width, attempt) {
    const height = HEIGHT;
    const rng = Rng.forSeed(seed, "maze/" + attempt);
    const detail = Rng.forSeed(seed, "detail/" + attempt);

    const tiles = new Uint8Array(width * height).fill(TILE.GROUND);
    const places = [];
    const shafts = []; // columns a hazard must keep out of
    const crawls = []; // low stretches, checked afterwards for anything unjumpable

    const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
    const put = (x, y, tile) => {
      if (inside(x, y)) tiles[y * width + x] = tile;
    };
    const peek = (x, y) => (inside(x, y) ? tiles[y * width + x] : TILE.GROUND);
    const dig = (x, y) => {
      if (inside(x, y)) tiles[y * width + x] = TILE.EMPTY;
    };
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    const CEIL_LIMIT = ROOF + HEADROOM + 1;
    const FLOOR_LIMIT = height - 8;

    // ------------------------------------------------------------- the grid
    const cols = Math.max(4, Math.floor((width - 12) / CELL_W));
    const rows = Math.max(3, Math.floor((height - BAND_TOP - 8) / CELL_H));
    const count = cols * rows;
    const colOf = (i) => i % cols;
    const rowOf = (i) => (i / cols) | 0;

    // A junction per cell rather than a room: one column and one floor height.
    // The column is fixed so the shafts between rows run true; the height is
    // its own so the tunnels between columns have somewhere to wander to.
    const rooms = [];
    for (let i = 0; i < count; i++) {
      const c = colOf(i);
      const r = rowOf(i);
      const cellY = BAND_TOP + r * CELL_H;
      rooms.push({
        index: i,
        c,
        r,
        x: c === 0 ? 8 : c === cols - 1 ? width - 8 : 6 + c * CELL_W + (CELL_W >> 1),
        floorY: clamp(cellY + CELL_H - 3 + rng.int(-1, 1), CEIL_LIMIT + 2, FLOOR_LIMIT),
      });
    }

    // ------------------------------------------------------------- the maze
    // Randomised depth-first search: every cell ends up on the tree, so every
    // room is reachable from every other before a single extra link is added.
    const linked = new Set();
    const key = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
    const neighbours = (i) => {
      const c = colOf(i);
      const r = rowOf(i);
      const list = [];
      if (c > 0) list.push(i - 1);
      if (c < cols - 1) list.push(i + 1);
      if (r > 0) list.push(i - cols);
      if (r < rows - 1) list.push(i + cols);
      return list;
    };

    const startCell = rng.int(0, rows - 1) * cols;
    const endCell = rng.int(0, rows - 1) * cols + (cols - 1);

    const visited = new Uint8Array(count);
    const stack = [startCell];
    visited[startCell] = 1;
    while (stack.length) {
      const here = stack[stack.length - 1];
      const open = neighbours(here).filter((n) => !visited[n]);
      if (!open.length) {
        stack.pop();
        continue;
      }
      const next = open[rng.int(0, open.length - 1)];
      linked.add(key(here, next));
      visited[next] = 1;
      stack.push(next);
    }

    // The loops. A tree alone is a maze with exactly one way between any two
    // junctions; these are the links that let a passage come back around into
    // somewhere already seen instead of only ever pushing further in.
    let loops = 0;
    for (let i = 0; i < count; i++) {
      for (const n of neighbours(i)) {
        if (n < i || linked.has(key(i, n))) continue;
        if (!rng.chance(LOOP_CHANCE)) continue;
        linked.add(key(i, n));
        loops++;
      }
    }

    // And then no dead ends at all. Loops alone do not manage it: a spanning
    // tree has leaves, and a leaf that no loop happened to pick up is a junction
    // with one way in and the same way out. Every junction left with a single
    // link gets a second, so the whole network forks rather than terminates.
    // The run starts and finishes standing on a floor, so both ends need a
    // passage that runs along one. A junction joined only by shafts is a hole
    // in the ground with no ledge beside it to be standing on.
    if (cols > 1) {
      linked.add(key(startCell, startCell + 1));
      linked.add(key(endCell, endCell - 1));
    }

    const degree = new Uint16Array(count);
    for (const k of linked) {
      const parts = k.split("|");
      degree[Number(parts[0])]++;
      degree[Number(parts[1])]++;
    }
    for (let i = 0; i < count; i++) {
      if (degree[i] > 1) continue;
      const spare = neighbours(i).filter((n) => !linked.has(key(i, n)));
      if (!spare.length) continue;
      const n = spare[rng.int(0, spare.length - 1)];
      linked.add(key(i, n));
      degree[i]++;
      degree[n]++;
      loops++;
    }

    // --------------------------------------------------------- the carving
    //
    // A junction is a pocket, not a hall: seven columns and three or four rows,
    // which is a widening in a passage rather than a room you stand in the
    // middle of. The vaults are gone — twenty columns of open floor is a place
    // you can see all of at once, which is the opposite of a cave.
    //
    // It cannot go to nothing, though, and that is measured rather than
    // assumed. Carving no pocket at all — junctions as bare points where
    // passages meet — reads well and does not survive: 5 km falls to four
    // levels beatable in twelve and 10 km to one in ten. The pocket is what
    // absorbs the mismatch between a shaft dropping in and a tunnel leaving at
    // a slightly different height. Without somewhere for those to meet, every
    // junction is a joint that has to line up exactly, and at ten thousand
    // tiles enough of them do not.
    function carveJunction(node) {
      const tall = rng.int(3, 4);
      const x0 = node.x - 3;
      const x1 = node.x + 3;
      for (let x = x0; x <= x1; x++) {
        for (let y = node.floorY - tall; y < node.floorY; y++) dig(x, y);
      }
      places.push({ type: "chamber", x0, x1, floorY: node.floorY, top: node.floorY - tall });
    }

    // A winding passage. It never rises or drops more than one row per column,
    // so every step of it is a plain walk; the wander is what makes it an S
    // rather than a line. Where it crosses something already dug, the floor it
    // needs is laid as a one-way platform instead of rock, so the passage
    // underneath stays open and the crossing becomes a junction.
    // Some stretches come out as crawlways: CRAWL rows instead of HEADROOM,
    // which is room to walk and none at all to jump. That has a consequence
    // worth spelling out, because it is easy to build a wall by accident —
    // inside one, a single tile step up is impassable. Everywhere else a step
    // that size is a hop nobody thinks about. So a crawlway runs dead flat, and
    // crawl repair afterwards opens out any that did not stay that way.
    function tunnel(fromX, fromY, toX, toY, wander, head = HEADROOM) {
      const step = fromX <= toX ? 1 : -1;
      const span = Math.abs(toX - fromX) + 1;
      const low = head < HEADROOM; // a crawlway: flat the whole way, by force
      let y = fromY;
      let want = fromY;
      let segX = fromX;
      let segY = fromY;
      let segHead = head;
      let tread = 0; // columns to hold the floor flat before the next step
      let stone = 0; // tiles of rock still to lay across a crossing
      let bridge = 0; // tiles of plank still to lay over a narrow one
      let gap = 0; // tiles of nothing still to leave

      const closeSegment = (x) => {
        if (Math.abs(x - segX) >= 6) {
          const seg = {
            type: "corridor",
            x0: Math.min(segX, x),
            x1: Math.max(segX, x),
            floorY: segY,
            head: segHead,
          };
          places.push(seg);
          if (segHead < HEADROOM) crawls.push(seg);
        }
        segX = x;
      };

      for (let i = 0; i < span; i++) {
        const x = fromX + i * step;
        const left = span - i;

        if (!low) {
          // Hold the line home: once only just enough columns remain to close
          // the gap a row at a time, stop wandering and converge.
          const closing = left <= Math.abs(y - toY) + 2;
          if (closing) {
            want = toY;
          } else if (i % 5 === 0) {
            const base = fromY + Math.round((toY - fromY) * (i / Math.max(1, span - 1)));
            want = clamp(base + rng.int(-wander, wander), CEIL_LIMIT, FLOOR_LIMIT);
          }

          // Terraces rather than a staircase. Stepping every column turns a
          // change of height into a diagonal, which is the one shape rock never
          // makes; holding the floor flat for a few columns between steps gives
          // it landings, and a landing is somewhere to stand and look.
          //
          // Not while closing, though: converging needs a row a column, and a
          // tunnel that terraces on the way home does not arrive.
          if (tread > 0 && !closing) {
            tread--;
          } else if (y !== want) {
            y += y < want ? 1 : -1;
            tread = closing ? 0 : rng.int(2, 4);
          }
        }

        if (y !== segY) {
          closeSegment(x);
          segY = y;
        }

        for (let cy = y - head; cy < y; cy++) dig(x, cy);

        // Underfoot. Through rock there is already a floor and nothing to do.
        // Across something already open there is a choice, and the obvious one
        // is wrong: a one-way platform laid the whole way over reads as a wire
        // strung across the room, and a hundred of them read as scaffolding.
        // Stones instead — two tiles of rock, a gap short enough to jump, two
        // more — so a high route crossing a chamber is stepping stones over it
        // rather than a floor through the middle of it.
        if (peek(x, y) === TILE.GROUND) {
          stone = 0;
          gap = 0;
          bridge = 0;
        } else {
          if (stone === 0 && gap === 0 && bridge === 0) {
            // How far does the hole go? A shaft is three wide and a corridor
            // four, and those are left open: a gap that size is a jump, and
            // flooring one with rock would seal the shaft under it and take
            // away the only way up out of it. Anything wider is a chamber, and
            // a chamber gets stones to cross on.
            let across = 0;
            while (across < 48 && peek(x + across * step, y) !== TILE.GROUND) across++;
            if (across <= 4) bridge = across;
            else stone = 2; // the first step off the edge is always solid
          }

          if (bridge > 0) {
            bridge--; // open air, and a jump across it
          } else if (stone > 0) {
            put(x, y, TILE.GROUND);
            stone--;
            if (stone === 0) gap = 3;
          } else {
            gap--;
            if (gap === 0) stone = 2;
          }
        }
      }

      closeSegment(toX);
      return y;
    }

    // Vertical link. Going down needs nothing; going up needs rungs, spaced so
    // every step of the climb is a plain jump. They are two tiles wide inside a
    // three wide shaft, so there is always a gap left to drop back through.
    //
    // The rungs are worked out here but laid at the very end. Anything dug
    // afterwards — a passage crossing the shaft, a pocket sunk beside it —
    // would otherwise erase the bottom of the ladder and leave a drop with no
    // way back up, which is the one thing this generator must never build.
    function shaft(x, w, fromY, toY) {
      const top = Math.min(fromY, toY);
      const bottom = Math.max(fromY, toY);
      for (let cx = x; cx < x + w; cx++) {
        for (let y = top - HEADROOM; y < bottom; y++) dig(cx, y);
      }

      // Where the rungs go is not decided here. It depends on which walls this
      // shaft still has, and a stub dug later can take one away — so the shaft
      // is only recorded, and the ladder is worked out at the end against the
      // rock as it finally stands.
      shafts.push({ x0: x, x1: x + w - 1, x, w, top, bottom });
      places.push({ type: "shaft", x0: x, x1: x + w - 1, fromY, toY });
    }

    // ----------------------------------------------------------- blind drops
    //
    // The tutorial's third chamber, made procedural. A link between an upper
    // room and a lower one is carved as a hole in the upper floor with fire let
    // into the lower one, and a single shelf to land on. You cannot see any of
    // it from the lip; the only way to know which side to aim for is to point
    // the camera down the hole, which is what the free camera is for and what
    // nothing else in a generated cave insists on.
    //
    // It replaces a vertical link rather than being punched in afterwards, and
    // that is not a preference. Two earlier versions looked for somewhere under
    // a corridor to put one and never found anywhere at all: rooms are fourteen
    // rows apart and their neighbours' passages wander through everything in
    // between, so a corridor with a clear fourteen rows beneath it does not
    // exist. A vertical link already has the drop — that is what it is — and it
    // already goes somewhere at both ends.
    //
    // Five columns wide, which is what the room allows rather than what would
    // be nice. A junction pocket is seven, and the lips have to be pocket floor
    // or there is nothing to walk off; five leaves exactly one column of floor
    // either side.
    // Converted from a shaft that has already been carved, rather than carved
    // instead of one, and that ordering is load-bearing. A room with a link
    // going further down gets a second shaft dug from its own floor downwards —
    // straight through the rows this wants for its lava. Doing the conversion
    // once every link exists means the bed can be checked against the cave as
    // it finally stands instead of as it stood halfway through.
    const BLIND_WIDE = 5;

    function blindShaft(s) {
      const { top, bottom } = s;
      // The shaft sits one column left of the room's centre, so this is the
      // pocket's seven columns less one of floor at each end.
      const p0 = s.x - 1;
      const W = BLIND_WIDE;
      const shelfY = bottom - 3;

      // A bed for the fire, in rock nothing else has taken.
      for (let x = p0; x < p0 + W; x++) {
        for (let y = bottom; y <= bottom + 2 + CRUST; y++) {
          if (peek(x, y) !== TILE.GROUND) return false;
        }
      }
      // And a lip either side to step off, which is the pocket's own floor.
      if (peek(p0 - 1, top) !== TILE.GROUND) return false;
      if (peek(p0 + W, top) !== TILE.GROUND) return false;

      for (let x = p0; x < p0 + W; x++) {
        for (let y = top - HEADROOM; y < bottom; y++) dig(x, y);
      }

      // Fire across the three columns furthest from the shelf. Two of the five
      // are a fall onto rock and three are a fall into that.
      for (let x = p0 + 2; x < p0 + W; x++) {
        for (let y = bottom; y <= bottom + 2; y++) put(x, y, TILE.LAVA);
      }

      // The shelf, under the two columns nearest the near lip.
      put(p0, shelfY, TILE.GROUND);
      put(p0 + 1, shelfY, TILE.GROUND);

      // A notch in the pocket wall beside the shelf, so there is somewhere to
      // step off it into the room. movesFrom wants two open rows at head height
      // before it will walk off a ledge, and a pocket only three or four rows
      // tall does not reach that high on its own — without this the shelf is
      // somewhere the verifier can arrive and never leave.
      for (let y = shelfY - 2; y < bottom; y++) dig(p0 - 1, y);

      // And the way back up, one-way planks up the far wall. A rung of rock
      // directly above another is a ceiling as far as movesFrom is concerned:
      // it refuses the climb, and the link becomes one-way.
      for (let y = shelfY; y > top; y -= LEDGE_RISE) put(p0 + W - 1, y, TILE.PLATFORM);

      // The shaft record grows to the hole's real shape, and is flagged so the
      // ladder pass leaves it alone — a ladder down the middle of a blind drop
      // is a handrail on the one thing in the cave meant to be looked at before
      // it is stepped into.
      s.x = p0;
      s.x0 = p0;
      s.x1 = p0 + W - 1;
      s.w = W;
      s.blind = true;
      places.push({ type: "drop", x0: p0, x1: p0 + W - 1, floorY: top, bottom });
      blinds++;
      return true;
    }

    // A pool of lava lying in a dip in the floor, its surface flush with the
    // ground either side of it. Lava sits in the world the way a liquid would:
    // sunk into rock, never stacked on top of it, because a block of it
    // standing in the open air reads as a mistake however it got there.
    //
    // Cut through solid rock only. Sunk into a passage below, the pool would
    // pour into the middle of it and cut it in two.
    function lavaPool(x, w, floorY) {
      const depth = detail.int(2, 3);
      // Never shoulder to shoulder with another pool. Two two-tile pools with a
      // shared edge are a four-tile pool, and nothing crosses that down here.
      if (peek(x - 1, floorY) === TILE.LAVA || peek(x + w, floorY) === TILE.LAVA) return false;
      // And never into rock. A place remembers where its floor was, not whether
      // anything is still standing on it; poured under a roof that closed up
      // since, the pool is lava sealed inside stone.
      for (let cx = x; cx < x + w; cx++) {
        if (peek(cx, floorY - 1) !== TILE.EMPTY) return false;
      }
      // The pool itself, plus CRUST rows of rock to hold it: a passage may run
      // under a pool, but never close enough that the floor between them is one
      // tile of stone with lava sitting on it.
      for (let cx = x; cx < x + w; cx++) {
        for (let y = floorY; y <= floorY + depth + CRUST; y++) {
          if (peek(cx, y) !== TILE.GROUND) return false;
        }
      }
      for (let cx = x; cx < x + w; cx++) {
        for (let y = floorY; y <= floorY + depth; y++) put(cx, y, TILE.LAVA);
      }
      places.push({ type: "pool", x0: x, x1: x + w - 1, floorY, depth });
      return true;
    }

    // A hole in the floor with lava at the bottom. Only ever sunk through
    // untouched rock — punched into a passage below, the pool would sit in the
    // middle of that passage and cut it in two — so it takes whatever depth the
    // rock allows and gives up if that is not deep enough to read as a hole.
    //
    // It stops short of whatever is underneath by CRUST rows. A passage may run
    // below a pool; it may not run directly under its basin, where a single
    // tile of stone is all that separates a corridor ceiling from the lava
    // standing on it.
    function lavaHole(x, w, floorY) {
      const want = Math.min(FLOOR_LIMIT, floorY + detail.int(6, 14));
      const solidRow = (y) => {
        for (let cx = x; cx < x + w; cx++) if (peek(cx, y) !== TILE.GROUND) return false;
        return true;
      };
      const bedded = (y) => {
        for (let i = 1; i <= CRUST; i++) if (!solidRow(y + i)) return false;
        return true;
      };

      let bottom = floorY;
      while (bottom < want && solidRow(bottom + 1)) bottom++;
      // Back off the basin until it is bedded in rock rather than resting on a
      // ceiling. Sooner give up the hole than leave one paper thin.
      while (bottom > floorY && !bedded(bottom)) bottom--;
      if (!solidRow(floorY) || bottom - floorY < 5) return false;

      for (let cx = x; cx < x + w; cx++) {
        for (let y = floorY; y < bottom; y++) dig(cx, y);
        for (let y = bottom - 3; y < bottom; y++) put(cx, y, TILE.LAVA);
      }
      places.push({ type: "lava", x0: x, x1: x + w - 1, floorY, bottom });
      return true;
    }

    for (const node of rooms) carveJunction(node);

    const home = rooms[startCell];
    const exit = rooms[endCell];

    // Every link is a passage, junction to junction. Along a row that is a
    // tunnel the width of a whole cell, which is what gives the wander room to
    // be a wander; between rows it is a chimney, dropped straight down the
    // column both junctions share.
    const BLIND_METRES = 500; // roughly one set-piece per this much run
    let blinds = 0;

    for (const k of linked) {
      const parts = k.split("|");
      const a = rooms[Number(parts[0])];
      const b = rooms[Number(parts[1])];

      if (a.r === b.r) {
        const left = a.c < b.c ? a : b;
        const right = a.c < b.c ? b : a;
        // A crawlway needs both ends at the same height, because it cannot rise
        // a single tile without becoming a wall. Where two junctions happen to
        // line up, the way between them is sometimes a duck rather than a walk.
        const low = left.floorY === right.floorY && rng.chance(CRAWL_CHANCE);
        tunnel(left.x, left.floorY, right.x, right.floorY,
          low ? 0 : rng.int(2, 5), low ? CRAWL : HEADROOM);
      } else {
        const above = a.r < b.r ? a : b;
        const below = a.r < b.r ? b : a;
        // Two wide or three: a tight chimney is a faster climb, because the far
        // wall is closer to kick to, and a wide one is a drop you can fall down
        // without touching the sides.
        shaft(above.x - 1, rng.chance(0.25) ? 2 : SHAFT_W, below.floorY, above.floorY);
      }
    }

    // And now some of those become set-pieces. Deep ones only, taken in an
    // order the seed decides, and asked for more than are wanted — a shaft
    // whose room below has already been dug through has no bed for the fire and
    // says no, so the count is filled from whichever ones can take it.
    const deepEnough = shafts.filter((s) => s.bottom - s.top >= 12);
    for (let want = Math.max(1, Math.round(width / BLIND_METRES));
         want > 0 && deepEnough.length; ) {
      const s = deepEnough.splice(detail.int(0, deepEnough.length - 1), 1)[0];
      if (blindShaft(s)) want--;
    }



    // ------------------------------------------------------------ lava lakes
    //
    // A stretch of corridor with the floor taken out of it and fire underneath,
    // crossed on stepping stones that will not take your weight twice. Stand
    // still and the stone goes; keep moving and it is behind you before it
    // does. There is no way across that is not a decision about pace.
    //
    // Cut into the floor rather than dug down from it, so it is a gap in a
    // passage you were already walking rather than a shaft you fall into: the
    // lip either side stays, the fire sits two rows down, and the stones hang
    // level with the floor that was there.
    const LAKE_METRES = 700; // roughly one per this much run
    const LAKE_DROP = 2; // rows of air between the stones and the fire
    const LAKE_DEEP = 2; // rows of fire
    const LAKE_STONES = 3;
    let lavaLakes = 0;
    const crumbleAt = [];

    // Gap, stone, gap, stone … gap, built to a width rather than measured after
    // one. Everything starts at its smallest — gaps of two, stones of one, which
    // comes to eleven — and the slack up to the width asked for is spent on the
    // gaps first and the stones after.
    //
    // Built to fit rather than generated and filtered because the first version
    // did the latter and threw three quarters of its patterns away, which cost
    // three quarters of its attempts at finding anywhere to put one. Every jump
    // is inside the envelope by construction either way: from any stone the next
    // is its own width plus a gap along, so three or four tiles against a reach
    // of five, and the two ends are the same.
    function lakePattern() {
      const span = detail.int(11, 14);
      const gaps = new Array(LAKE_STONES + 1).fill(2);
      const stones = new Array(LAKE_STONES).fill(1);

      // Stones widened before gaps, and that ordering is the difference between
      // stones that are always one tile and stones that are sometimes two. Four
      // gaps and three stones out of a span of at most fourteen leaves at most
      // three tiles of slack; spent on the gaps it all goes there and every
      // stone stays a single tile, which is one foothold repeated four times
      // rather than a crossing with a shape to it.
      let spare = span - (2 * (LAKE_STONES + 1) + LAKE_STONES);
      for (let i = 0; i < stones.length && spare > 0; i++, spare--) stones[i] = 2;
      for (let i = 0; i < gaps.length && spare > 0; i++, spare--) gaps[i] = 3;

      const plan = [];
      for (let i = 0; i < LAKE_STONES; i++) plan.push({ gap: gaps[i], stone: stones[i] });
      return { plan, last: gaps[LAKE_STONES], span };
    }

    // Every run of flat, walkable floor in the cave, read off the tiles rather
    // than off the list of places.
    //
    // The places are the wrong thing to ask. A chamber is seven columns and a
    // corridor segment closes every time the floor steps, which is every three
    // to five — so almost nothing in that list is as long as a lake, and the
    // first version of this found somewhere to build about one time in ten. The
    // rock does not care which bookkeeping entry a column belongs to: a chamber
    // and the passage leaving it at the same height are one flat run, and that
    // is what a lake needs.
    function flatRuns(least) {
      const found = [];
      for (let y = CEIL_LIMIT; y <= FLOOR_LIMIT; y++) {
        let start = -1;
        for (let x = 0; x <= width; x++) {
          const walkable = x < width &&
            peek(x, y) === TILE.GROUND &&
            peek(x, y - 1) === TILE.EMPTY &&
            peek(x, y - 2) === TILE.EMPTY;
          if (walkable) {
            if (start < 0) start = x;
            continue;
          }
          if (start >= 0 && x - start >= least) found.push({ y, x0: start, x1: x - 1 });
          start = -1;
        }
      }
      return found;
    }

    function lakeClear(at0, span, F) {
      const bed = F + LAKE_DROP;

      // Not where a shaft is: those are dug from the floor down, which is
      // exactly where the fire wants to sit.
      if (shafts.some((s) => at0 - 1 <= s.x1 + 1 && at0 + span >= s.x0 - 1)) return false;

      // The lip either side, and the floor being replaced.
      for (let x = at0 - 1; x <= at0 + span; x++) {
        if (peek(x, F) !== TILE.GROUND) return false;
      }

      // Rock from under the floor down through the fire and the crust that
      // holds it. Two rows of crust and not one, because that is what the
      // draining pass asks of every pool: a tile with less than CRUST of stone
      // beneath it is lava hanging over somewhere, and it gets emptied.
      for (let x = at0; x < at0 + span; x++) {
        for (let y = F + 1; y < bed + LAKE_DEEP + CRUST; y++) {
          if (peek(x, y) !== TILE.GROUND) return false;
        }
      }
      return true;
    }

    function carveLake(at0, shape, F) {
      const bed = F + LAKE_DROP;

      for (let x = at0; x < at0 + shape.span; x++) {
        for (let y = F; y < bed; y++) dig(x, y);
        for (let y = bed; y < bed + LAKE_DEEP; y++) put(x, y, TILE.LAVA);
      }

      let x = at0;
      for (const step of shape.plan) {
        x += step.gap;
        for (let i = 0; i < step.stone; i++) {
          put(x + i, F, TILE.CRUMBLE);
          crumbleAt.push({ x: x + i, y: F });
        }
        x += step.stone;
      }

      places.push({ type: "lake", x0: at0, x1: at0 + shape.span - 1, floorY: F, bed });
      lavaLakes++;
    }

    for (let want = Math.max(1, Math.round(width / LAKE_METRES)); want > 0; want--) {
      const shape = lakePattern();
      // Two columns of lip either side of the hole, so a lake never starts in
      // the doorway of whatever it is cut into.
      const runs = flatRuns(shape.span + 4);
      let placed = false;

      while (runs.length && !placed) {
        const run = runs.splice(detail.int(0, runs.length - 1), 1)[0];
        const from = run.x0 + 2;
        const to = run.x1 - 1 - shape.span;
        if (to < from) continue;
        if (run.y + LAKE_DROP + LAKE_DEEP + CRUST > FLOOR_LIMIT) continue;

        // Every position along the run, starting somewhere the seed chose, so
        // one awkward column does not cost the whole stretch.
        const offset = detail.int(0, to - from);
        for (let n = 0; n <= to - from && !placed; n++) {
          const at0 = from + ((offset + n) % (to - from + 1));
          if (!lakeClear(at0, shape.span, run.y)) continue;
          carveLake(at0, shape, run.y);
          placed = true;
        }
      }
    }

    // ---------------------------------------------------------------- ducts
    // A slit through the rock, one tile tall. Nothing can stand up in one, so
    // nothing can walk one, and verify() cannot see it at all: standing wants
    // two open rows and a duct has one. That is the whole design. A duct is cut
    // only between rooms the maze deliberately did not join, so it is never a
    // way through that a level depends on — it is a wall with a gap in it, for
    // a player low enough to use it, skipping the way round that the maze meant
    // them to take.
    //
    // Cut last of all the digging, because a duct is the one passage that stops
    // being itself the moment anything opens its roof.
    let ducts = 0;
    for (let i = 0; i < count; i++) {
      const j = i + 1;
      if (j >= count || colOf(j) === 0) continue; // same row, next column along
      if (linked.has(key(i, j))) continue; // where the maze already goes, no need
      const a = rooms[i];
      const b = rooms[j];
      // It can neither climb nor step: one row leaves no room to do either.
      if (a.floorY !== b.floorY || !rng.chance(DUCT_CHANCE)) continue;

      // Only through rock — threaded across something already open it would be
      // a slit with no roof, which is to say not a slit. The rock it has to
      // find is the rock between the two junction pockets, not between their
      // centres: a junction is carved, so asking whether its own columns are
      // solid is asking whether it exists.
      const from = a.x + 4;
      const to = b.x - 4;
      if (to - from < 4) continue;

      let solid = true;
      for (let x = from; x <= to && solid; x++) {
        for (let cy = a.floorY - DUCT - 1; cy <= a.floorY; cy++) {
          if (peek(x, cy) !== TILE.GROUND) solid = false;
        }
      }
      if (!solid) continue;

      // Cut from pocket edge to pocket edge, so it opens into both.
      for (let x = a.x + 3; x <= b.x - 3; x++) {
        for (let cy = a.floorY - DUCT; cy < a.floorY; cy++) dig(x, cy);
      }
      places.push({ type: "duct", x0: a.x + 3, x1: b.x - 3, floorY: a.floorY, head: DUCT });
      ducts++;
    }

    // --------------------------------------------------------------- hazards
    // Lava, and nothing else. It is the one hazard that reads at a glance from
    // across a dark room, and the only one that costs you a trip back rather
    // than a death.
    let shallow = 0;
    let pools = 0;
    // Somewhere along this floor with clear ground either side and no ladder
    // underneath it. Lava is not a place you can stand, so a pool poured over a
    // rung breaks the climb it belongs to.
    const spotIn = (place, w) => {
      const lo = place.x0 + 3;
      const hi = place.x1 - 3 - w;
      if (hi < lo) return -1;
      for (let tries = 0; tries < 8; tries++) {
        const at0 = detail.int(lo, hi);
        if (!shafts.some((s) => at0 + w + 2 >= s.x0 && at0 - 2 <= s.x1)) return at0;
      }
      return -1;
    };

    // Over a snapshot, because placing a hazard records it and a for..of walks
    // straight into whatever it appended. Nothing goes wrong today — a pool is
    // not a corridor, so the filter below drops it — but that is the filter
    // holding up the loop, and the loop should hold itself up.
    for (const place of places.slice()) {
      if (place.type !== "corridor" && place.type !== "chamber") continue;
      if (place.x1 - place.x0 < 10) continue;
      if (place.floorY <= CEIL_LIMIT + 1) continue;

      const roll = detail.int(0, 99);

      // Read the roof off the tiles rather than off the label. Places overlap —
      // a chamber's span can cover a crawlway's columns — so the only honest
      // answer to "how much room is there here" is the rock itself. Counted
      // over the hazard's own columns, because that is the air a jump needs.
      const clearance = (x, w) => {
        let rows = 9;
        for (let cx = x; cx < x + w; cx++) {
          let open = 0;
          while (open < 9 && peek(cx, place.floorY - 1 - open) !== TILE.GROUND) open++;
          rows = Math.min(rows, open);
        }
        return rows;
      };

      if (roll < 20) {
        // A puddle set into the ground: a gap to clear rather than a wall. Under
        // a low roof it is narrower, because a skim crosses two tiles and there
        // is nothing else down there that crosses any.
        let w = detail.int(2, 4);
        const at0 = spotIn(place, w);
        if (at0 < 0) continue;
        // Under two rows nothing crosses at all, not even a skim, so nothing is
        // put there. Under three, only a skim, and a skim crosses two tiles.
        const room = clearance(at0, w);
        if (room < 2) continue;
        if (room < 3) w = Math.min(w, 2);
        if (lavaPool(at0, w, place.floorY)) shallow++;
      } else if (roll < 34) {
        // Never a deep one under a low roof: a hole you cannot jump, in a
        // passage you cannot jump in, is a wall.
        const w = detail.int(2, 3);
        const at0 = spotIn(place, w);
        if (at0 < 0 || clearance(at0, w) < 3) continue;
        if (lavaHole(at0, w, place.floorY)) pools++;
      }
    }

    // --------------------------------------------------------- crawl repair
    // A crawlway is only travelable while it stays flat and its floor stays
    // whole. Neither is guaranteed when it is dug: a shaft sunk later can take
    // three tiles of its floor away, and a passage crossing it can leave a step.
    // Both are nothing in a tunnel you can jump in and a dead stop in one you
    // cannot, so a crawlway that did not stay flat and whole stops being one —
    // the roof is opened out and it becomes an ordinary passage.
    for (const seg of crawls) {
      let travelable = true;
      let low = true;
      for (let x = seg.x0; x <= seg.x1; x++) {
        const floor = peek(x, seg.floorY);
        const walkable = floor === TILE.GROUND || floor === TILE.PLATFORM;
        // Lava is allowed to interrupt the floor — that is the pool a skim is
        // for — but nothing else is.
        if (!walkable && floor !== TILE.LAVA) travelable = false;
        for (let cy = seg.floorY - CRAWL; cy < seg.floorY; cy++) {
          if (peek(x, cy) !== TILE.EMPTY) travelable = false;
        }
        // A roof only counts where it is actually still there. Rooms carved
        // above one open it out, and an opened crawlway is just a passage. The
        // mouths are exempt: both ends stand inside the rooms they join, where
        // the ceiling was never low to begin with.
        const mouth = x < seg.x0 + 4 || x > seg.x1 - 4;
        if (!mouth && peek(x, seg.floorY - CRAWL - 1) !== TILE.GROUND) low = false;
      }

      if (!travelable) {
        for (let x = seg.x0; x <= seg.x1; x++) {
          for (let cy = seg.floorY - HEADROOM; cy < seg.floorY; cy++) {
            if (peek(x, cy) !== TILE.LAVA) dig(x, cy);
          }
        }
      }
      if (!travelable || !low) seg.head = HEADROOM;
    }

    // ------------------------------------------------------------- draining
    // A pool is dug into rock, but the rock under it belongs to the world too,
    // and a passage cut along the level below can take the floor out from under
    // one after it was poured. Pools keep a crust of rock beneath them for
    // exactly that reason, but a crust is a rule about carving, not a promise,
    // so this is the backstop: lava with nothing holding it up is not lava, it
    // is a mistake hanging in the air, and it drains. Bottom upwards, so
    // emptying one tile empties whatever was resting on it.
    for (let cy = height - 2; cy >= 0; cy--) {
      for (let cx = 0; cx < width; cx++) {
        if (peek(cx, cy) !== TILE.LAVA) continue;

        const below = peek(cx, cy + 1);
        if (below === TILE.EMPTY) {
          dig(cx, cy);
          continue;
        }
        if (below !== TILE.GROUND) continue; // lava on lava: the basin decides

        // The basin, and how much stone is actually holding it. A pool left
        // standing on a single tile over a passage is the thing the crust rule
        // exists to prevent — and a pool poured where the crust was thick
        // enough can still end up over a passage that was cut afterwards.
        let rock = 0;
        while (rock < CRUST && peek(cx, cy + 1 + rock) === TILE.GROUND) rock++;
        if (rock < CRUST) dig(cx, cy);
      }
    }

    // ---------------------------------------------------------- the ladders
    // Laid last and over the top of everything, because a shaft without its
    // rungs is a one-way drop.
    // Worked out here, at the end, because a ladder is a claim about a climb
    // and a climb depends on the walls. Everything has finished digging, so the
    // rock these read is the rock the player will meet.
    //
    // A rung is placed against stone, never out in the middle of the air, and
    // how far the next one goes depends on where this one stands. A shaft
    // bottoms out inside a room, and a rung in that room's open air has nothing
    // beside it to bounce off: from there the only way up is a plain jump.
    // Higher, once a rung has rock either side of it, the climb becomes a
    // chimney — wall to wall — and the rungs can spread out into resting points
    // instead of a staircase built up the middle of a shaft that never needed
    // one. Spreading them on the strength of walls that are not there is
    // invisible and total: every shaft in the map becomes a one-way drop.
    for (const shaft of shafts) {
      const { x, w, top, bottom } = shaft;
      if (bottom - top <= LEDGE_RISE) continue;
      // A blind drop brought its own way out, up one wall and no further. A
      // staircase down the middle of it would be a handrail on the one thing
      // in the cave that is meant to be looked at before it is stepped into.
      if (shaft.blind) continue;

      // These stay one-way platforms, and the reason is measured rather than
      // preferred. Solid rock nubs were tried in their place: one tile wide,
      // jutting from the wall, alternating sides. They drop 10 km from ten
      // levels beatable out of ten to six.
      //
      // The cause is that a climb reads a plank as air and a nub as an
      // obstacle. Both are true. You pass up through a platform, so nothing
      // above you on your own column is in the way; a nub is something to crack
      // your head on, so the jump from the nub below it is refused — and with
      // the ladder broken there is no way back up the shaft. Widening the shaft
      // and cycling the nubs over three positions were both tried; neither
      // recovers it.
      //
      // Everywhere else the platforms are gone. This is the one place the
      // level's connectedness rests on them.
      // A rung is two tiles in a three wide shaft and one in a two wide, so
      // there is always a column left open beside it. A rung that spans the
      // whole chimney is a floor, and a chimney floored every few rows is a
      // ladder you cannot fall back down.
      const rungW = w >= 3 ? 2 : 1;
      const anchored = (lx, y) =>
        peek(lx - 1, y) === TILE.GROUND || peek(lx + rungW, y) === TILE.GROUND;
      const chimney = w <= 3 &&
        peek(x - 1, Math.round((top + bottom) / 2)) === TILE.GROUND &&
        peek(x + w, Math.round((top + bottom) / 2)) === TILE.GROUND;

      let side = 0;
      const addRung = (y) => {
        const turn = side ? x : x + w - rungW;
        const other = side ? x + w - rungW : x;
        const lx = anchored(turn, y) || !anchored(other, y) ? turn : other;
        for (let i = 0; i < rungW; i++) put(lx + i, y, TILE.PLATFORM);
        side = side ? 0 : 1;
      };

      let y = bottom - LEDGE_RISE;
      addRung(y);
      for (;;) {
        const walled = peek(x - 1, y - 1) === TILE.GROUND || peek(x + w, y - 1) === TILE.GROUND;
        const reach = walled ? RULES.maxWallClimb - 1 : LEDGE_RISE;
        if (y - top <= reach) break;
        y = Math.max(top + 1, y - (walled && chimney ? CHIMNEY_RISE : LEDGE_RISE));
        addRung(y);
      }
    }

    // -------------------------------------------------------- spawn and door
    //
    // Found rather than cut, and found last of all. Laying a floor to stand on
    // is how the start of a run seals the top of the shaft that was the only
    // way out of it — rock put back under the runner's feet goes back over
    // whatever the links opened. And choosing the spot early is how the run
    // starts in a pool: hazards, ducts and repairs all come after, and any of
    // them can take the ground out from under a place that was standable when
    // it was picked.
    //
    // So: walk out from the junction until the rock as it finally stands has
    // somewhere to be, and only then put the door in it.
    // The floor near a junction is not necessarily at the junction's height: a
    // tunnel leaves it wandering, so the row is searched for as well as the
    // column. Two open rows over solid ground is the whole test, which is the
    // same test the audit applies.
    const standingSpot = (node, dir) => {
      for (let d = 0; d <= 14; d++) {
        const x = node.x + d * dir;
        for (let dy = -3; dy <= 3; dy++) {
          const fy = node.floorY + dy;
          if (peek(x, fy) !== TILE.GROUND) continue;
          if (peek(x, fy - 1) !== TILE.EMPTY) continue;
          if (peek(x, fy - 2) !== TILE.EMPTY) continue;
          return { x, y: fy - 1 };
        }
      }
      return { x: node.x, y: node.floorY - 1 };
    };

    const spawn = standingSpot(home, 1);
    const goal = standingSpot(exit, -1);

    put(goal.x, goal.y, TILE.DOOR);
    put(goal.x, goal.y - 1, TILE.DOOR);

    // ---------------------------------------------------------------- torches
    //
    // Something to separate a passage from the void behind it. A cave lit only
    // by the colour of its own rock is a cave where a tunnel and a hole in the
    // world look identical, and the whole game is deciding which of those you
    // are looking at.
    //
    // Placed last, against the finished rock, because a torch needs a ceiling
    // to hang from and nothing knows where the ceilings are until the digging
    // has stopped.
    const torches = [];
    const TORCH_GAP = 7; // never two closer than this, or they read as a string of lights

    const canMount = (x, y) =>
      peek(x, y) === TILE.EMPTY &&
      peek(x, y - 1) === TILE.GROUND && // fixed to the rock overhead
      peek(x, y + 1) !== TILE.LAVA;

    // Somewhere near here with rock above it. Torches are wanted at particular
    // places — a junction, a doorway — and the exact tile matters much less
    // than being close to the thing it is lighting.
    const mountTorch = (x, y) => {
      for (let d = 0; d <= 4; d++) {
        for (const s of d === 0 ? [1] : [-1, 1]) {
          const cx = x + d * s;
          for (let dy = 0; dy <= 4; dy++) {
            const cy = y - dy;
            if (!canMount(cx, cy)) continue;
            if (torches.some((t) => Math.abs(t.x - cx) < TORCH_GAP && Math.abs(t.y - cy) < 5)) {
              continue;
            }
            torches.push({ x: cx, y: cy });
            return true;
          }
        }
      }
      return false;
    };

    // The two that are not decoration: one at the start so the first thing you
    // see is lit, one at the door so the last thing you are looking for is.
    mountTorch(spawn.x, spawn.y);
    mountTorch(goal.x, goal.y);

    // One at every junction, which is where the forks are and so where the
    // decisions are.
    for (const node of rooms) mountTorch(node.x, node.floorY - 1);

    // And along the long runs, so a corridor has a rhythm to it rather than
    // going dark between one junction and the next.
    for (const place of places) {
      if (place.type !== "corridor") continue;
      if (place.x1 - place.x0 < 16) continue;
      for (let x = place.x0 + 6; x <= place.x1 - 4; x += rng.int(16, 20)) {
        mountTorch(x, place.floorY - 1);
      }
    }

    // ------------------------------------------------------------ stalactites
    //
    // Hung from the ceiling of horizontal passages, thickest near the roof of
    // the world and almost absent in the mantle — the deep has lava and gems to
    // be about, and a hazard everywhere is a hazard nowhere.
    //
    // Every constraint here is about fairness rather than looks. There has to
    // be room to see one coming and get out from under it, so a passage with
    // less than three rows is left alone, which rules out every crawlway and
    // every duct without naming them. There has to be floor beneath it, so one
    // never drops into a pool and vanishes. And it never hangs in a shaft: the
    // way out of a shaft is a climb, and a climb interrupted is a fall all the
    // way back down.
    const stalactites = [];
    const inShaft = (x) => shafts.some((s) => x >= s.x0 - 1 && x <= s.x1 + 1);

    for (const place of places) {
      if (place.type !== "corridor" && place.type !== "chamber") continue;

      for (let x = place.x0 + 2; x <= place.x1 - 2; x++) {
        if (inShaft(x)) continue;
        if (peek(x, place.floorY) !== TILE.GROUND) continue; // no floor, or lava

        // The topmost open row in this column: what a stalactite hangs from.
        let top = place.floorY - 1;
        while (top > 1 && peek(x, top - 1) === TILE.EMPTY) top--;
        if (place.floorY - top < 3) continue; // no room to dodge

        // Thick near the roof, thinning with depth, nearly gone in the mantle.
        const chance = top < 35 ? 10 : top < 50 ? 5 : 1;
        if (detail.int(0, 99) >= chance) continue;
        if (stalactites.some((s) => Math.abs(s.x - x) < 6)) continue;

        stalactites.push({ x, y: top, floorY: place.floorY });
      }
    }

    // A hard lid on the world. Rock is the boundary, so there is no lip to get
    // over and no empty air above it to end up standing in.
    for (let cx = 0; cx < width; cx++) put(cx, 0, TILE.GROUND);

    // Lava reaches the bottom of anything dug that deep.
    for (let cy = height - 3; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        if (peek(cx, cy) === TILE.EMPTY) put(cx, cy, TILE.LAVA);
      }
    }

    const level = {
      seed,
      mode: mode.id,
      meters: width * METERS_PER_TILE,
      width,
      height,
      tiles,
      spawn,
      goal,
      places,
      rooms,
      torches,
      stalactites,
      // Where the crumbling stones are. The session turns these into state; the
      // level only says where they were carved.
      crumbles: crumbleAt,
      links: Array.from(linked, (k) => k.split("|").map(Number)),
      rules: RULES,
      tally: {
        ducts,
        torches: torches.length,
        stalactites: stalactites.length,
        crawlways: crawls.filter((s) => s.head < HEADROOM).length,
        blinds,
        lavaLakes,
        crumbles: crumbleAt.length,
        shallow,
        pools,
        loops,
        rooms: count,
        links: linked.size,
        places: places.length,
      },
    };
    level.checksum = checksum(tiles);
    return level;
  }
  // ---------------------------------------------------------------- the fault
  //
  // Most of the rock is carved. One hash of one seed lands somewhere the rock
  // has already taken a shape of its own, and that shape is left alone.
  //
  // What it is does not matter to this file. How it is built does.
  //
  // The shapes used to stand in the way, nine rows of stone apiece with the
  // only route over the top of each one. That was provable and it was slow: a
  // climb between every pair of them, and gaps wide enough that no two could be
  // taken in at once. What is here now is the other arrangement — the shapes
  // are underneath, sealed in a case beneath the floor, close enough together
  // to read as what they are, and the running is done on a flat two-row track
  // over the top of them at whatever speed you can hold.
  //
  // Sealed is the load-bearing word. Nothing can get into the case, so nothing
  // in it can strand you and nothing in it needs to be climbable; it is scenery
  // with a floor over it, and the route is the corridor above, which is flat
  // from the top of the chimney to the door. The chimney is the only part that
  // goes anywhere vertically, and it is a ladder rather than a bare shaft
  // because movesFrom will not climb a wall with nothing to land on.
  //
  // verify walks it like any other level rather than taking that on trust.
  const FAULT_HASH = 0x8de3fcd5;

  const FAULT_W = 11; // columns across one shape
  const FAULT_H = 9; // rows tall
  const FAULT_LETTER_GAP = 4;
  const FAULT_WORD_GAP = 9;

  // Always this long, whatever length the menu was asking for. The track is a
  // fixed thing and stretching it to five kilometres would put a quarter mile
  // of blank corridor between one shape and the next.
  const FAULT_WIDTH = 500;

  const RUN_ROOF = 27; // solid, and low enough to feel
  const RUN_Y = 29; // where you stand
  const RUN_FLOOR = 30; // solid, and the lid of the gallery
  const CASE_TOP = 32; // the gallery: sealed, lit, and under the whole run
  const CASE_BOTTOM = 42;
  const CASE_INK = 33; // first row of the shapes inside it

  const SPAWN_FLOOR = 52;
  const CHIMNEY_X = 12;
  const RUNG_RISE = 3; // one plain jump between rungs

  // The shapes, a row of bits each. Numbers rather than pictures: reading them
  // out of the source is not how this is meant to be found.
  const STRATA = [
    "60330618c0d8070070070070070",
    "0f818c30660360360330618c0f8",
    "6036036036036036037073061fc",
    "7ff7ff6006007fc7fc600600600",
    "6037037836c366363361b60f603",
    "7fc60c60660360360360660c7fc",
    "60378f6db673603603603603603",
    "7ff7ff6006007fc7fc6006007ff",
    "070070070070070070000000070",
    "3fe6036036033fe0030036033fe",
  ];

  // Which shape stands where, grouped the way it is meant to be read. The
  // grouping is the only reason the runs are separate arrays: shapes inside one
  // sit close together, and the space between two of them is wider.
  const FAULT_WORDS = [
    [0, 1, 2],
    [3, 1, 2, 4, 5],
    [6, 7, 8],
  ];

  // And the one at the far end, for whoever is still running when they get
  // there. Two of the same shape, which is the whole of it.
  const FAULT_SIGNOFF = [[9, 9]];

  function carveFaultFormation(seed) {
    const mode = resolveMode("500m");
    const width = FAULT_WIDTH;
    const height = HEIGHT;
    const tiles = new Uint8Array(width * height).fill(TILE.GROUND);

    const put = (x, y, tile) => {
      if (x >= 0 && x < width && y >= 0 && y < height) tiles[y * width + x] = tile;
    };
    const clear = (x0, x1, y0, y1) => {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) put(x, y, TILE.EMPTY);
      }
    };

    const torches = [];

    // How long a thing reads as: every shape, the tight gaps inside a run, the
    // wide ones between them.
    const spanOf = (words) => {
      let count = 0;
      let inner = 0;
      for (const word of words) {
        count += word.length;
        inner += word.length - 1;
      }
      return (
        count * FAULT_W +
        inner * FAULT_LETTER_GAP +
        (words.length - 1) * FAULT_WORD_GAP
      );
    };

    const doorX = width - 22;

    // The runway: two rows, and a roof you will hit if you try to jump. A step
    // up needs a row of air above your head and there is none, so this is a
    // corridor you run and nothing else.
    clear(CHIMNEY_X + 3, width - 1, RUN_ROOF + 1, RUN_Y);

    // Down at the start, where you begin: a pocket with one way out of it.
    clear(4, CHIMNEY_X + 2, SPAWN_FLOOR - 4, SPAWN_FLOOR - 1);

    // And the way out. Three wide with rock down both sides, from the pocket
    // to the runway, opening sideways into it at the top.
    clear(CHIMNEY_X, CHIMNEY_X + 2, RUN_ROOF + 1, SPAWN_FLOOR - 1);

    // Rungs, alternating sides. Planks and not stone: a stack of solid rungs is
    // a ceiling over the one below it, and a climb needs air above each step
    // more than it needs something to hold. The top one lands level with the
    // runway floor, a stride from it.
    let side = 2;
    for (let y = SPAWN_FLOOR - RUNG_RISE; y > RUN_FLOOR; y -= RUNG_RISE) {
      put(CHIMNEY_X + side, y, TILE.PLATFORM);
      side = side === 2 ? 0 : 2;
    }

    // A gallery: a lit case under the floor, sealed on every side. Nothing can
    // get into one, which is exactly why it is safe to hang anything at all in
    // there — and you read it through the floor as it goes past underneath.
    //
    // Lit from its own ceiling, and lit only down here. A torch hangs most of
    // the way down its own tile from the rock above it, and the runway is two
    // rows: one of them is your head. A line of them along the track would be a
    // line of them through the runner, in the one corridor built to be taken at
    // full speed and read while you do it.
    const inscribe = (words, atX) => {
      const span = spanOf(words);
      clear(atX - 4, atX + span + 3, CASE_TOP, CASE_BOTTOM);

      let x0 = atX;
      for (const word of words) {
        for (let i = 0; i < word.length; i++) {
          const bits = STRATA[word[i]];
          for (let r = 0; r < FAULT_H; r++) {
            const row = parseInt(bits.slice(r * 3, r * 3 + 3), 16);
            for (let c = 0; c < FAULT_W; c++) {
              if ((row >> (FAULT_W - 1 - c)) & 1) put(x0 + c, CASE_INK + r, TILE.GROUND);
            }
          }
          x0 += FAULT_W + (i === word.length - 1 ? FAULT_WORD_GAP : FAULT_LETTER_GAP);
        }
      }

      for (let x = atX - 2; x < atX + span + 2; x += 12) {
        torches.push({ x, y: CASE_TOP });
      }
      return span;
    };

    // The first thing under the track, not the last. It used to sit against the
    // door with the whole run in front of it, which meant a very long way with
    // nothing to look at and then everything at once; this way it starts under
    // your feet a stride off the ladder and you have read it before you are up
    // to speed. What the rest of the run is for is the running.
    inscribe(FAULT_WORDS, CHIMNEY_X + 9);

    // And the far end, hard against the door.
    inscribe(FAULT_SIGNOFF, doorX - 6 - spanOf(FAULT_SIGNOFF));

    put(doorX, RUN_Y, TILE.DOOR);
    put(doorX, RUN_Y - 1, TILE.DOOR);

    const level = {
      seed,
      mode: mode.id,
      meters: width * METERS_PER_TILE,
      width,
      height,
      tiles,
      spawn: { x: 6, y: SPAWN_FLOOR - 1 },
      goal: { x: doorX, y: RUN_Y },
      places: [],
      rooms: [],
      torches,
      stalactites: [],
      crumbles: [],
      links: [],
      rules: RULES,
      tally: {
        crawlways: 0,
        ducts: 0,
        shallow: 0,
        pools: 0,
        stubs: 0,
        loops: 0,
        rooms: torches.length,
        links: 0,
        places: 0,
      },
    };
    level.checksum = checksum(tiles);
    return level;
  }

  // ------------------------------------------------------------- the tutorial
  //
  // Handcrafted, because teaching is the one thing the generator cannot do. A
  // seed makes a cave that is fair; it cannot make one that introduces an idea,
  // gives you somewhere safe to get it wrong, and only then asks you to use it.
  //
  // Every chamber here is one idea. The order is the argument: you cannot be
  // told to scout a drop before you have jumped, or to crawl before you have
  // learned that the ceiling is real. Nothing in it is generated and nothing in
  // it is random, so the eighth chamber can rely on the seventh.
  function createTutorial() {
    const width = 200;
    const height = HEIGHT;
    const tiles = new Uint8Array(width * height).fill(TILE.GROUND);

    const put = (x, y, tile) => {
      if (x >= 0 && x < width && y >= 0 && y < height) tiles[y * width + x] = tile;
    };
    // A stretch of floor with clear air over it.
    const hall = (x0, x1, floorY, tall) => {
      for (let x = x0; x <= x1; x++) {
        for (let y = floorY - tall; y < floorY; y++) put(x, y, TILE.EMPTY);
      }
    };
    // A break in a floor. Shallow, so falling in it is a lesson and not a trip
    // back to the start.
    const gap = (x0, x1, floorY) => {
      for (let x = x0; x <= x1; x++) put(x, floorY, TILE.EMPTY);
    };
    const pool = (x0, x1, floorY, deep) => {
      for (let x = x0; x <= x1; x++) {
        for (let y = floorY; y <= floorY + deep; y++) put(x, y, TILE.LAVA);
      }
    };

    const TOP = 40; // where the run starts
    const CATCH = 54; // the shelf you have to steer onto, halfway down the drop
    const DEEP = 66; // the long floor: pool, slot, low ceiling
    const SHELF = 58; // between the two climbs
    const HIGH = 46; // the door

    // 1 and 2 — open ground, then two gaps: one a tap, one a held jump.
    hall(3, 79, TOP, 7);
    gap(44, 45, TOP);
    gap(55, 58, TOP);

    // 3 — the floor runs out. What is under it is a shaft with lava in the
    // bottom and one way out: a shelf on the near wall, tucked back under the
    // way you came, too far down to see from the edge. Walk off and you land in
    // the lava; hold back into the left wall on the way down and you land on
    // the shelf. It is the one place in the game where not looking costs you
    // the run, which is the whole reason the camera is yours.
    for (let x = 80; x <= 92; x++) {
      for (let y = TOP - 7; y <= CATCH + 3; y++) put(x, y, TILE.EMPTY);
    }
    hall(70, 82, CATCH, 6); // the shelf, and the way back off it
    for (let x = 70; x <= 82; x++) put(x, CATCH, TILE.GROUND); // its floor, into the shaft
    pool(83, 92, CATCH + 1, 2); // and what is waiting for everyone else

    // From the shelf the way on runs back the way you came and drops again.
    for (let x = 70; x <= 72; x++) {
      for (let y = CATCH; y <= DEEP - 1; y++) put(x, y, TILE.EMPTY);
    }

    // 4 — a pool set in the floor, with solid ground either side of it to jump
    // from and land on, and to be put back onto after falling in.
    hall(70, 110, DEEP, 4);
    pool(96, 98, DEEP, 2);

    // 5 — one row. Standing does not fit; nothing but a slide gets through.
    hall(111, 111, DEEP, 4);
    for (let x = 112; x <= 124; x++) put(x, DEEP - 1, TILE.EMPTY);

    // 6 — two rows: enough to walk, not enough to jump.
    hall(125, 126, DEEP, 4);
    hall(127, 148, DEEP, 2);

    // 7A — a single face, eight rows of it, climbed by drifting back into the
    // wall between kicks. The hall is cut well above the shelf it leads to:
    // a climb needs somewhere to be at the top of itself, and a ceiling level
    // with the shelf leaves the only open air on the far side of the wall.
    hall(149, 159, DEEP, 12);
    hall(160, 172, SHELF, 7);

    // 7B — a chimney: three wide, rock down both sides, twelve rows of it. Too
    // tall for one wall. Alternating kicks are the only way up.
    //
    // With a door in it. A shaft carved straight up out of solid rock has walls
    // all the way round, which is a fine chimney and an impossible one: there
    // is no way to be standing at the bottom of it. The entrance is cut low —
    // three rows at floor level — so the walls the climb needs are still there
    // for every row above the one you walk in on.
    hall(173, 176, SHELF, 3);
    for (let x = 174; x <= 176; x++) {
      for (let y = HIGH; y <= SHELF - 1; y++) put(x, y, TILE.EMPTY);
    }

    // 8 — the door.
    hall(174, 196, HIGH, 7);
    put(192, HIGH - 1, TILE.DOOR);
    put(192, HIGH - 2, TILE.DOOR);

    const level = {
      seed: "TUTORIAL",
      mode: "1k",
      meters: width * METERS_PER_TILE,
      width,
      height,
      tiles,
      spawn: { x: 6, y: TOP - 1 },
      goal: { x: 192, y: HIGH - 1 },
      places: [],
      // The tutorial teaches; it does not ambush.
      torches: [],
      stalactites: [],
      rules: RULES,
      tutorial: true,
      // Where the game stops to say something, and what it says. The x is the
      // point the runner has to reach; the lesson waits there until it is read.
      teach: [
        {
          x: 8,
          title: "Moving",
          body: "{move} runs. The camera does not follow you — it never will.",
          hint: "Run right",
        },
        {
          x: 40,
          title: "Jumping",
          body: "{jump} jumps, and how long you hold it is how high you go. The first gap is a tap. The second needs all of it.",
          hint: "Clear both gaps",
        },
        {
          x: 68,
          title: "Looking",
          body: "The floor stops ahead, and what is under it is further down than the screen goes. {camera} moves the view — look before you step off. There is one shelf down there and lava everywhere else, and the shelf is tucked back under this floor: hold left on the way down.",
          hint: "Scout the drop, then ride the left wall onto the shelf",
        },
        {
          x: 95,
          title: "Lava",
          body: "Lava costs you time, not the run. You are put back on the last safe ground you stood on and the fall is counted.",
          hint: "Jump it — or do not, and see",
        },
        {
          x: 108,
          title: "Crawling",
          body: "One row ahead. You cannot walk it. Hold {down} at a run to slide, and keep it held to crawl.",
          hint: "Slide through the slot",
        },
        {
          x: 128,
          title: "Low ceilings",
          body: "Two rows: room to walk, none to jump. The ceiling is solid and you will bounce off it.",
          hint: "Walk it out",
        },
        {
          x: 152,
          title: "Climbing a wall",
          body: "{jump} against a wall kicks off it. Drift back into the same wall and kick again to climb it.",
          hint: "Get up to the shelf",
        },
        {
          x: 172,
          title: "The chimney",
          body: "Too tall for one wall. Kick off one side, cross, kick off the other — alternating kicks throw you higher than repeating one.",
          hint: "Bounce to the top",
        },
        {
          x: 186,
          title: "The door",
          body: "Through it finishes the run. Your seed, distance, time and falls are kept in Recent runs on the menu.",
          hint: "Go through",
        },
      ],
      tally: { crawlways: 1, ducts: 1, shallow: 1, pools: 0, stubs: 0, loops: 0, rooms: 8, links: 8, places: 0 },
    };
    level.checksum = checksum(tiles);
    return level;
  }

  function at(level, x, y) {
    if (x < 0 || x >= level.width || y < 0 || y >= level.height) return TILE.EMPTY;
    return level.tiles[y * level.width + x];
  }

  // Topmost landable row in a column — ground or a stepping stone — or null
  // if the column is open air the whole way down.
  function surfaceAt(level, x) {
    for (let y = 0; y < level.height; y++) {
      const tile = at(level, x, y);
      if (tile === TILE.GROUND || tile === TILE.PLATFORM) return y;
    }
    return null;
  }

  // Topmost solid ground: the floor the critical path is actually walked on.
  function floorAt(level, x) {
    for (let y = 0; y < level.height; y++) {
      if (at(level, x, y) === TILE.GROUND) return y;
    }
    return null;
  }

  // Re-checks the promise the generator makes, so a bad weighting change shows
  // up as a failed level rather than an unbeatable one shipped to a player.
  // Gaps are measured against anything landable (a stone splits a long jump
  // into two short ones); climbs are measured against the floor only, so a
  // shelf floating over solid ground is never mistaken for a required climb.
  // Re-checks the promises the generator makes. Gaps are measured against
  // anything landable; climbs against the floor only; and a dive is checked as a
  // dive — its entry is *meant* to be too wide to jump, because the route runs
  // underneath it rather than across.
  // Checks the surface route against the generator's own record of where the
  // ground is. Gaps are runs with no ground and no stepping stone; climbs are
  // measured against whatever you could last stand on. Shafts are skipped —
  // the surface is cut there on purpose, and the route runs underneath.
  // Space a body can occupy. Rock blocks it; so does lava, which is not a place
  // you can be even though nothing solid is in the way — treating it as free
  // space invents standing room in the middle of a pool.
  function open(level, x, y) {
    if (x < 0 || x >= level.width || y < 0 || y >= level.height) return false;
    const tile = at(level, x, y);
    // Crumbling stone counts as filled. It is solid when the room is drawn and
    // solid whenever the route is checked; that it goes away under a foot is a
    // thing that happens during a run, not a thing the map is shaped by.
    return tile !== TILE.GROUND && tile !== TILE.LAVA && tile !== TILE.CRUMBLE;
  }

  // Can the player stand here: something solid underfoot, room for the body.
  function standable(level, x, y) {
    const under = at(level, x, y + 1);
    if (under !== TILE.GROUND && under !== TILE.PLATFORM && under !== TILE.CRUMBLE) {
      return false;
    }
    return open(level, x, y) && open(level, x, y - 1);
  }

  // Every move the player can make from a standing spot, using the measured
  // envelope in RULES. Deliberately conservative: anything listed here is
  // something the physics can definitely do.
  function movesFrom(level, x, y, visit) {
    const reach = level.rules.reach;

    // Level ground either side, and the tile-high step that everywhere else in
    // this game treats as walking. It is not walking: it is a hop small enough
    // that nobody thinks about it, and a hop needs room over your head. In a
    // two-row passage there is none, so there a step that size is a wall.
    for (const dx of [-1, 1]) {
      if (standable(level, x + dx, y)) visit(x + dx, y);
      if (open(level, x, y - 2) && standable(level, x + dx, y - 1)) visit(x + dx, y - 1);
    }

    for (let rise = 0; rise <= RULES.maxStepUp; rise++) {
      let clear = true;
      for (let h = 1; h <= rise + 2; h++) if (!open(level, x, y - h)) clear = false;
      if (!clear) continue;
      if (rise > 0 && standable(level, x, y - rise)) visit(x, y - rise);
      for (let dx = 1; dx <= reach[rise]; dx++) {
        for (const s of [-1, 1]) {
          if (standable(level, x + s * dx, y - rise)) visit(x + s * dx, y - rise);
        }
      }
    }

    // A face you can put a hand on is a face you can climb.
    if (at(level, x - 1, y) === TILE.GROUND || at(level, x + 1, y) === TILE.GROUND) {
      for (let rise = 1; rise <= RULES.maxWallClimb; rise++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (standable(level, x + dx, y - rise)) visit(x + dx, y - rise);
        }
      }
    }

    // Leaving a ledge and landing lower: falling keeps your speed, so this is
    // never harder than reaching the same distance on the level.
    for (const s of [-1, 1]) {
      for (let dx = 1; dx <= reach[0]; dx++) {
        const cx = x + s * dx;
        if (!open(level, cx, y) || !open(level, cx, y - 1)) break;
        for (let ty = y + 1; ty < level.height; ty++) {
          if (standable(level, cx, ty)) {
            visit(cx, ty);
            break;
          }
          if (at(level, cx, ty) === TILE.GROUND) break;
        }
      }
    }
  }

  // The real guarantee, and the only one worth trusting in a carved world: walk
  // the movement graph forwards from the spawn and backwards from the door. The
  // door must be reachable, and everywhere you can reach must still be able to
  // finish — no room you can fall into and not get out of.
  function verify(level) {
    const problems = [];
    const id = (x, y) => y * level.width + x;
    const index = new Map();
    const nodes = [];

    for (let x = 0; x < level.width; x++) {
      for (let y = 1; y < level.height; y++) {
        if (!standable(level, x, y)) continue;
        index.set(id(x, y), nodes.length);
        nodes.push({ x, y });
      }
    }

    const out = nodes.map(() => []);
    const back = nodes.map(() => []);
    nodes.forEach((node, i) => {
      movesFrom(level, node.x, node.y, (tx, ty) => {
        const j = index.get(id(tx, ty));
        if (j === undefined || j === i) return;
        out[i].push(j);
        back[j].push(i);
      });
    });

    const walk = (graph, from) => {
      const seen = new Uint8Array(nodes.length);
      const queue = [from];
      seen[from] = 1;
      while (queue.length) {
        const n = queue.pop();
        for (const m of graph[n]) if (!seen[m]) { seen[m] = 1; queue.push(m); }
      }
      return seen;
    };

    const start = index.get(id(level.spawn.x, level.spawn.y));
    const door = index.get(id(level.goal.x, level.goal.y));
    if (start === undefined) problems.push("spawn is not standable");
    if (door === undefined) problems.push("door is not standable");
    if (problems.length) return { ok: false, problems };

    const forward = walk(out, start);
    if (!forward[door]) {
      let far = 0;
      for (let i = 0; i < nodes.length; i++) if (forward[i] && nodes[i].x > far) far = nodes[i].x;
      problems.push("door unreachable — the route stops at x=" + far);
      return { ok: false, problems };
    }

    const canFinish = walk(back, door);
    let trapped = 0;
    let worst = null;
    for (let i = 0; i < nodes.length; i++) {
      if (forward[i] && !canFinish[i]) {
        trapped++;
        if (!worst) worst = nodes[i];
      }
    }
    if (trapped) {
      problems.push("dead end: " + trapped + " spots you can reach but not finish from, first at " +
        worst.x + "," + worst.y);
    }

    return { ok: problems.length === 0, problems };
  }

  function drawDoor(ctx, px, py, tilePx, colours) {
    const w = tilePx * 1.4;
    const h = tilePx * 2;
    const x = px + (tilePx - w) / 2;
    const y = py + tilePx - h;
    const r = w / 2;

    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = colours.ink;
    ctx.fill();

    // A lighter opening inside the frame, so it reads as a way through rather
    // than a slab standing at the end of the level.
    const iw = w * 0.6;
    const ir = iw / 2;
    const ix = x + (w - iw) / 2;
    const iy = y + tilePx * 0.22;
    ctx.beginPath();
    ctx.moveTo(ix, y + h);
    ctx.lineTo(ix, iy + ir);
    ctx.arc(ix + ir, iy + ir, ir, Math.PI, 0);
    ctx.lineTo(ix + iw, y + h);
    ctx.closePath();
    ctx.fillStyle = colours.accent;
    ctx.fill();
  }

  // Blocks are drawn as blocks: a body, a lit top face where open air touches
  // them, a seam between neighbours, and a per-tile shade that never changes for
  // a given seed. Flat silhouettes read as a wash; this reads as ground.
  // Two colours and how far between them, as a hex string canvas will take.
  // Depth is a continuum, so the rock that expresses it has to be one too:
  // bands leave a seam across the cave at every boundary, and a per-tile
  // checkerboard laid over them reads as tiling rather than as stone.
  function mix(a, b, t) {
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    let out = "#";
    for (let i = 1; i < 7; i += 2) {
      const from = parseInt(a.substr(i, 2), 16);
      const to = parseInt(b.substr(i, 2), 16);
      out += Math.round(from + (to - from) * u).toString(16).padStart(2, "0");
    }
    return out;
  }

  // The rock at a given row. Worked out once per row rather than once per tile:
  // a screen is a dozen rows and several thousand tiles, and the answer only
  // ever depends on how deep the row is.
  function rockRow(y, height, colours) {
    return mix(colours.rockTop, colours.rockBottom, y / (height - 1));
  }

  // The same ramp, for anyone outside this file who needs to tint by depth —
  // the background behind the rock has to agree with the rock, or the two read
  // as different worlds.
  function depthTint(y, height, top, bottom) {
    return mix(top, bottom, y / (height - 1));
  }

  // Gemstones in the rock face, drawn pixel by pixel inside a six by six grid.
  // Each is shaded in its own colours — a white highlight at the top left, the
  // body of the stone, a dark facet at the bottom right — so they read as cut
  // rather than as coloured dots. Hard-coded rather than drawn from the
  // palette, because these are artwork and not theme: a gem is the same gem
  // whatever colour the cave is painted.
  const GEM_TYPES = [
    // 1. Cyan diamond
    [
      { x: 1, y: 0, c: "#ffffff" }, { x: 2, y: 0, c: "#00e5ff" },
      { x: 0, y: 1, c: "#ffffff" }, { x: 1, y: 1, c: "#00e5ff" }, { x: 2, y: 1, c: "#00e5ff" }, { x: 3, y: 1, c: "#00e5ff" }, { x: 4, y: 1, c: "#00838f" },
      { x: 0, y: 2, c: "#00e5ff" }, { x: 1, y: 2, c: "#00e5ff" }, { x: 2, y: 2, c: "#00e5ff" }, { x: 3, y: 2, c: "#00e5ff" }, { x: 4, y: 2, c: "#00838f" }, { x: 5, y: 2, c: "#00838f" },
      { x: 1, y: 3, c: "#00e5ff" }, { x: 2, y: 3, c: "#00e5ff" }, { x: 3, y: 3, c: "#00838f" }, { x: 4, y: 3, c: "#00838f" },
      { x: 2, y: 4, c: "#00e5ff" }, { x: 3, y: 4, c: "#00838f" },
      { x: 3, y: 5, c: "#00838f" },
    ],
    // 2. Purple amethyst
    [
      { x: 1, y: 0, c: "#f3e5f5" },
      { x: 0, y: 1, c: "#f3e5f5" }, { x: 1, y: 1, c: "#e040fb" }, { x: 3, y: 1, c: "#f3e5f5" },
      { x: 0, y: 2, c: "#e040fb" }, { x: 1, y: 2, c: "#e040fb" }, { x: 3, y: 2, c: "#e040fb" }, { x: 4, y: 2, c: "#6a1b9a" },
      { x: 0, y: 3, c: "#e040fb" }, { x: 1, y: 3, c: "#e040fb" }, { x: 2, y: 3, c: "#6a1b9a" }, { x: 3, y: 3, c: "#e040fb" }, { x: 4, y: 3, c: "#6a1b9a" },
      { x: 1, y: 4, c: "#e040fb" }, { x: 2, y: 4, c: "#6a1b9a" }, { x: 3, y: 4, c: "#6a1b9a" }, { x: 4, y: 4, c: "#6a1b9a" },
      { x: 2, y: 5, c: "#6a1b9a" }, { x: 3, y: 5, c: "#6a1b9a" },
    ],
    // 3. Gold citrine
    [
      { x: 1, y: 0, c: "#fff59d" }, { x: 2, y: 0, c: "#ffd600" },
      { x: 0, y: 1, c: "#fff59d" }, { x: 1, y: 1, c: "#ffd600" }, { x: 2, y: 1, c: "#ffd600" }, { x: 3, y: 1, c: "#ff6f00" },
      { x: 0, y: 2, c: "#ffd600" }, { x: 1, y: 2, c: "#ffd600" }, { x: 2, y: 2, c: "#ffd600" }, { x: 3, y: 2, c: "#ff6f00" }, { x: 4, y: 2, c: "#ff6f00" },
      { x: 1, y: 3, c: "#ffd600" }, { x: 2, y: 3, c: "#ff6f00" }, { x: 3, y: 3, c: "#ff6f00" },
      { x: 2, y: 4, c: "#ff6f00" },
    ],
  ];

  const GEM_GRID = 6;

  // Depth decides both whether a tile has a gem and which kind. Nothing grows
  // in the roof rock; gold and amethyst come in through the middle caverns; and
  // the mantle is where diamond appears, alongside amethyst, and where the
  // stones are commonest. It means going deeper is worth something to look at
  // as well as to run through, and that a diamond means you went down for it.
  const GEM_SURFACE = 28; // above this, none at all
  const GEM_ABYSS = 50; // below this, the mantle
  const GEM_MID_KINDS = [2, 1]; // citrine, amethyst
  const GEM_DEEP_KINDS = [0, 1]; // diamond, amethyst
  // Per ten thousand tiles, so a third of a rate stays exact: 0.5% through the
  // middle caverns and about 1.17% in the mantle.
  const GEM_MID_RATE = 50;
  const GEM_DEEP_RATE = 117;

  // Which gem this tile has, or -1 for the great majority that have none. Its
  // own hash, unrelated to the shading one, so the gems do not land in a
  // pattern with the light — and the roll and the choice of stone are taken
  // from different ends of it, so the rarity does not decide the colour.
  function gemAt(x, y) {
    if (y < GEM_SURFACE) return -1;

    const h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0;
    const deep = y >= GEM_ABYSS;
    if (h % 10000 >= (deep ? GEM_DEEP_RATE : GEM_MID_RATE)) return -1;

    const kinds = deep ? GEM_DEEP_KINDS : GEM_MID_KINDS;
    return kinds[(h >>> 12) % kinds.length];
  }

  // A wall torch: two across and eight down, a flame sitting on a wooden stick
  // that darkens toward its base. Whole frames rather than a body and a flame
  // drawn separately, because the two frames differ only in which side of the
  // flame is the bright one — the flicker is a shimmer across it, not a shape
  // that changes.
  const TORCH_W = 2;
  const TORCH_H = 8;
  const TORCH_REACH = 3.2; // tiles of glow around each one

  const TORCH_FRAMES = [
    [
      { x: 0, y: 0, c: "#ffee58" }, { x: 1, y: 0, c: "#ff9800" },
      { x: 0, y: 1, c: "#ff5722" }, { x: 1, y: 1, c: "#d50000" },
      { x: 0, y: 2, c: "#6d4c41" }, { x: 1, y: 2, c: "#4e342e" },
      { x: 0, y: 3, c: "#5d4037" }, { x: 1, y: 3, c: "#3e2723" },
      { x: 0, y: 4, c: "#5d4037" }, { x: 1, y: 4, c: "#3e2723" },
      { x: 0, y: 5, c: "#4e342e" }, { x: 1, y: 5, c: "#3e2723" },
      { x: 0, y: 6, c: "#3e2723" }, { x: 1, y: 6, c: "#271810" },
      { x: 0, y: 7, c: "#271810" }, { x: 1, y: 7, c: "#1b1008" },
    ],
    [
      { x: 0, y: 0, c: "#ff9800" }, { x: 1, y: 0, c: "#ffee58" },
      { x: 0, y: 1, c: "#d50000" }, { x: 1, y: 1, c: "#ff5722" },
      { x: 0, y: 2, c: "#6d4c41" }, { x: 1, y: 2, c: "#4e342e" },
      { x: 0, y: 3, c: "#5d4037" }, { x: 1, y: 3, c: "#3e2723" },
      { x: 0, y: 4, c: "#5d4037" }, { x: 1, y: 4, c: "#3e2723" },
      { x: 0, y: 5, c: "#4e342e" }, { x: 1, y: 5, c: "#3e2723" },
      { x: 0, y: 6, c: "#3e2723" }, { x: 1, y: 6, c: "#271810" },
      { x: 0, y: 7, c: "#271810" }, { x: 1, y: 7, c: "#1b1008" },
    ],
  ];

  // Draws the slice of the level the camera can see. Shared by every view, so
  // the world looks the same however it is being looked at.
  //
  // `now` is seconds, and only the flames use it: everything else here is a
  // function of the level alone, so a still frame of a given seed is the same
  // picture every time whatever the clock says.
  function render(ctx, level, camera, tilePx, colours, now = 0) {
    const view = Camera.visibleTiles(camera, tilePx, level.width, level.height);
    const cap = Math.max(2, Math.round(tilePx * 0.16));
    const lip = Math.max(3, Math.round(tilePx * 0.22));
    const seam = tilePx >= 18;

    // One colour per visible row, mixed before the tile loop rather than inside
    // it.
    const rockShade = [];
    for (let y = view.y0; y <= view.y1; y++) rockShade[y] = rockRow(y, level.height, colours);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    for (let x = view.x0; x <= view.x1; x++) {
      for (let y = view.y0; y <= view.y1; y++) {
        const tile = at(level, x, y);
        if (tile === TILE.EMPTY) continue;

        const px = x * tilePx;
        const py = y * tilePx;

        if (tile === TILE.GROUND) {
          ctx.fillStyle = rockShade[y];
          ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);

          // The gem, if this tile has one. Drawn before the seam and the lit
          // face so both still read over the top of it — the stone is in front
          // of the gem at its edges, which is what embeds it in the rock rather
          // than sticking it on.
          const gem = gemAt(x, y);
          if (gem >= 0) {
            // Half a tile across, so it is a cluster in the rock face and not a
            // tile made of gemstone. Whole pixels only: a fractional pixel on a
            // pixel-art gem is a blurred gem.
            const dot = Math.max(2, Math.round(tilePx / (GEM_GRID * 2)));
            const span = dot * GEM_GRID;
            const room = Math.max(1, tilePx - span);
            const ox = ((x * 2654435761) >>> 8) % room;
            const oy = ((y * 2246822519) >>> 8) % room;

            for (const cell of GEM_TYPES[gem]) {
              ctx.fillStyle = cell.c;
              ctx.fillRect(px + ox + cell.x * dot, py + oy + cell.y * dot, dot, dot);
            }
          }

          // A seam you can find if you look for it, and not otherwise. At a
          // quarter opacity every tile was outlined and the cavern read as
          // tiling; the rock wants to be one heavy mass with joints in it.
          if (seam) {
            ctx.strokeStyle = colours.paper;
            ctx.globalAlpha = 0.06;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 0.5, py + 0.5, tilePx - 1, tilePx - 1);
            ctx.globalAlpha = 1;
          }

          // The lit face only belongs where the tile is actually exposed, and
          // it is a rim rather than a highlight: graphite a shade up from the
          // rock, not ink. Drawn in the text colour every exposed block wore a
          // white cap and the cave read as a brick wall.
          if (at(level, x, y - 1) !== TILE.GROUND) {
            ctx.fillStyle = colours.stoneRim;
            ctx.fillRect(px, py, tilePx + 0.5, cap);
          }
        } else if (tile === TILE.PLATFORM) {
          // Drawn at the top of the tile because that is where the collision
          // surface is — planked along the bottom left the player hovering a
          // whole tile above the board they were standing on.
          ctx.fillStyle = colours.stoneDeep;
          ctx.fillRect(px, py, tilePx + 0.5, lip);
          ctx.fillStyle = colours.ink;
          ctx.fillRect(px, py, tilePx + 0.5, Math.max(2, lip * 0.4));
        } else if (tile === TILE.CRUMBLE) {
          // Not drawn at all while it is away — the hole is the whole point,
          // and a ghost of the block in it would be a lie about where the
          // ground is.
          const key = y * level.width + x;
          if (level.broken && level.broken.has(key)) continue;

          // A pixel either way while it is going. Off the clock rather than off
          // a counter, so it shakes at the same rate whatever the frame rate is
          // doing, and so nothing about the simulation depends on it.
          const shake = level.shaking && level.shaking.has(key)
            ? (Math.floor(now * 34) % 2 ? 1 : -1)
            : 0;

          ctx.fillStyle = rockShade[y];
          ctx.fillRect(px + shake, py, tilePx + 0.5, tilePx + 0.5);

          // The crack. Two strokes off a diagonal rather than one, because a
          // single line reads as a seam between two blocks and a forked one
          // reads as a block that is failing. Drawn in the void the cave is
          // painted on, so it is a gap and not a marking.
          ctx.strokeStyle = colours.voidBottom;
          ctx.lineWidth = Math.max(1, Math.round(tilePx * 0.06));
          ctx.beginPath();
          ctx.moveTo(px + shake, py + tilePx * 0.34);
          ctx.lineTo(px + shake + tilePx * 0.42, py + tilePx * 0.55);
          ctx.lineTo(px + shake + tilePx, py + tilePx * 0.3);
          ctx.moveTo(px + shake + tilePx * 0.42, py + tilePx * 0.55);
          ctx.lineTo(px + shake + tilePx * 0.6, py + tilePx);
          ctx.stroke();

          if (at(level, x, y - 1) !== TILE.GROUND) {
            ctx.fillStyle = colours.stoneRim;
            ctx.fillRect(px + shake, py, tilePx + 0.5, cap);
          }
        } else if (tile === TILE.LAVA) {
          ctx.fillStyle = colours.lava;
          ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);
          // A brighter lip where it meets open air, so the surface reads.
          if (at(level, x, y - 1) !== TILE.LAVA) {
            ctx.fillStyle = colours.lavaTop;
            ctx.fillRect(px, py, tilePx + 0.5, Math.max(2, Math.round(tilePx * 0.22)));
          }
        } else if (tile === TILE.DOOR) {
          if (at(level, x, y + 1) !== TILE.DOOR) drawDoor(ctx, px, py, tilePx, colours);
        }
      }
    }

    // ---------------------------------------------------------------- torches
    //
    // Light first, over the rock rather than under it: the point of a torch
    // here is that the stone around it comes up out of the dark, and a glow
    // painted underneath the tiles lights nothing at all.
    if (level.torches) {
      const dot = Math.max(1, Math.round(tilePx / 10));
      const reach = TORCH_REACH * tilePx;

      for (const t of level.torches) {
        if (t.x < view.x0 - 3 || t.x > view.x1 + 3) continue;
        if (t.y < view.y0 - 3 || t.y > view.y1 + 3) continue;

        // Each flame keeps its own time, offset by where it is, so a corridor
        // of them flickers raggedly instead of blinking in unison.
        const beat = now * 7 + t.x * 1.7 + t.y * 2.3;
        const lick = Math.sin(beat) * 0.5 + 0.5;

        const cx = t.x * tilePx + tilePx / 2;
        const cy = t.y * tilePx + tilePx / 2;

        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        glow.addColorStop(0, "rgba(255, 175, 60, " + (0.44 + lick * 0.05).toFixed(3) + ")");
        glow.addColorStop(1, "rgba(255, 175, 60, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
      }

      // Then the brackets, over their own light.
      for (const t of level.torches) {
        if (t.x < view.x0 - 1 || t.x > view.x1 + 1) continue;
        if (t.y < view.y0 - 1 || t.y > view.y1 + 1) continue;

        const beat = now * 7 + t.x * 1.7 + t.y * 2.3;
        const frame = TORCH_FRAMES[Math.sin(beat) > 0 ? 0 : 1];

        // Hung from the top of its tile rather than centred in it. The rock
        // this is fixed to is the tile directly above, so the flame belongs
        // just under that and the stick hangs down from it — centred, the
        // torch floats in the middle of the passage attached to nothing.
        const ox = t.x * tilePx + Math.round((tilePx - TORCH_W * dot) / 2);
        const oy = t.y * tilePx + dot;

        for (const cell of frame) {
          ctx.fillStyle = cell.c;
          ctx.fillRect(ox + cell.x * dot, oy + cell.y * dot, dot, dot);
        }
      }
    }

    ctx.restore();
  }

  const GLYPHS = { 0: ".", 1: "#", 2: "=", 3: "c", 4: "D", 5: "L" };

  function toText(level) {
    const rows = [];
    for (let y = 0; y < level.height; y++) {
      let row = "";
      for (let x = 0; x < level.width; x++) row += GLYPHS[at(level, x, y)];
      rows.push(row);
    }
    return rows.join("\n");
  }

  return {
    TILE,
    RULES,
    HEIGHT,
    MODES,
    METERS_PER_TILE,
    resolveMode,
    generate,
    createTutorial,
    depthTint,
    at,
    surfaceAt,
    floorAt,
    verify,
    standable,
    movesFrom,
    render,
    toText,
    checksum,
  };
})();
