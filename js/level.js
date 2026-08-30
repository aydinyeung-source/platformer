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
  const MIN_GROUND = 4; // peaks reach higher now, so mountains read as mountains
  const MAX_GROUND = 17;
  const FLOOR_LIMIT = 26; // surface chasms stay near the surface
  const CAVE_TOP = 34; // galleries start well below anything the surface digs
  const CAVE_LIMIT = HEIGHT - 8;
  const LAVA_DEPTH = 3; // how deep a pool sits at the floor of the world
  const TUNNEL_HEIGHT = 4; // headroom in a passage bored through a mountain
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
        { value: "mountain", weight: 7 + t * 7 },
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
      if (kind === "mountain" && (room < 46 || groundY - MIN_GROUND < 7)) kind = "flat";

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
      } else if (kind === "mountain") {
        // A big landmark with a broad top. The way over is always there — steps
        // inside the jump envelope — but a mountain is also the thing a tunnel
        // can be driven through, which is what makes going over a choice rather
        // than the only option.
        const rise = Math.min(layout.int(7, 15), groundY - MIN_GROUND);
        const peakY = groundY - rise;
        const baseY = groundY;

        let climb = groundY;
        while (climb > peakY) {
          climb = Math.max(peakY, climb - layout.int(2, RULES.maxStepUp));
          const tread = layout.int(2, 3);
          for (let i = 0; i < tread; i++) column(x++, climb);
        }

        const cap = layout.int(6, 14);
        for (let i = 0; i < cap; i++) column(x++, peakY);

        let drop = peakY;
        // Often the far side comes back to the height it started at, which is
        // what lets a tunnel be driven through level with both feet.
        const foot = layout.chance(0.55)
          ? baseY
          : Math.min(MAX_GROUND, baseY + layout.int(-2, 2));
        while (drop < foot) {
          drop = Math.min(foot, drop + layout.int(2, 4));
          const tread = layout.int(2, 3);
          for (let i = 0; i < tread; i++) column(x++, drop);
        }
        groundY = drop;

        for (let i = 0; i < RULES.landing; i++) column(x++, groundY);
        segments.push({ type: "mountain", x: before, len: x - before, groundY, baseY, peakY });
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

    const tunnels = boreTunnels(tiles, width, height, surface, segments, caves, set);
    const dives = carveDives(width, height, surface, caves, set);

    floodLava(tiles, width, height, surface, set);

    const level = {
      seed,
      dives,
      tunnels,
      // The generator's own record of where the ground is. Verification reads
      // this rather than inferring the surface from tiles, which stopped being
      // possible once galleries were carved underneath it.
      surface,
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
  // Drives a passage straight through the base of a mountain. The way over the
  // top is untouched, so the tunnel is a shortcut rather than the only route —
  // and because it is cut at the foot of the slope, its mouth appears as an
  // opening in the mountainside rather than a hole you fall into.
  function boreTunnels(tiles, width, height, surface, segments, rng, set) {
    const bored = [];
    const read = (x, y) => (x < 0 || x >= width || y < 0 || y >= height ? TILE.GROUND : tiles[y * width + x]);

    for (const segment of segments) {
      if (segment.type !== "mountain") continue;
      if (!rng.chance(0.62)) continue;

      // Both feet must sit at the same height. The tunnel is then cut strictly
      // above that line, which leaves the mountain's own footings untouched —
      // carving them away drops the surface a tile and strands whatever the
      // generator builds next against a face it thinks is shorter than it is.
      if (segment.baseY !== segment.groundY) continue;
      const floorY = segment.groundY;
      if (segment.peakY > floorY - TUNNEL_HEIGHT - 2) continue; // not enough rock overhead

      const from = segment.x;
      const to = segment.x + segment.len;
      let mouths = 0;

      for (let cx = from; cx < to; cx++) {
        if (surface[cx] < 0) continue;
        if (surface[cx] >= floorY) {
          mouths++; // open ground, not buried — this is where a mouth sits
          continue;
        }
        for (let cy = floorY - TUNNEL_HEIGHT; cy < floorY; cy++) {
          if (read(cx, cy) === TILE.GROUND) set(cx, cy, TILE.EMPTY);
        }
      }

      bored.push({ x: from, len: to - from, floorY, roof: floorY - TUNNEL_HEIGHT, mouths });
    }

    return bored;
  }

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

  // Ledges two wide, alternating sides, one plain jump apart. Built downwards
  // from the top so the last step out is always reachable, then topped up at the
  // bottom so the first step off the floor is too. Used for every climb.
  function ladder(x0, w, topY, floorY, set) {
    const ledges = [];
    let side = 0;

    const place = (ly) => {
      const lx = side ? x0 : x0 + w - 2;
      set(lx, ly, TILE.PLATFORM);
      set(lx + 1, ly, TILE.PLATFORM);
      ledges.push({ x: lx, y: ly });
      side = side ? 0 : 1;
    };

    for (let ly = topY + LEDGE_RISE; ly <= floorY - LEDGE_RISE; ly += LEDGE_RISE) place(ly);
    const lowest = ledges.length ? ledges[ledges.length - 1].y : topY;
    if (floorY - lowest > LEDGE_RISE) place(floorY - LEDGE_RISE);

    return ledges;
  }

  // Digs the layered half of the world. Every dive drops in through a hole too
  // wide to jump, threads one or more galleries, and climbs back to daylight to
  // the right of where it started — so a dive always costs you the trip but
  // never traps you, and never spits you out behind an entry you cannot recross.
  function carveDives(width, height, surface, rng, set) {
    const dives = [];
    const carve = (x, from, to) => {
      for (let y = from; y <= to; y++) set(x, y, TILE.EMPTY);
    };
    const gallery = (x0, x1, floorY) => {
      for (let cx = x0; cx < x1; cx++) {
        carve(cx, floorY - HEADROOM, floorY - 1);
        // A gallery lays its own floor. Stone fields and pillar runs leave long
        // stretches with nothing under them at this depth, which would sever the
        // passage — and it means a hole in the roof drops you into the cave
        // instead of straight past it.
        set(cx, floorY, TILE.GROUND);
      }
    };

    // The surface has to be unbroken above everything we cut, and far enough
    // above the roof that carving underneath never opens the ground people run on.
    const roofed = (from, to, shallowest) => {
      if (from < SPAWN_PAD + 4 || to >= width) return false;
      for (let cx = from; cx < to; cx++) {
        if (surface[cx] < 0 || surface[cx] > shallowest - HEADROOM - 4) return false;
      }
      return true;
    };

    const level = (from, to) => {
      for (let cx = from; cx < to; cx++) {
        if (Math.abs(surface[cx] - surface[from]) > 2) return false;
      }
      return true;
    };

    const LANDING = 6;
    let x = SPAWN_PAD + rng.int(26, 44);
    let carvedRight = SPAWN_PAD;

    while (x < width - OUTRO_PAD - 100) {
      const entryW = rng.int(6, 9);
      const style = rng.weighted([
        { value: "straight", weight: 26 },
        { value: "back", weight: 34 },
        { value: "up", weight: 30 },
      ]);

      const lip = surface[x];
      const floorA = Math.max(CAVE_TOP, Math.min(CAVE_LIMIT, lip + rng.int(12, 24)));

      const legs = [];
      const risers = [];
      let exitX;
      let deepest = floorA;
      let leftMost = x;

      if (style === "back") {
        // The long way round: left first, down a level, then right underneath
        // everything you just walked, surfacing well past where you fell in.
        const leftLen = rng.int(14, 30);
        const rightLen = rng.int(26, 52);
        const floorB = Math.min(CAVE_LIMIT, floorA + rng.int(6, 12));
        leftMost = x - leftLen;
        exitX = x + entryW + rightLen;
        deepest = floorB;

        legs.push({ x0: leftMost, x1: x + entryW, floorY: floorA });
        legs.push({ x0: leftMost, x1: exitX, floorY: floorB });
        risers.push({ x: leftMost, w: 3, fromY: floorB, toY: floorA, drop: true });
      } else if (style === "up") {
        // Down, along, then up inside the rock and along again — the passage
        // climbs before it lets you out.
        const firstLen = rng.int(12, 24);
        const secondLen = rng.int(20, 40);
        const riserX = x + entryW + firstLen;
        const floorC = Math.max(CAVE_TOP, floorA - rng.int(8, 16));
        exitX = riserX + 3 + secondLen;

        // The chimney out rises from the upper gallery, not the lower one — cut
        // it to the deeper floor and it punches straight through the floor you
        // just climbed onto.
        deepest = floorC;
        legs.push({ x0: x, x1: riserX + 3, floorY: floorA });
        legs.push({ x0: riserX, x1: exitX, floorY: floorC });
        risers.push({ x: riserX, w: 3, fromY: floorA, toY: floorC, drop: false });
      } else {
        exitX = x + entryW + rng.int(20, 46);
        legs.push({ x0: x, x1: exitX, floorY: floorA });
      }

      const exitW = rng.int(3, 4);
      const span = { from: Math.min(leftMost, x) - 2, to: exitX + exitW + LANDING };
      const shallowest = legs.reduce((min, leg) => Math.min(min, leg.floorY), 99);

      // Only the shafts cut the surface, so only they need unbroken ground above.
      // The galleries run far enough below that a hole in the roof is a bonus
      // entrance, not a problem.
      const usable =
        leftMost > carvedRight + 6 &&
        exitX > x + entryW + 4 &&
        span.to < width - OUTRO_PAD - 4 &&
        roofed(x, x + entryW, shallowest) &&
        roofed(exitX, exitX + exitW + LANDING, shallowest) &&
        // Both shafts need flat ground. Cutting an entry through a chasm takes
        // out the climb that chasm relies on, and the surface either side of the
        // hole stops agreeing about where the ground is.
        level(x, x + entryW) &&
        level(exitX, exitX + exitW + LANDING);

      if (!usable) {
        x += 16;
        continue;
      }

      for (const leg of legs) gallery(leg.x0, leg.x1, leg.floorY);

      // The hole you fall in through.
      for (let cx = x; cx < x + entryW; cx++) carve(cx, surface[cx], floorA - 1);

      for (const riser of risers) {
        for (let cx = riser.x; cx < riser.x + riser.w; cx++) {
          carve(cx, Math.min(riser.fromY, riser.toY) - HEADROOM, Math.max(riser.fromY, riser.toY) - 1);
        }
        // Only a climb needs rungs; a drop is free.
        riser.ledges = riser.drop ? [] : ladder(riser.x, riser.w, riser.toY, riser.fromY, set);
      }

      const exitLip = surface[exitX];
      for (let cx = exitX; cx < exitX + exitW; cx++) carve(cx, surface[cx], deepest - 1);
      const ledges = ladder(exitX, exitW, exitLip, deepest, set);

      dives.push({ x, entryW, lip, exitX, exitW, exitLip, ledges, legs, risers, style, deepest });
      carvedRight = exitX + exitW + LANDING;
      x = carvedRight + rng.int(28, 64);
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
  // Checks the surface route against the generator's own record of where the
  // ground is. Gaps are runs with no ground and no stepping stone; climbs are
  // measured against whatever you could last stand on. Shafts are skipped —
  // the surface is cut there on purpose, and the route runs underneath.
  function verify(level) {
    const problems = [];
    const dives = level.dives || [];
    const surface = level.surface;

    const inShaft = new Uint8Array(level.width);
    for (const dive of dives) {
      for (let x = dive.x; x < dive.x + dive.entryW && x < level.width; x++) inShaft[x] = 1;
      for (let x = dive.exitX; x < dive.exitX + dive.exitW && x < level.width; x++) inShaft[x] = 1;
    }

    let previous = null;
    let gapRun = 0;

    for (let x = 0; x < level.width; x++) {
      if (inShaft[x]) {
        gapRun = 0;
        continue;
      }

      let landable = surface[x] >= 0 ? surface[x] : null;

      // A stepping stone is not ground, but it is somewhere to land.
      if (landable === null && previous !== null) {
        for (let y = Math.max(0, previous - 6); y <= previous + 6; y++) {
          if (at(level, x, y) === TILE.PLATFORM) {
            landable = y;
            break;
          }
        }
      }

      if (landable === null) {
        gapRun++;
        continue;
      }

      if (gapRun > level.rules.maxGap) {
        problems.push("gap of " + gapRun + " tiles at x=" + (x - gapRun));
      }
      const crossed = gapRun;
      gapRun = 0;

      // A tall rise is fine when you can put a hand on it. Across a gap there is
      // nothing to bounce off, so the plain jump limit applies.
      const limit = crossed > 0 ? level.rules.maxStepUp : level.rules.maxWallClimb;
      if (previous !== null && previous - landable > limit) {
        problems.push("step up of " + (previous - landable) + " tiles at x=" + x);
      }
      previous = landable;
    }

    for (const dive of dives) problems.push(...verifyDive(level, dive));

    return { ok: problems.length === 0, problems };
  }

  // Every rung of a climb has to be inside a plain jump of the one below it, and
  // the two ends have to connect to the floor and the lip they sit between.
  function checkLadder(ledges, topY, floorY, rules, label) {
    const problems = [];
    const rows = ledges.map((ledge) => ledge.y).sort((a, b) => a - b);

    // A climb inside a single jump needs no rungs at all.
    if (floorY - topY <= rules.maxStepUp) return problems;

    if (!rows.length) {
      problems.push(`${label} has no rungs`);
      return problems;
    }
    if (rows[0] - topY > rules.maxStepUp) {
      problems.push(`${label} stops ${rows[0] - topY} tiles short of the top`);
    }
    if (floorY - rows[rows.length - 1] > rules.maxStepUp) {
      problems.push(`${label} starts ${floorY - rows[rows.length - 1]} tiles above the floor`);
    }
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] - rows[i - 1] > rules.maxStepUp) {
        problems.push(`${label} has a ${rows[i] - rows[i - 1]} tile rung gap`);
      }
    }
    return problems;
  }

  // A dive is only fair if you can get down it, along every leg of it, and back
  // out of it — and if it cannot simply be jumped over.
  function verifyDive(level, dive) {
    const problems = [];
    const rules = level.rules;

    if (dive.entryW <= rules.maxGap) {
      problems.push(`dive at x=${dive.x} is jumpable (${dive.entryW} wide) — the route can be skipped`);
    }
    if (dive.exitX <= dive.x + dive.entryW) {
      problems.push(`dive at x=${dive.x} surfaces behind its own entry`);
    }

    for (const leg of dive.legs) {
      for (let x = leg.x0; x < leg.x1; x++) {
        let clear = 0;
        // Rock is a ceiling; a rung of a ladder is something you rise through.
        for (let y = leg.floorY - 1; y >= 0 && at(level, x, y) !== TILE.GROUND; y--) clear++;
        if (clear < 4) {
          problems.push(`gallery at x=${x} has ${clear} tiles of headroom`);
          break;
        }
      }
    }

    for (const riser of dive.risers) {
      if (riser.drop) continue; // falling needs no rungs
      problems.push(...checkLadder(riser.ledges, riser.toY, riser.fromY, rules, `riser at x=${riser.x}`));
    }

    problems.push(...checkLadder(dive.ledges, dive.exitLip, dive.deepest, rules, `dive at x=${dive.x}`));
    return problems;
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
    render,
    toText,
    checksum,
  };
})();
