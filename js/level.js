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
    maxGap: 4,
    maxStepUp: 3,
    maxWallClimb: 9, // with a face to bounce off, a climb can be far taller
    maxStepDown: 4,
    landing: 3,
    runUp: 3,
  };

  // Deep. The surface is only the top of the world: below it there is room for
  // galleries, and room left over for whatever gets dug later.
  const HEIGHT = 72;
  const METERS_PER_TILE = 1;

  // The run is the goal: cross this far to the right and the flag is yours.
  const MODES = [
    { id: "1k", label: "1000 m", meters: 1000 },
    { id: "2k", label: "2 km", meters: 2000 },
    { id: "5k", label: "5 km", meters: 5000 },
    { id: "10k", label: "10 km", meters: 10000 },
  ];

  // Difficulty ramps across the opening stretch and then holds, so a 10 km run
  // is not still introducing gaps at the 8 km mark.
  const RAMP_DISTANCE = 1200;

  // Ground stays in a band: wild elevation swings make a level that reads as
  // noise on a map and plays as a staircase.
  const MIN_GROUND = 8;
  const MAX_GROUND = 17;
  const FLOOR_LIMIT = 26; // surface chasms stay near the surface
  const CAVE_TOP = 34; // galleries start well below anything the surface digs
  const CAVE_LIMIT = HEIGHT - 8;
  const LAVA_DEPTH = 3; // how deep a pool sits at the floor of the world
  const CHUTE_DROP = 14; // how far below the lip lava rises in a shaft with no way out
  const HEADROOM = 5; // carved clearance above a gallery floor
  const LEDGE_RISE = 3; // vertical spacing of chimney ledges — one plain jump
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

  function generate(seedText, options = {}) {
    const seed = Rng.keyFor(seedText);
    const mode = resolveMode(options.mode);
    const width = Math.max(60, options.width || Math.round(mode.meters / METERS_PER_TILE));
    const height = HEIGHT;

    const layout = Rng.forSeed(seed, "layout");
    const caves = Rng.forSeed(seed, "caves");

    const tiles = new Uint8Array(width * height);
    const segments = [];

    const set = (x, y, tile) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      tiles[y * width + x] = tile;
    };
    // The surface profile is kept as the caves are cut from underneath it.
    const surface = new Int16Array(width).fill(-1);
    const column = (x, top) => {
      if (x >= 0 && x < width) surface[x] = top;
      for (let y = top; y < height; y++) set(x, y, TILE.GROUND);
    };

    let groundY = 13;
    let x = 0;

    // Spawn pad is always flat, so the first jump is never a surprise.
    for (; x < SPAWN_PAD; x++) column(x, groundY);
    const spawn = { x: 3, y: groundY - 1 };

    let sinceHazard = 2;

    while (x < width - OUTRO_PAD) {
      const t = Math.min(1, x / Math.min(width, RAMP_DISTANCE)); // difficulty ramp
      const room = width - OUTRO_PAD - x;
      const before = x;

      let kind = layout.weighted([
        { value: "flat", weight: 24 - t * 10 },
        { value: "gap", weight: 18 + t * 16 },
        { value: "step", weight: 16 },
        { value: "platform", weight: 12 + t * 8 },
        { value: "staircase", weight: 7 + t * 6 },
        { value: "stones", weight: 5 + t * 13 },
        { value: "pillars", weight: 4 + t * 11 },
        { value: "chasm", weight: t > 0.15 ? 6 + t * 9 : 0 },
        { value: "tower", weight: t > 0.2 ? 5 + t * 9 : 0 },
        { value: "shaft", weight: t > 0.25 ? 4 + t * 9 : 0 },
        { value: "spikes", weight: sinceHazard < 2 ? 0 : 6 + t * 14 },
      ]);

      if (kind === "gap" && room < RULES.maxGap + RULES.landing) kind = "flat";
      if (kind === "spikes" && room < RULES.runUp * 2 + 3) kind = "flat";
      if (kind === "platform" && room < 8) kind = "flat";
      if (kind === "staircase" && room < 16) kind = "flat";
      if (kind === "stones" && room < 24) kind = "flat";
      if (kind === "pillars" && room < 22) kind = "flat";
      if (kind === "chasm" && room < 30) kind = "flat";
      if (kind === "tower" && (room < 16 || groundY - MIN_GROUND < 5)) kind = "flat";
      if (kind === "shaft" && room < 14) kind = "flat";

      if (kind === "flat") {
        const len = Math.min(layout.int(3, 6), room);
        for (let i = 0; i < len; i++) column(x++, groundY);
        segments.push({ type: "flat", x: before, len, groundY });
        sinceHazard++;
      } else if (kind === "gap") {
        const maxWidth = Math.min(RULES.maxGap, 2 + Math.round(t * 2));
        const gapWidth = layout.int(2, maxWidth);
        const gapStart = x;

        // Wide gaps get a stepping stone so the jump stays inside the envelope.
        const stone = gapWidth >= 3 && layout.chance(0.45);
        if (stone) {
          const stoneX = gapStart + Math.floor(gapWidth / 2);
          set(stoneX, groundY - 3, TILE.PLATFORM);
          set(stoneX - 1, groundY - 3, TILE.PLATFORM);
        }

        x += gapWidth;
        for (let i = 0; i < RULES.landing; i++) column(x++, groundY);
        segments.push({ type: "gap", x: gapStart, len: gapWidth, groundY, stone });
        sinceHazard++;
      } else if (kind === "step") {
        const up = groundY > MIN_GROUND + 2 && (groundY >= MAX_GROUND - 1 || layout.chance(0.5));
        const rise = layout.int(1, up ? RULES.maxStepUp : RULES.maxStepDown);
        groundY = up
          ? Math.max(MIN_GROUND, groundY - rise)
          : Math.min(MAX_GROUND, groundY + rise);

        const len = Math.min(layout.int(3, 6), room);
        for (let i = 0; i < len; i++) column(x++, groundY);
        segments.push({ type: "step", x: before, len, groundY, up });
        sinceHazard++;
      } else if (kind === "platform") {
        const len = Math.min(layout.int(5, 8), room);
        for (let i = 0; i < len; i++) column(x++, groundY);

        // Shelves sit exactly one jump above whatever you stand on, so every
        // shelf — and every coin on it — is reachable without a running start.
        const shelfLen = Math.min(layout.int(3, 5), len - 1);
        const shelfY = groundY - RULES.maxStepUp;
        const shelfX = before + 1;
        for (let i = 0; i < shelfLen; i++) set(shelfX + i, shelfY, TILE.PLATFORM);

        const segment = { type: "platform", x: before, len, groundY, shelfX, shelfY, shelfLen };

        if (shelfY - RULES.maxStepUp >= 3 && layout.chance(0.35)) {
          const upperLen = Math.min(layout.int(2, 3), shelfLen);
          segment.upperLen = upperLen;
          segment.upperY = shelfY - RULES.maxStepUp;
          segment.upperX = shelfX + layout.int(0, Math.max(0, shelfLen - upperLen));
          for (let i = 0; i < upperLen; i++) {
            set(segment.upperX + i, segment.upperY, TILE.PLATFORM);
          }
        }

        segments.push(segment);
        sinceHazard++;
      } else if (kind === "staircase") {
        // A run of short steps: the same climb as one big one, but readable, and
        // it gives the level a shape other than flat-gap-flat.
        const steps = layout.int(2, 4);
        const up = groundY > MIN_GROUND + 3 && (groundY >= MAX_GROUND - 2 || layout.chance(0.55));

        for (let s = 0; s < steps && x < width - OUTRO_PAD - 4; s++) {
          const rise = layout.int(1, 2);
          groundY = up
            ? Math.max(MIN_GROUND, groundY - rise)
            : Math.min(MAX_GROUND, groundY + rise);
          const tread = layout.int(2, 3);
          for (let i = 0; i < tread; i++) column(x++, groundY);
        }

        segments.push({ type: "staircase", x: before, len: x - before, groundY, up });
        sinceHazard++;
      } else if (kind === "stones") {
        // A pit crossed on floating stones. Every hop stays inside the movement
        // envelope, so it reads as dangerous while staying honestly crossable.
        // Stones sit three tiles wide on one consistent line. Narrow stones at
        // varying heights read as a fair crossing on paper and play as a coin
        // flip: a running jump covers six tiles, so the landing has to forgive
        // an overshoot.
        const hops = 2;
        // One tile above the takeoff, never more: clearing a gap and a climb in
        // the same jump is far harder than either alone, and RULES check them
        // only separately.
        const top = groundY - 1;

        for (let h = 0; h < hops && x < width - OUTRO_PAD - 10; h++) {
          x += layout.int(2, 3);
          for (let i = 0; i < 3; i++) set(x + i, top, TILE.PLATFORM);
          x += 3;
        }

        x += layout.int(2, 3);
        for (let i = 0; i < RULES.landing; i++) column(x++, groundY);

        segments.push({ type: "stones", x: before, len: x - before, groundY });
        sinceHazard++;
      } else if (kind === "tower") {
        // A face too tall to jump. You get up it by bouncing off the wall, and
        // the far side is a drop — falling costs nothing, so down is free.
        const rise = Math.min(layout.int(5, RULES.maxWallClimb), groundY - MIN_GROUND);
        const topY = groundY - rise;
        const plateau = layout.int(4, 8);
        for (let i = 0; i < plateau; i++) column(x++, topY);

        groundY = Math.min(MAX_GROUND, topY + layout.int(3, 7));
        for (let i = 0; i < layout.int(3, 5); i++) column(x++, groundY);

        segments.push({ type: "tower", x: before, len: x - before, groundY, topY, rise });
        sinceHazard++;
      } else if (kind === "shaft") {
        // A slot with a wall on both sides: you drop in and climb out, and the
        // way out is higher than the way in. Down, then up, then on.
        const depth = layout.int(4, 7);
        const floorY = Math.min(FLOOR_LIMIT, groundY + depth);
        const slot = layout.int(2, 3);
        for (let i = 0; i < slot; i++) column(x++, floorY);

        groundY = Math.max(MIN_GROUND, groundY - layout.int(0, 2));
        for (let i = 0; i < layout.int(3, 5); i++) column(x++, groundY);

        segments.push({ type: "shaft", x: before, len: x - before, groundY, floorY });
        sinceHazard++;
      } else if (kind === "chasm") {
        // A hole that goes sideways: you drop in, run along the bottom, and
        // climb back out. The way up is built from the same steps the surface
        // uses, so you can fall in but never be stuck in.
        const floorY = Math.min(FLOOR_LIMIT, groundY + layout.int(4, 7));
        const runLen = layout.int(6, 12);

        for (let i = 0; i < runLen; i++) column(x++, floorY);

        let climbY = floorY;
        while (climbY > groundY) {
          climbY = Math.max(groundY, climbY - layout.int(2, RULES.maxStepUp));
          const tread = layout.int(2, 3);
          for (let i = 0; i < tread; i++) column(x++, climbY);
        }

        for (let i = 0; i < RULES.landing; i++) column(x++, groundY);
        segments.push({ type: "chasm", x: before, len: x - before, groundY, floorY });
        sinceHazard++;
      } else if (kind === "pillars") {
        // Chunks of raised ground with pits between them — the same jump as a
        // gap, but you land somewhere with an edge on both sides.
        const count = layout.int(2, 4);

        for (let p = 0; p < count && x < width - OUTRO_PAD - 8; p++) {
          x += layout.int(2, 3);
          const top = Math.max(MIN_GROUND, groundY - layout.int(0, 1));
          const wide = layout.int(2, 3); // wide enough to land on at running speed
          for (let i = 0; i < wide; i++) column(x++, top);
        }

        x += layout.int(2, 3);
        for (let i = 0; i < RULES.landing; i++) column(x++, groundY);

        segments.push({ type: "pillars", x: before, len: x - before, groundY });
        sinceHazard++;
      } else {
        // Hazards always get a flat run-up and a flat landing — the jump is
        // readable from a standing start, which is what "clear" has to mean.
        for (let i = 0; i < RULES.runUp; i++) column(x++, groundY);

        const spikeLen = Math.min(layout.int(1, 1 + Math.round(t * 2)), 3);
        const spikeX = x;
        for (let i = 0; i < spikeLen; i++) {
          column(x, groundY);
          set(x, groundY - 1, TILE.SPIKE);
          x++;
        }

        for (let i = 0; i < RULES.landing; i++) column(x++, groundY);
        segments.push({ type: "spikes", x: spikeX, len: spikeLen, groundY });
        sinceHazard = 0;
      }

      if (x === before) column(x++, groundY); // never stall the walker
    }

    // Outro pad and the door: two tiles of doorway standing on the ground, so
    // the run ends by going through something rather than crossing a line.
    const doorX = width - 6;
    for (; x < width; x++) column(x, groundY);
    set(doorX, groundY - 1, TILE.DOOR);
    set(doorX, groundY - 2, TILE.DOOR);
    const goal = { x: doorX, y: groundY - 1 };

    const dives = carveDives(width, height, surface, caves, set);

    floodLava(tiles, width, height, surface, set);

    const level = {
      seed,
      dives,
      mode: mode.id,
      meters: width * METERS_PER_TILE,
      width,
      height,
      tiles,
      spawn,
      goal,
      segments,
      rules: RULES,
      tally: tally(tiles, segments),
    };
    level.checksum = checksum(tiles);
    return level;
  }


  // Digs the layered half of the world. The surface is only the lid: a dive is a
  // hole too wide to jump across, a gallery running along underneath it, and a
  // laddered chimney back up to daylight. You cannot skip one — the entry is
  // wider than the longest jump, so the way on is through.
  // Lava sits at different heights depending on what is above it. A shaft with
  // something to land on is a place you can be, so the lava stays down at the
  // floor of the world and leaves the room usable. A clean chute has nothing to
  // catch you, so the lava rises to meet you — close enough under the lip to be
  // read as a warning from the surface, before you commit to the drop.
  function floodLava(tiles, width, height, surface, set) {
    const read = (x, y) => (x < 0 || x >= width || y < 0 || y >= height ? TILE.GROUND : tiles[y * width + x]);
    const bottomless = (x) => read(x, height - LAVA_DEPTH - 1) === TILE.EMPTY;

    let x = 0;
    while (x < width) {
      if (!bottomless(x)) {
        x++;
        continue;
      }

      let end = x;
      while (end + 1 < width && bottomless(end + 1)) end++;

      // Anything landable hanging in the shaft makes it somewhere to go.
      let landing = false;
      for (let cx = x; cx <= end && !landing; cx++) {
        for (let cy = 0; cy < height - LAVA_DEPTH - 1; cy++) {
          const tile = read(cx, cy);
          if (tile === TILE.GROUND || tile === TILE.PLATFORM) {
            landing = true;
            break;
          }
        }
      }

      const left = x > 0 ? surface[x - 1] : -1;
      const right = end + 1 < width ? surface[end + 1] : -1;
      const lip = left >= 0 ? left : right >= 0 ? right : 12;

      const top = landing
        ? height - LAVA_DEPTH
        : Math.min(height - LAVA_DEPTH, lip + CHUTE_DROP);

      for (let cx = x; cx <= end; cx++) {
        for (let cy = top; cy < height; cy++) {
          if (read(cx, cy) === TILE.EMPTY) set(cx, cy, TILE.LAVA);
        }
      }

      x = end + 1;
    }
  }

  function carveDives(width, height, surface, rng, set) {
    const dives = [];
    const carve = (x, from, to) => {
      for (let y = from; y <= to; y++) set(x, y, TILE.EMPTY);
    };

    let x = SPAWN_PAD + rng.int(26, 44);

    while (x < width - OUTRO_PAD - 80) {
      const entryW = rng.int(6, 9); // wider than a jump: no way over it
      const galleryLen = rng.int(20, 46);
      const exitW = rng.int(3, 4);
      const span = entryW + galleryLen + exitW;
      const galleryEnd = x + entryW + galleryLen;

      if (x + span > width - OUTRO_PAD - 10) break;

      // A dive needs unbroken ground to cut a hole in, and enough rock between
      // the surface and the gallery roof that carving one does not open the
      // other. A surface chasm dipping into the ceiling would drop the floor out
      // from under the run above.
      const LANDING = 6; // clean ground to come back up into
      let solid = x + span + LANDING < width;
      for (let cx = x; solid && cx < x + span + LANDING; cx++) {
        if (surface[cx] < 0 || surface[cx] > CAVE_TOP - HEADROOM - 4) solid = false;
      }

      // The chimney has to surface onto ground that is actually there and
      // roughly level. Coming up at the lip of a surface gap strands you: the
      // next foothold ends up further away than any jump reaches.
      for (let cx = galleryEnd; solid && cx < galleryEnd + exitW + LANDING; cx++) {
        if (Math.abs(surface[cx] - surface[galleryEnd]) > 2) solid = false;
      }

      if (!solid) {
        x += 14;
        continue;
      }

      const lip = surface[x];
      const floorY = Math.max(CAVE_TOP, Math.min(CAVE_LIMIT, lip + rng.int(12, 28)));

      // The hole, straight down from the surface.
      for (let cx = x; cx < x + entryW; cx++) carve(cx, surface[cx], floorY - 1);

      // The gallery itself, roofed over by whatever rock is left above it.
      for (let cx = x; cx < galleryEnd; cx++) carve(cx, floorY - HEADROOM, floorY - 1);

      // The chimney out, and the ledges that make it climbable. They alternate
      // sides one plain jump apart, so getting out never depends on a wall jump
      // being timed perfectly — it just rewards knowing one.
      const exitLip = surface[galleryEnd];
      for (let cx = galleryEnd; cx < galleryEnd + exitW; cx++) carve(cx, surface[cx], floorY - 1);

      const ledges = [];
      let side = 0;
      const place = (ly) => {
        const lx = side ? galleryEnd : galleryEnd + exitW - 2;
        set(lx, ly, TILE.PLATFORM);
        set(lx + 1, ly, TILE.PLATFORM);
        ledges.push({ x: lx, y: ly });
        side = side ? 0 : 1;
      };

      // Built downwards from the lip so the last step into daylight is always a
      // plain jump, then topped up at the bottom so the first step off the
      // gallery floor is too.
      for (let ly = exitLip + LEDGE_RISE; ly <= floorY - LEDGE_RISE; ly += LEDGE_RISE) place(ly);
      const lowest = ledges.length ? ledges[ledges.length - 1].y : exitLip;
      if (floorY - lowest > LEDGE_RISE) place(floorY - LEDGE_RISE);

      dives.push({ x, entryW, galleryEnd, exitW, floorY, lip, exitLip, ledges });
      x = galleryEnd + exitW + rng.int(40, 90);
    }

    return dives;
  }

  function tally(tiles, segments) {
    let spikes = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === TILE.SPIKE) spikes++;
    }
    return {
      spikes,
      gaps: segments.filter((s) => s.type === "gap").length,
      shelves: segments.filter((s) => s.type === "platform").length,
    };
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
  function verify(level) {
    const problems = [];
    const dives = level.dives || [];

    const inDive = new Uint8Array(level.width);
    for (const dive of dives) {
      for (let x = dive.x; x < dive.x + dive.entryW && x < level.width; x++) inDive[x] = 1;
      for (let x = dive.galleryEnd; x < dive.galleryEnd + dive.exitW && x < level.width; x++) {
        inDive[x] = 1;
      }
    }

    let previousFloor = floorAt(level, 0);
    let gapRun = 0;

    for (let x = 1; x < level.width; x++) {
      if (inDive[x]) {
        // The surface is open here on purpose; nothing to compare across it.
        gapRun = 0;
        previousFloor = null;
        continue;
      }

      if (surfaceAt(level, x) === null) {
        gapRun++;
        continue;
      }

      if (gapRun > level.rules.maxGap) {
        problems.push(`gap of ${gapRun} tiles at x=${x - gapRun}`);
      }
      const crossed = gapRun;
      gapRun = 0;

      const floor = floorAt(level, x);
      if (floor === null) continue;

      // A tall rise is fine when you can put a hand on it. Across a gap there is
      // nothing to bounce off, so the plain jump limit applies.
      const limit = crossed > 0 ? level.rules.maxStepUp : level.rules.maxWallClimb;
      if (previousFloor !== null && previousFloor - floor > limit) {
        problems.push(`step up of ${previousFloor - floor} tiles at x=${x}`);
      }
      previousFloor = floor;
    }

    for (const dive of dives) problems.push(...verifyDive(level, dive));

    return { ok: problems.length === 0, problems };
  }

  // A dive is only fair if you can get down it, along it, and back out of it.
  function verifyDive(level, dive) {
    const problems = [];
    const rules = level.rules;

    if (dive.entryW <= rules.maxGap) {
      problems.push(`dive at x=${dive.x} is jumpable (${dive.entryW} wide) — the route can be skipped`);
    }

    // Headroom along the gallery, so the run through it is not a crawl.
    for (let x = dive.x; x < dive.galleryEnd; x++) {
      let clear = 0;
      for (let y = dive.floorY - 1; y >= 0 && at(level, x, y) === TILE.EMPTY; y--) clear++;
      if (clear < 4) {
        problems.push(`gallery at x=${x} has ${clear} tiles of headroom`);
        break;
      }
    }

    const rows = dive.ledges.map((ledge) => ledge.y).sort((a, b) => a - b);
    if (!rows.length) {
      problems.push(`dive at x=${dive.x} has no way back up`);
      return problems;
    }

    if (rows[0] - dive.exitLip > rules.maxStepUp) {
      problems.push(`dive at x=${dive.x} ends ${rows[0] - dive.exitLip} tiles below daylight`);
    }
    if (dive.floorY - rows[rows.length - 1] > rules.maxStepUp) {
      problems.push(`dive at x=${dive.x} starts ${dive.floorY - rows[rows.length - 1]} tiles below its first ledge`);
    }
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] - rows[i - 1] > rules.maxStepUp) {
        problems.push(`dive at x=${dive.x} has a ${rows[i] - rows[i - 1]} tile ledge gap`);
      }
    }

    return problems;
  }

  // Drawn once from the lower of the two door tiles, so the arch spans both.
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
    render,
    toText,
    checksum,
  };
})();
