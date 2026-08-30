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

  const SPAWN_PAD = 8;
  const OUTRO_PAD = 12;

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
  // The world starts as one solid block and the route is dug out of it. That is
  // the opposite of the old heightmap: nothing is "the surface" until something
  // is carved open to the sky, so a passage can run over, under or through
  // anything else without the generator needing a special case for it.

  const SKY = 26; // carve above this and daylight gets in
  const ROOF = 6; // never carve higher than this
  const DEEP = HEIGHT - 8;
  const HEADROOM = 5; // clear rows above a walking floor
  const LEDGE_RISE = 3; // rung spacing — one plain jump

  function generate(seedText, options = {}) {
    const seed = Rng.keyFor(seedText);
    const mode = resolveMode(options.mode);
    const width = Math.max(120, options.width || Math.round(mode.meters / METERS_PER_TILE));
    const height = HEIGHT;
    const rng = Rng.forSeed(seed, "carve");
    const detail = Rng.forSeed(seed, "detail");

    const tiles = new Uint8Array(width * height).fill(TILE.GROUND);
    const protectedCells = new Uint8Array(width * height); // tube shells, kept solid
    const places = [];

    const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
    const put = (x, y, tile) => {
      if (inside(x, y)) tiles[y * width + x] = tile;
    };
    const peek = (x, y) => (inside(x, y) ? tiles[y * width + x] : TILE.GROUND);
    const dig = (x, y) => {
      if (inside(x, y)) tiles[y * width + x] = TILE.EMPTY;
    };
    const shield = (x, y) => {
      if (inside(x, y)) protectedCells[y * width + x] = 1;
    };

    // A walkable run: floor stays solid, the space above it does not.
    function corridor(x0, x1, floorY, tag) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        for (let y = floorY - HEADROOM; y < floorY; y++) dig(x, y);
      }
      places.push({ type: tag || "corridor", x0: Math.min(x0, x1), x1: Math.max(x0, x1), floorY });
    }

    // A pipe with rock above as well as below. Where the ground around it is
    // later opened to the sky, this is what is left standing: a tube in the air.
    function tube(x0, x1, floorY) {
      for (let x = x0; x <= x1; x++) {
        // Only the roof and the underside are held solid. Shielding the ends too
        // would wall the pipe shut against whatever is dug next to it.
        for (let y = floorY - HEADROOM - 2; y < floorY - HEADROOM; y++) shield(x, y);
        shield(x, floorY);
        shield(x, floorY + 1);
        for (let y = floorY - HEADROOM; y < floorY; y++) put(x, y, TILE.EMPTY);
      }
      places.push({ type: "tube", x0, x1, floorY });
    }

    // A room. Ledges inside it are what make the far side reachable when the way
    // out is higher than the way in.
    function chamber(x0, x1, floorY, tall) {
      const top = Math.max(ROOF, floorY - tall);
      for (let x = x0; x <= x1; x++) for (let y = top; y < floorY; y++) dig(x, y);

      let ledgeY = floorY - LEDGE_RISE;
      let side = 0;
      while (ledgeY > top + 1) {
        const span = rng.int(3, 6);
        const lx = side ? x0 + 1 : x1 - span;
        for (let i = 0; i < span; i++) put(lx + i, ledgeY, TILE.PLATFORM);
        ledgeY -= LEDGE_RISE;
        side = side ? 0 : 1;
      }

      places.push({ type: "chamber", x0, x1, floorY, top });
    }

    // Vertical link. Going down needs nothing; going up needs rungs, spaced so
    // every step of the climb is a plain jump.
    function shaft(x, w, fromY, toY) {
      const top = Math.min(fromY, toY);
      const bottom = Math.max(fromY, toY);
      for (let cx = x; cx < x + w; cx++) {
        for (let y = top - HEADROOM; y < bottom; y++) dig(cx, y);
      }

      const rungs = [];
      if (toY < fromY) {
        let side = 0;
        for (let y = toY + LEDGE_RISE; y <= fromY - LEDGE_RISE; y += LEDGE_RISE) {
          const lx = side ? x : x + w - 2;
          put(lx, y, TILE.PLATFORM);
          put(lx + 1, y, TILE.PLATFORM);
          rungs.push({ x: lx, y });
          side = side ? 0 : 1;
        }
        const lowest = rungs.length ? rungs[rungs.length - 1].y : toY;
        if (fromY - lowest > LEDGE_RISE) {
          put(x, fromY - LEDGE_RISE, TILE.PLATFORM);
          put(x + 1, fromY - LEDGE_RISE, TILE.PLATFORM);
          rungs.push({ x, y: fromY - LEDGE_RISE });
        }
      }

      places.push({ type: toY < fromY ? "climb" : "drop", x0: x, x1: x + w - 1, fromY, toY, rungs });
    }

    // A hole in a corridor floor. Shallow enough to climb out of, narrow enough
    // to jump, so it is a decision rather than a punishment.
    function pit(x, w, floorY) {
      for (let cx = x; cx < x + w; cx++) {
        for (let y = floorY; y < floorY + rng.int(2, 3); y++) dig(cx, y);
      }
    }

    // ------------------------------------------------------------ the route
    //
    // One continuous walk from the spawn to the door. Every link is inside the
    // movement envelope, so the way through exists by construction; verify()
    // then proves it independently rather than taking my word for it.

    let x = 0;
    let y = 16;
    const outdoor = [];

    const runOut = (len, tag) => {
      const to = Math.min(width - 1, x + len);
      corridor(x, to, y, tag);
      if (y <= SKY) outdoor.push({ x0: x, x1: to, floorY: y });
      x = to;
    };

    runOut(SPAWN_PAD + 6, "spawn");
    const spawn = { x: 3, y: y - 1 };

    while (x < width - OUTRO_PAD - 12) {
      const room = width - OUTRO_PAD - x;
      let kind = rng.weighted([
        { value: "run", weight: 22 },
        { value: "pit", weight: 14 },
        { value: "chamber", weight: 16 },
        { value: "under", weight: 18 },
        { value: "climb", weight: 14 },
        { value: "tube", weight: 12 },
        { value: "back", weight: 14 },
      ]);

      if (room < 40) kind = "run";

      if (kind === "run") {
        const step = rng.int(-2, RULES.maxStepUp);
        y = Math.max(ROOF + HEADROOM, Math.min(DEEP, y - step));
        runOut(rng.int(10, 26));
      } else if (kind === "pit") {
        runOut(rng.int(4, 8));
        pit(x - rng.int(3, 6), rng.int(2, 4), y);
        runOut(rng.int(6, 12));
      } else if (kind === "chamber") {
        // A room you cross, sometimes leaving higher than you came in.
        const wide = rng.int(14, 30);
        const tall = rng.int(7, 13);
        chamber(x, x + wide, y, tall);
        if (y <= SKY) outdoor.push({ x0: x, x1: x + wide, floorY: y });
        x += wide;
        if (rng.chance(0.45)) y = Math.max(ROOF + HEADROOM, y - rng.int(3, tall - 3));
        runOut(rng.int(6, 14));
      } else if (kind === "under") {
        // Down a shaft, then back the way you came but underneath it, and up
        // again further on. The passage runs beneath ground you have walked.
        const depth = rng.int(8, 18);
        const below = Math.min(DEEP, y + depth);
        const back = rng.int(10, 26);
        const forward = rng.int(24, 48);

        shaft(x, 3, y, below);
        corridor(Math.max(4, x - back), x + 3, below, "under");
        corridor(Math.max(4, x - back), Math.min(width - 1, x + forward), below, "under");
        x = Math.min(width - 1, x + forward);
        shaft(x, 3, below, y);
        runOut(rng.int(8, 18));
      } else if (kind === "climb") {
        const rise = rng.int(6, 14);
        const above = Math.max(ROOF + HEADROOM, y - rise);
        shaft(x, 3, y, above);
        y = above;
        x += 3;
        runOut(rng.int(10, 24));
      } else if (kind === "tube") {
        // An enclosed pipe with open ground either side of it, so it reads as
        // something you are inside rather than something you are on.
        const len = rng.int(16, 34);
        const to = Math.min(width - 1, x + len);
        tube(x, to, y);
        x = to;
        runOut(rng.int(6, 14));
      } else {
        // Forced backtrack: the way forward at this level is simply not dug, so
        // the only way on is back the way you came and down.
        const back = rng.int(12, 26);
        const below = Math.min(DEEP, y + rng.int(6, 12));
        const from = Math.max(4, x - back);

        // One roll, used twice. Rolling twice leaves the corridor ending at one
        // distance and the walk resuming at another, with raw rock between them.
        const onward = rng.int(20, 40);

        corridor(from, x, y);
        shaft(from, 3, y, below);
        corridor(from, Math.min(width - 1, x + onward), below, "under");
        x = Math.min(width - 1, x + onward);
        y = below;
        runOut(rng.int(6, 16));
      }
    }

    // Outro and the door.
    runOut(width - 1 - x, "outro");
    const doorX = width - 6;
    put(doorX, y - 1, TILE.DOOR);
    put(doorX, y - 2, TILE.DOOR);
    const goal = { x: doorX, y: y - 1 };

    // ------------------------------------------------------------- daylight
    // Anything running near the top gets its sky opened. Tube shells are
    // protected, so a tube left standing in the open is exactly that.
    // Protection applies here and only here: a shield stops daylight removing a
    // tube, but must never stop the route being dug through it.
    for (const run of outdoor) {
      for (let cx = run.x0; cx <= run.x1; cx++) {
        for (let cy = run.floorY - HEADROOM - 1; cy >= 0; cy--) {
          if (!protectedCells[cy * width + cx]) dig(cx, cy);
        }
      }
    }

    // -------------------------------------------------------------- hazards
    let spikes = 0;
    for (const place of places) {
      if (place.type !== "corridor" && place.type !== "under") continue;
      if (place.x1 - place.x0 < 12 || !detail.chance(0.45)) continue;
      const at0 = detail.int(place.x0 + 4, place.x1 - 4);
      const run = detail.int(1, 3);
      for (let i = 0; i < run; i++) {
        if (peek(at0 + i, place.floorY) !== TILE.GROUND) continue;
        put(at0 + i, place.floorY - 1, TILE.SPIKE);
        spikes++;
      }
    }

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
      rules: RULES,
      tally: { spikes, rooms: places.filter((p) => p.type === "chamber").length, places: places.length },
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
  // Can the player stand here: something solid underfoot, room for the body.
  function standable(level, x, y) {
    const under = at(level, x, y + 1);
    if (under !== TILE.GROUND && under !== TILE.PLATFORM) return false;
    return at(level, x, y) !== TILE.GROUND && at(level, x, y - 1) !== TILE.GROUND;
  }

  // Only rock blocks. A one-way shelf is something you rise through and land on.
  function open(level, x, y) {
    return x >= 0 && x < level.width && y >= 0 && y < level.height && at(level, x, y) !== TILE.GROUND;
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
    render,
    toText,
    checksum,
  };
})();
