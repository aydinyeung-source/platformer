// script.js — main menu: seed choice, run length, and handing off to a run

(() => {
  // There is no sound, and until there is there is no switch for it. A control
  // that turns off something the game never does is a promise the game does not
  // keep — and the first thing it costs is the player's trust in every other
  // control on the screen.
  const fullscreenButton = document.querySelector('[data-action="fullscreen"]');
  const playButton = document.querySelector('[data-action="play"]');

  fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  // -------------------------------------------------------------- seed choice

  const seedInput = document.querySelector("[data-seed]");
  const resolved = document.querySelector("[data-resolved]");
  const sourceButtons = Array.from(document.querySelectorAll("[data-source]"));
  const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));

  let level = null;
  let phase = "menu"; // menu -> loading -> game
  let runSeedText = ""; // what the player asked for, which the tutorial overrides

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function activeValue(buttons, key) {
    const active = buttons.find((button) => button.classList.contains("is-active"));
    return active ? active.dataset[key] : null;
  }

  function select(buttons, button) {
    buttons.forEach((other) => {
      const active = other === button;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-pressed", String(active));
    });
  }

  function setSource(id) {
    select(sourceButtons, sourceButtons.find((button) => button.dataset.source === id));
  }

  // ------------------------------------------------------------------ palette

  // The theme never changes at runtime, so the tokens are read once rather than
  // on every frame of every canvas.
  const colours = {
    paper: token("--paper"),
    ink: token("--ink"),
    inkSoft: token("--ink-soft"),
    inkMuted: token("--ink-muted"),
    accent: token("--accent"),
    accentLight: token("--accent-light"),
    alert: token("--alert"),
    stone: token("--stone"),
    lava: token("--lava"),
    lavaTop: token("--lava-top"),
    stoneDeep: token("--stone-deep"),
    stoneRim: token("--stone-rim"),
    hazeFar: token("--haze-far"),
    hazeNear: token("--haze-near"),
    rule: token("--rule"),
    // Three depths of rock, each with a lit face and a shaded one, and the two
    // specks that turn up in it.
    rockHigh: token("--rock-high"),
    rockHighDeep: token("--rock-high-deep"),
    rockMid: token("--rock-mid"),
    rockMidDeep: token("--rock-mid-deep"),
    rockDeep: token("--rock-deep"),
    rockDeepDeep: token("--rock-deep-deep"),
    fleckAmber: token("--fleck-amber"),
    fleckBone: token("--fleck-bone"),
  };

  // --------------------------------------------------------------- seed state

  // Nothing about the run is generated here. The map is not built, drawn or
  // measured until Play is pressed, so the menu cannot give the level away.
  function refresh() {
    resolved.hidden = activeValue(sourceButtons, "source") !== "daily";
    if (resolved.hidden) return;
    resolved.textContent =
      "Everyone gets the same run on " +
      new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  }

  sourceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const source = button.dataset.source;
      select(sourceButtons, button);

      if (source === "daily") seedInput.value = Rng.dailySeed();
      else if (source === "random") seedInput.value = Rng.randomSeed();
      else seedInput.focus();

      refresh();
    });
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      select(modeButtons, button);
      });
  });

  // Typing is always a custom seed, whichever source put the text there.
  seedInput.addEventListener("input", () => {
    setSource("custom");
    refresh();
  });

  seedInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    seedInput.blur();
  });

  // ------------------------------------------------------------ recent runs

  const tabs = Array.from(document.querySelectorAll("[data-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const runsList = document.querySelector("[data-runs-list]");
  const runsNote = document.querySelector("[data-runs-note]");

  function when(stamp) {
    const days = Math.floor((Date.now() - new Date(stamp).getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    return new Date(stamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function cell(row, className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    row.append(span);
  }

  function renderRuns(rows) {
    runsList.textContent = "";
    if (!rows || !rows.length) {
      runsNote.hidden = false;
      runsNote.textContent = "No runs yet — finish one and it lands here";
      return;
    }

    runsNote.hidden = true;
    rows.forEach((row) => {
      const item = document.createElement("li");
      item.className = row.finished ? "run run--finished" : "run";
      cell(item, "run__seed", row.seed);
      cell(item, "run__mode", Level.resolveMode(row.mode).label);
      cell(item, "run__reached", Number(row.reached).toLocaleString("en-US") + " m");
      cell(item, "run__time", Runs.clock(Number(row.seconds)));
      cell(item, "run__when", when(row.created_at));
      runsList.append(item);
    });
  }

  function loadRuns() {
    Runs.mine(10)
      .then(renderRuns)
      .catch(() => {
        runsNote.hidden = false;
        runsNote.textContent = "Sign in to see your runs";
      });
  }

  function showPanel(name) {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
    if (name === "runs") loadRuns();
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => showPanel(tab.dataset.tab)));

  const loader = document.querySelector("[data-loader]");
  const stageLabel = document.querySelector("[data-stage]");
  const fill = document.querySelector("[data-fill]");
  const loaderMeta = document.querySelector("[data-loader-meta]");

  // Theatre, and deliberately so: the level really does generate in about three
  // milliseconds. The stages are named after the work that actually happened,
  // paced so a run feels built rather than conjured.
  const STAGES = [
    { label: "Hashing seed", ms: 260 },
    { label: "Carving terrain", ms: 420 },
    { label: "Placing hazards", ms: 300 },
    { label: "Cutting shafts", ms: 260 },
    { label: "Verifying every jump", ms: 400 },
    { label: "Warming the camera", ms: 220 },
  ];

  const TOTAL_MS = STAGES.reduce((sum, stage) => sum + stage.ms, 0);
  let loadStart = 0;
  let loadMeta = "";
  let shownPercent = -1;

  function startLoading(seedOverride) {
    phase = "loading";
    // The honest part: the run is generated here, the moment Play is pressed.
    const wanted = seedOverride || seedInput.value;
    level = Level.generate(wanted, { mode: activeValue(modeButtons, "mode") });
    runSeedText = wanted;
    loader.hidden = false;

    loadMeta =
      "Seed " + runSeedText.toUpperCase() + " · " + level.meters.toLocaleString("en-US") + " m";
    loadStart = performance.now();
    shownPercent = -1;
    stageLabel.textContent = STAGES[0].label;
    fill.style.width = "0%";
    loaderMeta.textContent = "0% · " + loadMeta;
    startLoop();
  }

  // Driven from the frame loop rather than a chain of timers, so the bar, the
  // percentage and the stage name can never disagree with each other.
  function updateLoading(now) {
    const elapsed = now - loadStart;
    if (elapsed >= TOTAL_MS) {
      startGame();
      return;
    }

    let running = 0;
    let label = STAGES[STAGES.length - 1].label;
    for (const stage of STAGES) {
      running += stage.ms;
      if (elapsed < running) {
        label = stage.label;
        break;
      }
    }

    const percent = Math.min(100, Math.round((elapsed / TOTAL_MS) * 100));
    if (percent === shownPercent) return;

    shownPercent = percent;
    stageLabel.textContent = label;
    fill.style.width = percent + "%";
    loaderMeta.textContent = percent + "% · " + loadMeta;
  }

  // --------------------------------------------------------------------- game

  const gameView = document.querySelector("[data-game]");
  const gameCanvas = document.querySelector("[data-game-canvas]");
  const hudSeed = document.querySelector("[data-hud-seed]");
  const hudDistance = document.querySelector("[data-hud-distance]");

  // World row where daylight stops. The maze is carved out of solid rock and
  // has a lid on it, so there is no daylight anywhere and no behind for hills
  // to stand in: left switched on, they showed through every carved room as a
  // stepped silhouette that read as blocks floating in the stone.
  const SKY_BOTTOM = 0;

  // World row the magma glow starts creeping up from — the top of the deep rock
  // band, so the wash and the darkest stone agree about where the abyss begins.
  const GLOW_FROM = 50;

  const gameCamera = Camera.create({ viewW: 800, viewH: 400 });
  let session = null;
  let gameTile = 34;
  let gameOffsetY = 0;
  let hudShown = "";

  function fitGame() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    gameCanvas.width = Math.floor(w * dpr);
    gameCanvas.height = Math.floor(h * dpr);
    // Show about fourteen rows, not the whole level: the world has to be taller
    // than the view for the camera to have anywhere to go downwards.
    gameTile = Math.max(26, Math.min(52, Math.round(h / 14)));

    Camera.resize(gameCamera, w, h);
    gameCamera.overscan = gameTile * 12;
    if (level) Camera.setWorld(gameCamera, level.width * gameTile, level.height * gameTile);
    // A level shorter than the window is centred rather than pinned to the top.
    gameOffsetY = level ? Math.max(0, (h - level.height * gameTile) / 2) : 0;
    return dpr;
  }

  // Two layers of blocky hills at different parallax rates, derived from the
  // seed rather than stored, so a 10 km backdrop costs nothing.
  //
  // Clipped to the sky band. Hills are what is behind the world, and below
  // ground there is no behind: left unclipped they show through every carved
  // shaft, and their stepped silhouette reads as blocks floating in the rock.
  function drawBackdrop(ctx) {
    const skyBottom = SKY_BOTTOM * gameTile - gameCamera.y;
    if (skyBottom <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, gameCamera.viewW, skyBottom);
    ctx.clip();
    paintHills(ctx);
    ctx.restore();
  }

  function paintHills(ctx) {
    const layers = [
      { factor: 0.22, colour: colours.hazeFar, span: 7, base: 0.5, amp: 5 },
      { factor: 0.46, colour: colours.hazeNear, span: 5, base: 0.66, amp: 3.5 },
    ];

    for (const layer of layers) {
      const offset = gameCamera.x * layer.factor;
      const lift = gameCamera.y * layer.factor;
      const blockPx = layer.span * gameTile;
      const first = Math.floor(offset / blockPx) - 1;
      const count = Math.ceil(gameCamera.viewW / blockPx) + 3;

      ctx.fillStyle = layer.colour;
      for (let i = 0; i < count; i++) {
        const index = first + i;
        const roll = (Rng.hash(level.seed + "/hill" + layer.span + "/" + index) % 997) / 997;
        const top = gameCamera.viewH * layer.base - roll * layer.amp * gameTile * 0.5 - lift;
        ctx.fillRect(index * blockPx - offset, top, blockPx + 1, gameCamera.viewH + lift - top);
      }
    }
  }

  // --------------------------------------------------------------- the sprite
  //
  // Twelve frames of 24x32 in one strip. Ten of them are the runner and two are
  // weather: dust and heat, spawned by the renderer and simulated nowhere,
  // because nothing a particle does may change what a seed produces.
  // The art does not fill the cell. Every one of the ten character frames ends
  // at pixel row 29, leaving two transparent rows at the bottom of the 32 — so
  // a frame anchored by its cell hangs the runner two pixels above the floor.
  // activeH is what the body's height is measured against; padBottom is what
  // the anchor has to give back.
  const SHEET = { cols: 12, fw: 24, fh: 32, activeH: 30, padBottom: 2 };
  const STRIDE = 1.75; // frames per tile: a four frame cycle every 2.3 tiles
  const FRAME = {
    idle: 0,
    run: 1, // 1..4
    air: 5,
    wall: 6,
    slide: 7,
    crouch: 8,
    hurt: 9,
    dust: 10,
    heat: 11,
  };

  const sheet = new Image();
  let sheetReady = false;
  sheet.addEventListener("load", () => {
    sheetReady = true;
  });
  // A missing or unreadable sheet is not a broken game: the runner falls back to
  // the shape it was before there was any art, and everything still plays.
  sheet.addEventListener("error", () => {
    sheetReady = false;
  });
  sheet.src = "assets/sprites/player.png";

  // Which of the ten runner frames this moment is. Order is precedence: being
  // hurt outranks being on a wall, which outranks being in the air.
  function poseOf(player) {
    const body = player.body;
    if (player.recovering > 0) return FRAME.hurt;

    // Low first, and before anything airborne. A skim is airborne. So is a
    // slide taken off an edge, and so is a crouch that walked off one — and in
    // every case the body is half height and under a roof that only fits it
    // because it is. Reaching the standing frames from here draws a full height
    // pose on a half height body and puts its head through the ceiling.
    //
    // Above the wall check too, for the same reason: clinging is a tall pose,
    // and a skim that touches a wall in a two row passage is still half height.
    if (player.sliding || player.skimming) {
      const fast = Math.abs(body.vx) > Player.TUNING.runSpeed * Player.TUNING.crawlSpeed + 0.5;
      return fast ? FRAME.slide : FRAME.crouch;
    }

    if (player.onWall) return FRAME.wall;
    if (!body.onGround) return FRAME.air;
    if (Math.abs(body.vx) > 0.4) {
      // Walked, not ticked: the cycle advances with the ground covered, so it
      // never moonwalks and never scampers on the spot. A stride of four frames
      // over about two and a quarter tiles — at four steps per tile it was nine
      // full cycles a second, which is a blur rather than a run. The modulo is
      // written to survive a negative operand, so running left counts down the
      // cycle instead of jittering across the wrap.
      const step = Math.floor(body.x * STRIDE);
      return FRAME.run + (((step % 4) + 4) % 4);
    }
    return FRAME.idle;
  }

  // Anchored by the feet and centred on the body, because the art is bigger than
  // the box it collides with — and it has to stay put when the box halves in
  // height for a slide.
  function drawFrame(ctx, frame, centreX, feetY, scale, flip, alpha) {
    if (!sheetReady) return false;
    const h = SHEET.fh * scale;
    const w = SHEET.fw * scale;
    // Hung from the last row of art rather than the last row of the cell, so
    // the soles sit on the floor and the two transparent rows fall below it.
    const topY = feetY - (SHEET.fh - SHEET.padBottom) * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(centreX, topY);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(sheet, frame * SHEET.fw, 0, SHEET.fw, SHEET.fh, -w / 2, 0, w, h);
    ctx.restore();
    return true;
  }

  // ------------------------------------------------------------- the weather
  const motes = [];
  let dustSeen = 0;
  let fallsSeen = 0;

  function mote(x, y, vx, vy, frame, life) {
    if (motes.length > 90) return; // cosmetic, and never worth a frame drop
    motes.push({ x, y, vx, vy, frame, life, max: life });
  }

  function puff(x, y, count, spread) {
    for (let i = 0; i < count; i++) {
      mote(x, y, (Math.random() - 0.5) * spread, -Math.random() * 1.2 - 0.2, FRAME.dust, 0.25);
    }
  }

  function stepMotes(dt) {
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.life -= dt;
      if (m.life <= 0) {
        motes.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
  }

  // Heat off the top of any pool the camera can actually see. Cheap, because it
  // only ever looks at the columns on screen.
  function breatheLava(dt) {
    if (!level) return;
    const view = Camera.visibleTiles(gameCamera, gameTile, level.width, level.height);
    const tries = Math.min(6, Math.ceil(dt * 90));
    for (let i = 0; i < tries; i++) {
      const x = view.x0 + Math.floor(Math.random() * Math.max(1, view.x1 - view.x0));
      const y = view.y0 + Math.floor(Math.random() * Math.max(1, view.y1 - view.y0));
      if (Level.at(level, x, y) !== Level.TILE.LAVA) continue;
      if (Level.at(level, x, y - 1) === Level.TILE.LAVA) continue; // not the surface
      mote(x + Math.random(), y, 0, -0.7 - Math.random() * 0.5, FRAME.heat, 0.7);
    }
  }

  function drawMotes(ctx) {
    for (const m of motes) {
      const fade = m.life / m.max;
      drawFrame(
        ctx,
        m.frame,
        m.x * gameTile - gameCamera.x,
        m.y * gameTile - gameCamera.y,
        (gameTile / SHEET.fh) * 0.5,
        false,
        fade * 0.75
      );
    }
  }

  function drawRunner(ctx, player) {
    const body = player.body;
    const w = body.w * gameTile;
    const h = body.h * gameTile;
    const px = body.x * gameTile - gameCamera.x;
    const py = body.y * gameTile - gameCamera.y;

    // The art is exactly as tall as the body it belongs to. Drawing it two
    // tiles tall over a 1.6 tile box put four tenths of a tile of head above
    // the collision box, which is head through the ceiling everywhere the
    // ceiling is low — and low ceilings are half the game now.
    //
    // Height is fixed rather than taken from the body, because the body halves
    // for a slide and the art must not squash with it: the slide and crouch
    // frames are already drawn low inside their own cell, and the cell is
    // anchored by the feet, so they sit down without being scaled down.
    const scale = (gameTile * Player.TUNING.height) / SHEET.activeH;
    const flashing = player.recovering > 0 && Math.floor(player.recovering * 20) % 2 === 0;
    const alpha = player.finished ? player.entering : flashing ? 0.45 : 1;

    if (drawFrame(ctx, poseOf(player), px + w / 2, py + h, scale, player.facing < 0, alpha)) return;

    // No sheet: the shape the runner was before there was any art. Recovering
    // flashes; finishing fades into the doorway rather than standing in front
    // of it.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colours.alert;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(px, py, w, h, Math.max(3, gameTile * 0.14));
      ctx.fill();
    } else {
      ctx.fillRect(px, py, w, h);
    }

    // A darker band reads as a head and shows which way the runner faces.
    ctx.fillStyle = colours.ink;
    ctx.globalAlpha *= 0.65;
    const eyeW = w * 0.3;
    ctx.fillRect(px + (player.facing > 0 ? w - eyeW - w * 0.12 : w * 0.12), py + h * 0.16, eyeW, h * 0.12);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- the readout
  //
  // F4. Drawn on the canvas rather than added to the page, because it wants to
  // sit over the world and every overlay added to the page so far has been one
  // more thing that can be visible when it should not be.
  //
  // What it shows is what the last several bugs were about: where the body
  // actually is, which tile that is, and what the physics thinks it is doing.
  let showCoords = false;

  function drawCoords(ctx, player) {
    const b = player.body;
    const lines = [
      "x " + b.x.toFixed(2) + "   y " + b.y.toFixed(2),
      "tile " + Math.floor(b.x + b.w / 2) + ", " + Math.floor(b.y + b.h - 0.01),
      "vx " + b.vx.toFixed(1) + "   vy " + b.vy.toFixed(1),
      "h " + b.h.toFixed(2) +
        (b.onGround ? "  ground" : "  air") +
        (player.onWall ? "  wall" + (player.wallDir < 0 ? "<" : ">") : "") +
        (player.sliding ? (player.skimming ? "  skim" : "  slide") : ""),
      "cam " + (gameCamera.x / gameTile).toFixed(1) + ", " + (gameCamera.y / gameTile).toFixed(1),
      "falls " + player.falls + "   " + clock(player.time),
    ];

    const pad = 10;
    const lead = 16;
    const w = 190;
    const h = lines.length * lead + pad * 2;
    const x = 16;
    const y = 84;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = colours.paper;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colours.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = colours.ink;
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    lines.forEach((text, i) => ctx.fillText(text, x + pad, y + pad + i * lead));
    ctx.restore();
  }

  function clock(seconds) {
    const total = Math.floor(seconds);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function renderGame() {
    const dpr = fitGame();
    const ctx = gameCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = colours.paper;
    ctx.fillRect(0, 0, gameCamera.viewW, gameCamera.viewH);
    if (!level || !session) return;

    drawBackdrop(ctx);

    ctx.save();
    ctx.translate(0, gameOffsetY);
    Level.render(ctx, level, gameCamera, gameTile, colours);
    drawMotes(ctx);
    drawRunner(ctx, session.player);
    ctx.restore();

    // The camera does not follow, so the arrow is the only way back to a runner
    // that has been left behind. The offset is folded in so it agrees with the
    // view rather than the world.
    const body = session.player.body;
    const target = {
      x: (body.x + body.w / 2) * gameTile,
      y: (body.y + body.h / 2) * gameTile + gameOffsetY,
    };
    const behind = gameCamera.x - target.x;
    const ahead = target.x - (gameCamera.x + gameCamera.viewW);
    const away = Math.round(Math.max(behind, ahead, 0) / gameTile);

    UI.offscreenArrow(ctx, gameCamera, target, {
      colour: colours.alert,
      outline: colours.paper,
      label: away > 0 ? away + " M" : null,
      size: 14,
    });

    // The abyss is lit from below. Once the view is down among the deep rock
    // there is molten floor under it, and a warm wash rising off the bottom of
    // the screen is what says so — no light source to place, no shadows to
    // cast, just the suggestion that the dark down here is not empty.
    //
    // Drawn over the world rather than under it, because it is the air between
    // the camera and the rock rather than anything the rock is standing on.
    const deep = gameCamera.y + gameCamera.viewH - GLOW_FROM * gameTile;
    if (deep > 0) {
      const reach = Math.min(gameCamera.viewH * 0.55, deep);
      const glow = ctx.createLinearGradient(0, gameCamera.viewH - reach, 0, gameCamera.viewH);
      // Matched to --lava by hand, because a gradient needs the colour broken
      // into parts and a token arrives as one string.
      glow.addColorStop(0, "rgba(255, 87, 34, 0)");
      glow.addColorStop(1, "rgba(255, 87, 34, 0.07)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, gameCamera.viewH - reach, gameCamera.viewW, reach);
    }

    const player = session.player;
    if (showCoords) drawCoords(ctx, player);

    // Submit once, the moment the door is reached.
    if (player.finished && !session.submitted) {
      session.submitted = true;
      Runs.submit({
        seed: level.seed,
        mode: level.mode,
        reached: Player.metres(player),
        seconds: player.time,
        falls: player.falls,
        finished: true,
        checksum: level.checksum,
      }).catch(() => {
        // A failed submission must never interrupt the run that earned it.
      });
    }

    const line = player.finished
      ? "Through the door · " + clock(player.time)
      : Player.metres(player).toLocaleString("en-US") + " / " + level.meters.toLocaleString("en-US") +
        " m · " + clock(player.time) +
        (player.falls ? " · " + player.falls + " falls" : "");

    if (line !== hudShown) {
      hudShown = line;
      hudDistance.textContent = line;
    }
  }

  function startGame() {
    phase = "game";
    loader.hidden = true;
    gameView.hidden = false;

    session = Game.create(level);
    hudShown = "";
    motes.length = 0;
    dustSeen = 0;
    fallsSeen = 0;
    victoryShown = false; // a new run has its own ending to show

    fitGame();
    const body = session.player.body;
    Camera.centerOn(gameCamera, body.x * gameTile, body.y * gameTile);
    startLoop();
    hudSeed.textContent = level.tutorial
      ? "Tutorial"
      : runSeedText.toUpperCase() + " · " + Level.resolveMode(level.mode).label;
    renderGame();
  }

  function quitGame() {
    phase = "menu";
    session = null;
    gameView.hidden = true;
    loader.hidden = true;
    lesson.hidden = true;
    victory.hidden = true;
    victoryShown = false;
  }

  // One poll per simulation step, so a jump press is consumed by exactly one
  // step no matter how the frame rate wanders.
  function readInput() {
    const frame = Input.poll();
    return {
      left: (frame.mask & Input.SIM.LEFT) !== 0,
      right: (frame.mask & Input.SIM.RIGHT) !== 0,
      jumpHeld: (frame.mask & Input.SIM.JUMP) !== 0,
      jumpPressed: (frame.pressed & Input.SIM.JUMP) !== 0,
      slideHeld: (frame.mask & Input.SIM.DOWN) !== 0,
      mask: frame.mask,
    };
  }

  // ------------------------------------------------------------- the lessons
  //
  // The tutorial stops the world and says one thing. Which keys it names
  // depends on how the player is holding the game, so the text carries tokens
  // rather than key names and they are filled in when it is shown — otherwise a
  // player on the retro scheme is told to press keys that do nothing.
  const TUTORIAL_KEY = "platformer.tutorial_done";
  const KEYCAPS = {
    modern: { move: "A and D", jump: "W or Space", down: "S", camera: "The arrow keys" },
    retro: { move: "Left and Right", jump: "Z or Space", down: "Down", camera: "W A S D" },
  };

  const lesson = document.querySelector("[data-lesson]");
  const lessonStep = document.querySelector("[data-lesson-step]");
  const lessonTitle = document.querySelector("[data-lesson-title]");
  const lessonBody = document.querySelector("[data-lesson-body]");
  const lessonHint = document.querySelector("[data-lesson-hint]");

  function keycaps(text) {
    const caps = KEYCAPS[Input.schemeId()] || KEYCAPS.modern;
    return text.replace(/\{(\w+)\}/g, (whole, name) => caps[name] || whole);
  }

  function showLesson(card) {
    const total = level && level.teach ? level.teach.length : 0;
    lessonStep.textContent = "Step " + session.taught + " of " + total;
    lessonTitle.textContent = card.title;
    lessonBody.textContent = keycaps(card.body);
    lessonHint.textContent = card.hint;
    lesson.hidden = false;
  }

  // The card comes down whatever the state behind it says. Guarding the hide
  // behind "is there a lesson" is how a card with nothing behind it becomes a
  // button that dismisses nothing.
  function resumeLesson() {
    lesson.hidden = true;
    if (session && session.lesson) Game.resume(session);
  }

  document.querySelector('[data-action="resume"]').addEventListener("click", resumeLesson);

  function startTutorial() {
    // Whatever the menu says, this run is the tutorial.
    startLoading("TUTORIAL");
  }

  // ------------------------------------------------------------- the doorway
  const victory = document.querySelector("[data-victory]");
  const victoryStats = document.querySelector("[data-victory-stats]");
  // The card is shown once per run and stays until it is dismissed. Without a
  // flag it would come straight back: the frame after it is hidden the runner
  // is still finished, and the loop would put it up again.
  let victoryShown = false;

  function stat(label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    victoryStats.append(term, detail);
  }

  function showVictory(player) {
    victoryStats.textContent = "";
    stat("Seed", level.tutorial ? "Tutorial" : runSeedText.toUpperCase());
    stat("Mode", level.tutorial ? "200 m" : Level.resolveMode(level.mode).label);
    stat("Time", clock(player.time));
    stat("Falls", String(player.falls));
    // No timer. A card that takes itself away is a card you were still
    // reading, and its numbers are the whole point of having finished.
    victory.hidden = false;
    victoryShown = true;

    // Finishing it once is what counts as having done it.
    if (level.tutorial) {
      try {
        localStorage.setItem(TUTORIAL_KEY, "yes");
      } catch (err) {
        // Private window: they will be offered it again, which is no disaster.
      }
    }
  }

  // Out through the canvas rather than cut away from it, and into the tab the
  // run just wrote a row to.
  function returnToLobby() {
    if (phase !== "game") return;
    victory.hidden = true;
    gameView.classList.add("is-leaving");
    window.setTimeout(() => {
      gameView.classList.remove("is-leaving");
      quitGame();
      showPanel("runs");
    }, 320);
  }

  document.querySelector('[data-action="continue"]').addEventListener("click", returnToLobby);

  playButton.addEventListener("click", () => startLoading());
  document.querySelector('[data-action="tutorial"]').addEventListener("click", startTutorial);
  document.querySelector('[data-action="quit"]').addEventListener("click", quitGame);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && phase !== "menu") quitGame();

    // F4 is not bound to anything the game does, so it is free for the thing
    // that tells you where the game thinks you are.
    if (event.code === "F4") {
      event.preventDefault();
      showCoords = !showCoords;
      return;
    }

    if (event.code !== "Space" || phase !== "game") return;

    // Space is jump, so it is only borrowed while something is actually asking
    // to be dismissed — and then it is taken, so the same press does not also
    // launch the runner out of the doorway it is standing in.
    if (!victory.hidden) {
      event.preventDefault();
      returnToLobby();
    } else if (session && session.lesson) {
      event.preventDefault();
      resumeLesson();
    }
  });

  // --------------------------------------------------------------------- boot

  // The controls list is the scheme, so it is drawn from the scheme rather than
  // written out beside it — otherwise switching would leave the menu confidently
  // describing keys that no longer do anything.
  const controlsList = document.querySelector("[data-controls]");
  const schemeChips = document.querySelectorAll("[data-scheme]");

  function drawControls() {
    controlsList.textContent = "";
    Input.controls().forEach((entry) => {
      const term = document.createElement("dt");
      term.className = "controls__action";
      term.textContent = entry.action;

      const detail = document.createElement("dd");
      detail.className = "controls__keys";
      detail.textContent = entry.keys;

      controlsList.append(term, detail);
    });

    schemeChips.forEach((chip) => {
      const on = chip.dataset.scheme === Input.schemeId();
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  schemeChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      Input.setScheme(chip.dataset.scheme);
      drawControls();
    });
  });

  drawControls();

  Input.attach();

  // The menu is plain DOM, so the frame loop stops entirely while it is up and
  // starts again on Play. An idle menu should not be asking for frames.
  let lastFrame = performance.now();
  let looping = false;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (phase === "menu") {
      looping = false;
      return;
    }

    if (phase === "loading") {
      updateLoading(now);
    } else if (phase === "game") {
      Game.advance(session, dt, readInput);

      // Weather. Watched off the simulation rather than driven by it, so a
      // dropped frame costs a puff of dust and never a jump.
      const runner = session.player;
      const feet = runner.body.y + runner.body.h;
      const middle = runner.body.x + runner.body.w / 2;
      if (runner.dust > dustSeen) {
        puff(middle, feet, 3, 3);
        dustSeen = runner.dust;
      }
      if (runner.falls > fallsSeen) {
        // Out of the lava it just cost you: smoke where the runner went in.
        puff(middle, feet, 5, 4);
        fallsSeen = runner.falls;
      }
      if (runner.sliding && runner.body.onGround && Math.abs(runner.body.vx) > 7) {
        puff(middle - Math.sign(runner.body.vx) * 0.4, feet, 1, 1.5);
      }
      breatheLava(dt);
      stepMotes(dt);

      // A lesson waiting to be read, and a run waiting to bow out. Both are
      // about the frame loop noticing something the simulation decided.
      if (session.lesson && lesson.hidden) showLesson(session.lesson);
      if (session.player.finished && !victoryShown) showVictory(session.player);

      // A step and a half faster than the runner for placing the view, two and a
      // half with shift for sweeping the map — both flat, neither ramps.
      const sweep = Input.fastView() ? 2.5 : 1.5;
      Camera.update(gameCamera, dt, Input.cameraAxis(), Player.TUNING.runSpeed * sweep * gameTile);
      renderGame();
    }

    requestAnimationFrame(frame);
  }

  function startLoop() {
    if (looping) return;
    looping = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function boot() {
    seedInput.value = Rng.randomSeed();
    setSource("random");
    refresh();

    // Nobody's first run should be a 1000 metre cave they have not been told
    // the rules of. Offered once, remembered once finished, and always there on
    // the menu afterwards for anyone who wants it again.
    let taught = false;
    try {
      taught = localStorage.getItem(TUTORIAL_KEY) === "yes";
    } catch (err) {
      taught = false; // storage blocked: offer it, which is the safer mistake
    }
    if (!taught) startTutorial();
  }

  // The menu waits for the gate. Booting behind the login card would roll a seed
  // and start the loop for someone who is not signed in yet.
  const gate = document.querySelector(".app");
  if (!gate || !gate.hidden) boot();
  else window.addEventListener("platformer:unlocked", boot, { once: true });
})();
