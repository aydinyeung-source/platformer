// level.js — level data, tilemap loading, spawn points, rendering

const Level = (() => {
  const TILE = {
    EMPTY: 0,
    GROUND: 1,
    PLATFORM: 2,
    SPIKE: 3,
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
    { id: "1k", label: "1000 m", meters: 1000 },
    { id: "2k", label: "2 km", meters: 2000 },
    { id: "5k", label: "5 km", meters: 5000 },
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
    return MODES.find((mode) => mode.id === id) || MODES[0];
  }

  // ---------------------------------------------------------------- carving
  //
  // The world starts as one solid block and the maze is dug out of it. Nothing
  // is "the surface": every passage has rock above it as well as below, so the
  // only way to learn what is around a corner or at the bottom of a drop is to
  // pan the camera and look. That is the whole point of the free camera.
  //
  // The shape is a graph, not a line. Cells of a coarse grid become rooms; a
  // randomised depth-first spanning tree links them, which is what guarantees
  // every room connects to every other; extra links are then laid on top of the
  // tree to close loops back into rooms already visited, and short stubs are dug
  // into the rock as true dead ends. The tree's own leaves are dead ends too.
  //
  // None of that can strand you. A branch you can walk into is one you can walk
  // back out of: horizontal passages never step more than a tile at a time and
  // every vertical link carries rungs, so down is never a one-way trip. verify()
  // then proves it independently rather than taking my word for it.

  const ROOF = 5; // never carve higher than this
  const HEADROOM = 4; // clear rows above a walking floor — enough to jump, no more
  const LEDGE_RISE = 3; // rung spacing — one plain jump
  const CELL_W = 26;
  const CELL_H = 14;
  const BAND_TOP = 7; // first row the grid may use
  const ROOM_INSET = 3; // rock kept between a room and its cell edge
  const SHAFT_W = 3;
  const LOOP_CHANCE = 0.18; // links added beyond the spanning tree

  // Carving costs a fraction of a millisecond and the audit little more, so an
  // unlucky layout is recarved from the next stream rather than special-cased.
  // The attempt number is part of the stream name, so a seed still produces the
  // same map every time — it just may not be the first one that was tried.
  function generate(seedText, options = {}) {
    const seed = Rng.keyFor(seedText);
    const mode = resolveMode(options.mode);
    const width = Math.max(120, options.width || Math.round(mode.meters / METERS_PER_TILE));

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
    const ladders = []; // rungs, laid last so nothing can dig them away
    const shafts = []; // columns a hazard must keep out of

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

    // One room per cell, sitting near the bottom of it with rock left over its
    // roof, so the rooms of one grid row never merge into the row below.
    const rooms = [];
    for (let i = 0; i < count; i++) {
      const c = colOf(i);
      const r = rowOf(i);
      const cellX = 6 + c * CELL_W;
      const cellY = BAND_TOP + r * CELL_H;
      const floorY = clamp(cellY + CELL_H - 3 + rng.int(-1, 1), CEIL_LIMIT + 2, FLOOR_LIMIT);
      const tall = rng.int(5, 8);
      rooms.push({
        index: i,
        c,
        r,
        x0: c === 0 ? 4 : cellX + ROOM_INSET,
        x1: c === cols - 1 ? width - 5 : cellX + CELL_W - ROOM_INSET - 1,
        floorY,
        top: Math.max(ROOF, floorY - tall),
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
    // rooms; these are the links that let a passage come back around into
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

    // --------------------------------------------------------- the carving
    function carveRoom(room) {
      for (let x = room.x0; x <= room.x1; x++) {
        for (let y = room.top; y < room.floorY; y++) dig(x, y);
      }
      places.push({ type: "chamber", x0: room.x0, x1: room.x1, floorY: room.floorY, top: room.top });
    }

    // A winding passage. It never rises or drops more than one row per column,
    // so every step of it is a plain walk; the wander is what makes it an S
    // rather than a line. Where it crosses something already dug, the floor it
    // needs is laid as a one-way platform instead of rock, so the passage
    // underneath stays open and the crossing becomes a junction.
    function tunnel(fromX, fromY, toX, toY, wander) {
      const step = fromX <= toX ? 1 : -1;
      const span = Math.abs(toX - fromX) + 1;
      let y = fromY;
      let want = fromY;
      let segX = fromX;
      let segY = fromY;

      const closeSegment = (x, floorY) => {
        if (Math.abs(x - segX) >= 6) {
          places.push({ type: "corridor", x0: Math.min(segX, x), x1: Math.max(segX, x), floorY });
        }
        segX = x;
      };

      for (let i = 0; i < span; i++) {
        const x = fromX + i * step;
        const left = span - i;
        // Hold the line home: once only just enough columns remain to close the
        // gap a row at a time, stop wandering and converge.
        if (left <= Math.abs(y - toY) + 2) {
          want = toY;
        } else if (i % 5 === 0) {
          const base = fromY + Math.round((toY - fromY) * (i / Math.max(1, span - 1)));
          want = clamp(base + rng.int(-wander, wander), CEIL_LIMIT, FLOOR_LIMIT);
        }

        if (y < want) y++;
        else if (y > want) y--;
        if (y !== segY) {
          closeSegment(x, segY);
          segY = y;
        }

        for (let cy = y - HEADROOM; cy < y; cy++) dig(x, cy);
        if (peek(x, y) !== TILE.GROUND) put(x, y, TILE.PLATFORM);
      }

      closeSegment(toX, y);
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

      const rungs = [];
      let side = 0;
      for (let y = top + LEDGE_RISE; y <= bottom - LEDGE_RISE; y += LEDGE_RISE) {
        rungs.push({ x: side ? x : x + w - 2, y });
        side = side ? 0 : 1;
      }
      // The last step onto the floor has to be a jump like all the others.
      const lowest = rungs.length ? rungs[rungs.length - 1].y : top;
      if (bottom - lowest > LEDGE_RISE) rungs.push({ x, y: bottom - LEDGE_RISE });

      for (const rung of rungs) ladders.push(rung);
      shafts.push({ x0: x, x1: x + w - 1 });
      places.push({ type: "shaft", x0: x, x1: x + w - 1, fromY, toY, rungs });
    }

    // A column of lava standing in a passage. Narrow enough to jump, tall
    // enough that walking into it is a decision you made. Clearing it means
    // lifting your feet above it while your head stays under the ceiling, so
    // two tiles is the most the headroom leaves, and the pocket cut above makes
    // sure the arc is not clipped short into it.
    function lavaColumn(x, w, floorY) {
      const tall = detail.int(1, 2);
      for (let cx = x - 4; cx <= x + w + 4; cx++) {
        dig(cx, floorY - HEADROOM - 1);
        dig(cx, floorY - HEADROOM - 2);
      }
      for (let cx = x; cx < x + w; cx++) {
        for (let y = floorY - tall; y <= floorY; y++) put(cx, y, TILE.LAVA);
      }
      places.push({ type: "column", x0: x, x1: x + w - 1, floorY });
    }

    // A hole in the floor with lava at the bottom. Only ever sunk through
    // untouched rock — punched into a passage below, the pool would sit in the
    // middle of that passage and cut it in two — so it takes whatever depth the
    // rock allows and gives up if that is not deep enough to read as a hole.
    function lavaHole(x, w, floorY) {
      const want = Math.min(FLOOR_LIMIT, floorY + detail.int(6, 14));
      const solidRow = (y) => {
        for (let cx = x; cx < x + w; cx++) if (peek(cx, y) !== TILE.GROUND) return false;
        return true;
      };

      let bottom = floorY;
      while (bottom < want && solidRow(bottom + 1)) bottom++;
      if (!solidRow(floorY) || bottom - floorY < 5) return false;

      for (let cx = x; cx < x + w; cx++) {
        for (let y = floorY; y < bottom; y++) dig(cx, y);
        for (let y = bottom - 3; y < bottom; y++) put(cx, y, TILE.LAVA);
      }
      places.push({ type: "lava", x0: x, x1: x + w - 1, floorY, bottom });
      return true;
    }

    for (const room of rooms) carveRoom(room);

    // The spawn pocket and the door are cut last, but their columns are spoken
    // for now, so no shaft is ever sunk through the floor the run starts on or
    // the one it ends on.
    const home = rooms[startCell];
    const exit = rooms[endCell];
    const spawnX = home.x0 + 2;
    const doorX = Math.min(width - 4, exit.x1 - 2);

    const shaftRange = (room) => {
      let lo = room.x0 + 1;
      let hi = room.x1 - SHAFT_W - 1;
      if (room === home) lo = Math.max(lo, spawnX + 6);
      if (room === exit) hi = Math.min(hi, doorX - 6);
      return { lo, hi };
    };

    for (const k of linked) {
      const parts = k.split("|");
      const a = rooms[Number(parts[0])];
      const b = rooms[Number(parts[1])];

      if (a.r === b.r) {
        const left = a.c < b.c ? a : b;
        const right = a.c < b.c ? b : a;
        tunnel(left.x1, left.floorY, right.x0, right.floorY, rng.int(2, 5));
      } else {
        const above = a.r < b.r ? a : b;
        const below = a.r < b.r ? b : a;
        const up = shaftRange(above);
        const down = shaftRange(below);
        const lo = Math.max(up.lo, down.lo);
        const hi = Math.min(up.hi, down.hi);
        if (hi < lo) continue;
        shaft(rng.int(lo, hi), SHAFT_W, below.floorY, above.floorY);
      }
    }

    // ------------------------------------------------------------ dead ends
    // Passages that go nowhere, so that finding the way through is a matter of
    // scouting rather than following the only corridor there is.
    let stubs = 0;
    const wanted = Math.max(3, Math.round(count * 0.35));
    for (let i = 0; i < wanted; i++) {
      const room = rooms[rng.int(0, rooms.length - 1)];

      if (rng.chance(0.55)) {
        // Sideways into the rock. If it happens to break into something else it
        // is a shortcut instead, which is no loss.
        const dir = rng.chance(0.5) ? -1 : 1;
        const fromX = dir < 0 ? room.x0 : room.x1;
        const target = clamp(fromX + dir * rng.int(9, 24), 3, width - 4);
        if (Math.abs(target - fromX) < 8) continue;
        tunnel(fromX, room.floorY, target, room.floorY, rng.int(2, 4));
        stubs++;
      } else {
        // A pocket underneath, rungs and all: a drop worth looking down before
        // taking, never one that keeps you.
        const range = shaftRange(room);
        if (range.hi < range.lo) continue;
        const sx = rng.int(range.lo, range.hi);
        const bottom = clamp(room.floorY + rng.int(7, 15), room.floorY + 7, FLOOR_LIMIT);
        if (bottom <= room.floorY + 6) continue;
        shaft(sx, SHAFT_W, bottom, room.floorY);
        const x0 = sx - rng.int(3, 8);
        const x1 = sx + SHAFT_W + rng.int(3, 8);
        for (let x = x0; x <= x1; x++) {
          for (let y = bottom - HEADROOM; y < bottom; y++) dig(x, y);
          if (peek(x, bottom) !== TILE.GROUND) put(x, bottom, TILE.PLATFORM);
        }
        places.push({ type: "corridor", x0, x1, floorY: bottom });
        stubs++;
      }
    }

    // -------------------------------------------------------- spawn and door
    // Cut clear, so the run can never begin inside rock or end at a door
    // standing in mid-air.
    for (let x = spawnX - 2; x <= spawnX + 4; x++) {
      for (let y = home.floorY - HEADROOM; y < home.floorY; y++) dig(x, y);
      if (peek(x, home.floorY) !== TILE.GROUND) put(x, home.floorY, TILE.GROUND);
    }
    const spawn = { x: spawnX, y: home.floorY - 1 };

    for (let x = doorX - 3; x <= doorX + 2; x++) {
      for (let y = exit.floorY - HEADROOM; y < exit.floorY; y++) dig(x, y);
      if (peek(x, exit.floorY) !== TILE.GROUND) put(x, exit.floorY, TILE.GROUND);
    }
    put(doorX, exit.floorY - 1, TILE.DOOR);
    put(doorX, exit.floorY - 2, TILE.DOOR);
    const goal = { x: doorX, y: exit.floorY - 1 };

    // --------------------------------------------------------------- hazards
    let spikes = 0;
    let columns = 0;
    let pools = 0;
    // Somewhere along this floor with clear ground either side and no ladder
    // underneath it. Lava is not a place you can stand, so a pool poured over a
    // rung breaks the climb it belongs to.
    const spotIn = (place, w) => {
      const lo = place.x0 + 4;
      const hi = place.x1 - 4 - w;
      if (hi < lo) return -1;
      for (let tries = 0; tries < 8; tries++) {
        const at0 = detail.int(lo, hi);
        if (!shafts.some((s) => at0 + w + 2 >= s.x0 && at0 - 2 <= s.x1)) return at0;
      }
      return -1;
    };

    for (const place of places) {
      if (place.type !== "corridor" && place.type !== "chamber") continue;
      if (place.x1 - place.x0 < 13) continue;
      if (place.floorY <= CEIL_LIMIT + 1) continue;

      const roll = detail.int(0, 99);

      if (roll < 15) {
        const w = detail.int(1, 2);
        const at0 = spotIn(place, w);
        if (at0 < 0) continue;
        lavaColumn(at0, w, place.floorY);
        columns++;
      } else if (roll < 30) {
        const w = detail.int(2, 3);
        const at0 = spotIn(place, w);
        if (at0 < 0) continue;
        if (lavaHole(at0, w, place.floorY)) pools++;
      } else if (roll < 41) {
        // A spike needs room to be jumped. Cut an extra row of ceiling over it
        // and its run-up, so the arc is not clipped short and dropped onto the
        // points — a spike you cannot clear is a wall the audit would not see.
        const run = detail.int(1, 2);
        const at0 = spotIn(place, run);
        if (at0 < 0) continue;
        for (let cx = at0 - 4; cx <= at0 + run + 4; cx++) {
          dig(cx, place.floorY - HEADROOM - 1);
          dig(cx, place.floorY - HEADROOM - 2);
        }
        for (let i = 0; i < run; i++) {
          if (peek(at0 + i, place.floorY) !== TILE.GROUND) continue;
          put(at0 + i, place.floorY - 1, TILE.SPIKE);
          spikes++;
        }
      }
    }

    // ---------------------------------------------------------- the ladders
    // Laid last and over the top of everything, because a shaft without its
    // rungs is a one-way drop.
    // Nothing is cleared above them: the space inside a shaft is already open,
    // hazards are kept off these columns, and a passage crossing a shaft leaves
    // only one-way platforms, which are something to stand on rather than
    // something in the way. Clearing anyway would rub out the rung above.
    for (const rung of ladders) {
      put(rung.x, rung.y, TILE.PLATFORM);
      put(rung.x + 1, rung.y, TILE.PLATFORM);
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
      links: Array.from(linked, (k) => k.split("|").map(Number)),
      rules: RULES,
      tally: {
        spikes,
        columns,
        pools,
        stubs,
        loops,
        rooms: count,
        links: linked.size,
        places: places.length,
      },
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
    return tile !== TILE.GROUND && tile !== TILE.LAVA;
  }

  // Can the player stand here: something solid underfoot, room for the body.
  // Not on a spike — a patch of them has to be jumped, which is what makes the
  // audit check that jumping it is possible rather than walking through.
  function standable(level, x, y) {
    if (at(level, x, y) === TILE.SPIKE) return false;
    const under = at(level, x, y + 1);
    if (under !== TILE.GROUND && under !== TILE.PLATFORM) return false;
    return open(level, x, y) && open(level, x, y - 1);
  }

  // Every move the player can make from a standing spot, using the measured
  // envelope in RULES. Deliberately conservative: anything listed here is
  // something the physics can definitely do.
  function movesFrom(level, x, y, visit) {
    const reach = level.rules.reach;

    for (const dx of [-1, 1]) {
      for (const dy of [0, -1]) if (standable(level, x + dx, y + dy)) visit(x + dx, y + dy);
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
  function shade(x, y) {
    const h = (x * 73856093) ^ (y * 19349663);
    return ((h >>> 3) & 7) < 3;
  }

  // Draws the slice of the level the camera can see. Shared by every view, so
  // the world looks the same however it is being looked at.
  function render(ctx, level, camera, tilePx, colours) {
    const view = Camera.visibleTiles(camera, tilePx, level.width, level.height);
    const cap = Math.max(2, Math.round(tilePx * 0.16));
    const lip = Math.max(3, Math.round(tilePx * 0.22));
    const seam = tilePx >= 18;

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    for (let x = view.x0; x <= view.x1; x++) {
      for (let y = view.y0; y <= view.y1; y++) {
        const tile = at(level, x, y);
        if (tile === TILE.EMPTY) continue;

        const px = x * tilePx;
        const py = y * tilePx;

        if (tile === TILE.GROUND) {
          ctx.fillStyle = shade(x, y) ? colours.stoneDeep : colours.stone;
          ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);

          if (seam) {
            ctx.strokeStyle = colours.paper;
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 0.5, py + 0.5, tilePx - 1, tilePx - 1);
            ctx.globalAlpha = 1;
          }

          // The lit face only belongs where the tile is actually exposed.
          if (at(level, x, y - 1) !== TILE.GROUND) {
            ctx.fillStyle = colours.ink;
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
        } else if (tile === TILE.SPIKE) {
          ctx.fillStyle = colours.ink;
          ctx.beginPath();
          ctx.moveTo(px + 1, py + tilePx);
          ctx.lineTo(px + tilePx / 2, py + tilePx * 0.15);
          ctx.lineTo(px + tilePx - 1, py + tilePx);
          ctx.closePath();
          ctx.fill();
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

    ctx.restore();
  }

  const GLYPHS = { 0: ".", 1: "#", 2: "=", 3: "^", 4: "D", 5: "L" };

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
