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
    // The two ends of the depth ramp, for the rock and for the air behind it.
    // The gems carry their own colours: they are artwork, not theme.
    rockTop: token("--rock-top"),
    rockBottom: token("--rock-bottom"),
    voidTop: token("--void-top"),
    voidBottom: token("--void-bottom"),
    // The one thing on the menu that is neither paper nor stone.
    gold: token("--gold"),
    goldLight: token("--gold-light"),
  };

  // The menu is paper and the cave is not, so anything painted on the canvas
  // takes this set instead: the same palette with the page's lights and darks
  // swapped for the world's. It is the whole of the split — the canvas clears
  // to the void rather than to paper, and every line drawn over the rock reads
  // light-on-dark rather than the other way round.
  //
  // Sharing one set is how lightening a menu turns a cave into a snowfield.
  const world = Object.assign({}, colours, {
    paper: token("--world-void"),
    ink: token("--world-ink"),
    inkSoft: token("--world-ink-soft"),
    inkMuted: token("--world-ink-muted"),
    rule: token("--world-rule"),
  });

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

  // ---------------------------------------------------------------- career
  //
  // Only finished runs, and never the tutorial. A distance you did not reach
  // the door of is not a distance you covered, so the total is always an exact
  // pile of thousands — which is what makes it worth looking at rather than a
  // number that drifts up whenever you press Play.
  const TOTAL_KEY = "platformer.total_meters";
  const totalSlots = Array.from(document.querySelectorAll("[data-total-meters]"));

  function readTotal() {
    try {
      const raw = Number(localStorage.getItem(TOTAL_KEY));
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    } catch (err) {
      return 0; // storage blocked: the career is this session's, and that is all
    }
  }

  function distance(metres) {
    if (metres >= 10000) {
      const km = metres / 1000;
      return (km % 1 === 0 ? km : km.toFixed(1)) + " km";
    }
    return metres.toLocaleString("en-US") + " m";
  }

  function showTotal() {
    const total = readTotal();
    const text = total ? distance(total) + " run" : "";
    totalSlots.forEach((slot) => {
      slot.textContent = text;
      slot.hidden = !total;
    });
  }

  function addToTotal(metres) {
    const next = readTotal() + metres;
    try {
      localStorage.setItem(TOTAL_KEY, String(next));
    } catch (err) {
      // Nothing to do: the run still happened, it just is not remembered.
    }
    showTotal();
  }

  // ---------------------------------------------------------------- ghosts
  //
  // A run keeps its own tape, per seed, and only when it beat what was there
  // before — so the ghost you race is your best on that cave rather than your
  // last. Kept here rather than sent anywhere: a tape is a few kilobytes and
  // nobody else has any use for it.
  const GHOST_KEY = "platformer.ghost.";

  function ghostFor(seed) {
    try {
      const raw = localStorage.getItem(GHOST_KEY + seed);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      return saved && saved.tape ? saved : null;
    } catch (err) {
      return null;
    }
  }

  function keepGhost(seed, seconds, tapeString) {
    const best = ghostFor(seed);
    if (best && best.seconds <= seconds) return;
    try {
      localStorage.setItem(GHOST_KEY + seed, JSON.stringify({ seconds, tape: tapeString }));
    } catch (err) {
      // A full or blocked store costs the ghost, not the run.
    }
  }

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

  // Painted twice: once from this machine's own copy, which is already in
  // hand and needs no network, and again if the cloud has anything the local
  // list is missing. The first paint is the one the player sees — a run they
  // finished ten seconds ago must not wait on a request that may never answer.
  function loadRuns() {
    renderRuns(Runs.getLocalRuns());
    Runs.mine(10).then(renderRuns).catch(() => {
      // Already showing what is on this machine; the cloud adds nothing today.
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
    playLayer.hidden = true;
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
  const hudSplit = document.querySelector("[data-hud-split]");

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
  let splitShown = "";

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

  // ------------------------------------------------------------ stalactites
  //
  // Drawn here rather than in Level.render, because these move: the level knows
  // where they hang, the session knows which have fallen, and only one of those
  // two is the same picture every frame.
  function drawStalactites(ctx, list, now) {
    if (!list) return;
    const dot = Math.max(1, Math.round(gameTile / 8));
    const w = Enemy.ART_W * dot;

    for (const s of list) {
      if (s.state === "shattered") {
        // One puff, the first frame it is seen broken. The flag is the
        // renderer's own — the simulation never reads it, so a run with the
        // window closed plays out exactly the same.
        if (!s.puffed) {
          s.puffed = true;
          puff(s.x + 0.5, s.floorY, 5, 4);
        }
        continue;
      }

      const px = s.x * gameTile - gameCamera.x + (gameTile - w) / 2;
      const py = s.y * gameTile - gameCamera.y;
      if (px < -w || px > gameCamera.viewW + w) continue;

      // The tell. A tile of rock grinding itself loose, a fifth of a second
      // before it is a problem — which is the whole difference between a hazard
      // and an ambush.
      let shake = 0;
      if (s.state === "shaking") {
        shake = Math.sin(now * 45 + s.x) > 0 ? 1 : -1;
        if (Math.random() < 0.25) {
          mote(s.x + 0.5, s.y + 0.9, (Math.random() - 0.5) * 0.6, 0.5, FRAME.dust, 0.3);
        }
      }

      for (const cell of Enemy.ART) {
        ctx.fillStyle = cell.c;
        ctx.fillRect(px + shake + cell.x * dot, py + cell.y * dot, dot, dot);
      }
    }
  }

  // Your best run on this cave, played back beside you. Same sprite, a third
  // of the opacity, and no fallback: with no sheet loaded there is nothing to
  // draw a ghost with that would not read as a second real runner.
  function drawGhost(ctx, ghost) {
    const body = ghost.body;
    const scale = (gameTile * Player.TUNING.height) / SHEET.activeH;
    drawFrame(
      ctx,
      poseOf(ghost),
      body.x * gameTile - gameCamera.x + (body.w * gameTile) / 2,
      body.y * gameTile - gameCamera.y + body.h * gameTile,
      scale,
      ghost.facing < 0,
      0.32
    );
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
    ctx.fillStyle = world.alert;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(px, py, w, h, Math.max(3, gameTile * 0.14));
      ctx.fill();
    } else {
      ctx.fillRect(px, py, w, h);
    }

    // A darker band reads as a head and shows which way the runner faces.
    ctx.fillStyle = world.ink;
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
    ctx.fillStyle = world.paper;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = world.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = world.ink;
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

    // The air is not one dark. It is lighter near the roof and nearly black at
    // the mantle, mixed across whatever slice of the world the camera is
    // looking at — so the background says how deep you are before you have seen
    // a wall, and looking up or down actually changes something.
    if (level) {
      const top = gameCamera.y / gameTile;
      const bottom = (gameCamera.y + gameCamera.viewH) / gameTile;
      const air = ctx.createLinearGradient(0, 0, 0, gameCamera.viewH);
      air.addColorStop(0, Level.depthTint(top, level.height, world.voidTop, world.voidBottom));
      air.addColorStop(1, Level.depthTint(bottom, level.height, world.voidTop, world.voidBottom));
      ctx.fillStyle = air;
    } else {
      ctx.fillStyle = world.paper;
    }
    ctx.fillRect(0, 0, gameCamera.viewW, gameCamera.viewH);
    if (!level || !session) return;

    drawBackdrop(ctx);

    ctx.save();
    ctx.translate(0, gameOffsetY);
    Level.render(ctx, level, gameCamera, gameTile, world, performance.now() / 1000);
    drawStalactites(ctx, session.stalactites, performance.now() / 1000);
    drawMotes(ctx);
    // The ghost goes down before the runner, and faintly: it is there to be
    // chased, not to be mistaken for you at a glance.
    if (session.ghost) drawGhost(ctx, session.ghost);
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
      colour: world.alert,
      outline: world.paper,
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

    const line = player.finished
      ? "Through the door · " + clock(player.time)
      : Player.metres(player).toLocaleString("en-US") + " / " + level.meters.toLocaleString("en-US") +
        " m · " + clock(player.time) +
        (player.falls ? " · " + player.falls + " falls" : "");

    if (line !== hudShown) {
      hudShown = line;
      hudDistance.textContent = line;
    }

    // The split. Ground gained or lost against your own best run on this cave,
    // in metres, which is the only number that matters while you are running —
    // a clock tells you how long you have taken, and this tells you whether
    // that was any good.
    //
    // Written only when it changes, like the line above it: this is a number
    // that moves every step, and touching the DOM sixty times a second to say
    // the same thing is how a HUD costs you frames.
    if (session.ghost) {
      const delta = Math.round(player.body.x - session.ghost.body.x);
      const text = delta === 0 ? "" : (delta > 0 ? "+" : "") + delta + " m";
      if (text !== splitShown) {
        splitShown = text;
        hudSplit.textContent = text;
        hudSplit.hidden = !text;
        hudSplit.classList.toggle("is-ahead", delta > 0);
        hudSplit.classList.toggle("is-behind", delta < 0);
      }
    } else if (splitShown !== "") {
      splitShown = "";
      hudSplit.hidden = true;
    }
  }

  function startGame() {
    phase = "game";
    loader.hidden = true;
    gameView.hidden = false;

    // Your best on this cave, if you have one, comes along to race.
    const ghost = level.tutorial ? null : ghostFor(level.seed);
    session = Game.create(level, { ghostTape: ghost && ghost.tape });
    splitShown = "";
    hudSplit.hidden = true;
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
    // Back on the menu, and back on your feet at the left end of it: the runner
    // who went through the door is finished, and a finished runner does not
    // move again.
    playLayer.hidden = false;
    resetPlayground();
    startLoop();
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

    // A finished cave adds its full length to the career, and never the
    // tutorial: the total is a record of caves crossed, not time spent.
    if (!level.tutorial && player.finished) {
      addToTotal(level.meters);
      keepGhost(level.seed, player.time, Game.tape(session));

      // Written here rather than on the frame the door was touched, so the row
      // exists before the card announcing it does. The tutorial stays out for
      // the reason it stays out of the career: this is a list of caves
      // crossed, and a lesson has no mode label to show in one.
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
      loadRuns();
    }

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

  // ---------------------------------------------------------- the playground
  //
  // The menu is a level. Every card, shelf and chip row on it is a real
  // surface, the screen edges are walls, and the runner you play the game with
  // is standing on the bottom of it waiting for you to do something.
  //
  // The collision is read off the page with getBoundingClientRect rather than
  // written down anywhere, so it is whatever the menu actually looks like right
  // now: switch tabs, change the control scheme, resize the window, and it is
  // rebuilt from the new layout instead of from a copy that has quietly stopped
  // being true.

  const playLayer = document.querySelector("[data-playground-layer]");
  const playCanvas = document.querySelector("[data-playground]");
  const playCtx = playCanvas.getContext("2d");
  const doorButton = document.querySelector("[data-door]");

  let playLevel = null;
  let playRunner = null;
  let playAcc = 0;
  let playDirty = true;
  let playEntering = false;
  let doorRect = null;

  // Anything that moves a card moves the ground under the runner's feet. The
  // rebuild is deferred to the next frame rather than done on the spot, because
  // one click can change three things and the layout is only worth measuring
  // once it has finished changing.
  function queuePlayground() {
    playDirty = true;
  }

  // Somewhere on the page that takes typing. While one of these holds the focus
  // the runner is handed a dead keyboard: A and D are letters first.
  function typing() {
    const el = document.activeElement;
    if (!el || !el.tagName) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
  }

  function inRock(level, body) {
    const x0 = Math.floor(body.x + 0.001);
    const x1 = Math.floor(body.x + body.w - 0.001);
    const y0 = Math.floor(body.y + 0.001);
    const y1 = Math.floor(body.y + body.h - 0.001);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (Physics.solidAt(level, x, y)) return true;
    }
    return false;
  }

  // A rebuild can close the space a body was standing in: open the runs tab and
  // a card appears where the runner was mid-jump. Lift them out of it, and
  // failing that put them back at the start, which is always dug clear.
  function freeUp(level, runner) {
    const body = runner.body;
    let lifted = 0;
    while (inRock(level, body) && lifted < level.height) {
      body.y -= 1;
      lifted++;
    }
    if (!inRock(level, body)) return;
    body.x = level.spawn.x + (1 - body.w) / 2;
    body.y = level.spawn.y + 1 - body.h;
    body.vx = 0;
    body.vy = 0;
  }

  function rebuildPlayground() {
    playDirty = false;

    // The layer is position:fixed inset:0, so it stops at the scrollbars â and
    // so do the rects every card is measured with. innerWidth counts the
    // scrollbar in, which would put the right-hand wall behind it.
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    playCanvas.width = Math.round(w * dpr);
    playCanvas.height = Math.round(h * dpr);
    playCanvas.style.width = w + "px";
    playCanvas.style.height = h + "px";
    playCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    playLevel = Mainscreen.fromPage(document, w, h, { sky: playSky });

    // Measured in the same pass as the collision, so the art lands exactly
    // where the tiles that finish the run are.
    doorRect = doorButton ? doorButton.getBoundingClientRect() : null;

    if (!playRunner) {
      playRunner = Player.create(playLevel);
      return;
    }

    // Keep them where they were standing. Only the room around them changed.
    const body = playRunner.body;
    body.x = Math.max(1, Math.min(body.x, playLevel.width - body.w - 1));
    body.y = Math.min(body.y, playLevel.height - body.h - 1);
    freeUp(playLevel, playRunner);
    playRunner.safe.x = body.x;
    playRunner.safe.y = body.y;
  }

  function resetPlayground() {
    playRunner = null;
    playSky = false;
    playDust.length = 0;
    playAcc = 0;
    playEntering = false;
    queuePlayground();
  }

  const IDLE = {
    left: false, right: false, jumpHeld: false, jumpPressed: false, slideHeld: false, mask: 0,
  };

  function stepPlayground(dt) {
    if (playDirty || !playLevel) rebuildPlayground();

    playAcc += Math.min(dt, 0.25);
    let taken = 0;
    while (playAcc >= Game.STEP && taken < Game.MAX_CATCHUP) {
      // Polled either way. Skipping the poll while someone types would bank the
      // press edges and fire them all the moment the field loses focus.
      const live = readInput();
      Player.update(playRunner, playLevel, typing() ? IDLE : live, Game.STEP);
      playAcc -= Game.STEP;
      taken++;
    }
    if (taken === Game.MAX_CATCHUP) playAcc = 0;

    stepDust(dt);
    if (!playSky && comboHeld() && inSecretZone(playRunner.body)) armSky();
    checkVault();

    // Into the door. Player.update stops the runner dead in the doorway and
    // fades them into it over half a second; the run starts when there is
    // nothing left of them to see, so the menu is not yanked away mid-stride.
    if (playRunner.finished) playEntering = true;
    if (playEntering && playRunner.entering === 0) {
      playEntering = false;
      startLoading();
    }
  }

  // ---------------------------------------------------------------- the door
  //
  // Pixel art rather than a picture: twelve across by eighteen down, scaled to
  // whatever box the page gave the button and with the pixel size rounded down,
  // so the planks stay square and the seams stay straight at any size.
  const DOOR_ART = [
    "....####....",
    "..########..",
    ".##########.",
    "############",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=o=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "#=|=|==|=|=#",
    "############",
    "############",
  ];

  const DOOR_INK = { "#": "ink", "=": "stone", "|": "inkSoft", o: "accent" };

  function drawDoor(ctx) {
    if (!doorRect) return;

    const cols = DOOR_ART[0].length;
    const rows = DOOR_ART.length;
    const px = Math.max(1, Math.floor(Math.min(doorRect.width / cols, doorRect.height / rows)));
    const artW = px * cols;
    const artH = px * rows;
    const left = doorRect.left + (doorRect.width - artW) / 2;
    const top = doorRect.top + (doorRect.height - artH) / 2;

    // A little warmth spilling out from under it, so the door reads as the way
    // through rather than as one more box on a page of boxes.
    const cx = left + artW / 2;
    const cy = top + artH * 0.62;
    const reach = artW * 1.9;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    glow.addColorStop(0, "rgba(255, 87, 34, 0.18)");
    glow.addColorStop(1, "rgba(255, 87, 34, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const ink = DOOR_INK[DOOR_ART[row][col]];
        if (!ink) continue;
        ctx.fillStyle = colours[ink];
        ctx.fillRect(left + col * px, top + row * px, px, px);
      }
    }
  }

  function renderPlayground() {
    playCtx.clearRect(0, 0, document.documentElement.clientWidth,
      document.documentElement.clientHeight);
    drawDoor(playCtx);
    drawSky(playCtx);
    drawDust(playCtx);

    const body = playRunner.body;
    const T = Mainscreen.TILE;
    const scale = (T * Player.TUNING.height) / SHEET.activeH;
    const flashing = playRunner.recovering > 0 && Math.floor(playRunner.recovering * 20) % 2 === 0;
    const alpha = playRunner.finished ? playRunner.entering : flashing ? 0.45 : 1;
    const centreX = (body.x + body.w / 2) * T;
    const feetY = (body.y + body.h) * T;

    if (drawFrame(playCtx, poseOf(playRunner), centreX, feetY, scale, playRunner.facing < 0, alpha)) return;

    // No sheet loaded: a shape rather than nothing, in the menu's own ink so it
    // reads as part of the page instead of as a broken image.
    playCtx.globalAlpha = alpha;
    playCtx.fillStyle = colours.ink;
    playCtx.fillRect(centreX - (body.w * T) / 2, feetY - body.h * T, body.w * T, body.h * T);
    playCtx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- the secret
  //
  // Nothing announces this and nothing ever will. Get the runner into the top
  // left corner of the menu — which takes a long climb up the left-hand wall,
  // one kick at a time — and hold K, C and R together, and a stone bridge
  // arrives across the top of the screen with a training gauntlet on the end
  // of it.
  //
  // The three keys are watched here rather than in input.js because input.js
  // only knows the four bits the simulation runs on, and a recording of a run
  // has no business carrying a cheat code in it.
  const COMBO = ["KeyK", "KeyC", "KeyR"];
  const comboDown = new Set();

  let playSky = false;
  // Set when a window turns out to have no room for the gauntlet, and cleared
  // when the keys come up. Without it the combo would build and unbuild the
  // level twice a frame for as long as it is held.
  let skyRefused = false;

  function comboHeld() {
    return COMBO.every((code) => comboDown.has(code));
  }

  // The top left corner, in page pixels, which is what the zone was described
  // in — the runner is measured in tiles, so it is converted rather than the
  // other way round.
  function inSecretZone(body) {
    return body.x * Mainscreen.TILE < 150 && body.y * Mainscreen.TILE < 140;
  }

  document.addEventListener("keydown", (event) => {
    if (COMBO.indexOf(event.code) < 0 || typing()) return;
    comboDown.add(event.code);
  });

  document.addEventListener("keyup", (event) => {
    comboDown.delete(event.code);
    skyRefused = false;
  });

  // Alt-tabbing away with two of the three down otherwise leaves them down.
  window.addEventListener("blur", () => comboDown.clear());

  // ---------------------------------------------------------------- the dust
  //
  // The playground's own weather, in tiles, with its own little step. The
  // game's motes are tied to the camera and the game's tile size, and neither
  // of those exists up here.
  const playDust = [];

  function puffSky(x, y, count, spread, gold) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * spread;
      playDust.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - spread * 0.4,
        life: 0.5 + Math.random() * 0.6,
        age: 0,
        gold: Boolean(gold),
      });
    }
  }

  function stepDust(dt) {
    for (let i = playDust.length - 1; i >= 0; i--) {
      const mote = playDust[i];
      mote.age += dt;
      if (mote.age >= mote.life) {
        playDust.splice(i, 1);
        continue;
      }
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      mote.vy += 5 * dt; // barely any weight: this is dust, not gravel
      mote.vx *= 0.96;
    }
  }

  function drawDust(ctx) {
    const T = Mainscreen.TILE;
    playDust.forEach((mote) => {
      const left = 1 - mote.age / mote.life;
      ctx.globalAlpha = left * 0.7;
      ctx.fillStyle = mote.gold ? colours.goldLight : colours.inkMuted;
      const size = Math.max(1, Math.round(left * 4));
      ctx.fillRect(Math.round(mote.x * T), Math.round(mote.y * T), size, size);
    });
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------- arming the sky

  function armSky() {
    if (playSky || skyRefused) return;
    playSky = true;
    rebuildPlayground();

    // No room for the gauntlet on this window: put it back the way it was
    // rather than build half of it.
    if (!playLevel.sky) {
      playSky = false;
      skyRefused = true;
      rebuildPlayground();
      return;
    }

    const entry = playLevel.sky.entry;
    const body = playRunner.body;
    body.x = entry.x + (1 - body.w) / 2;
    body.y = entry.y + 1 - body.h;
    body.vx = 0;
    body.vy = 0;
    playRunner.safe.x = body.x;
    playRunner.safe.y = body.y;
    playRunner.sliding = false;
    body.h = Player.TUNING.height;

    puffSky(body.x + body.w / 2, body.y + body.h, 22, 3.2);
  }

  // The vault, and the way home. Reached only by climbing the eight tiles of
  // blank face under the bridge, which is the last thing the gauntlet asks for.
  function checkVault() {
    const box = playSky && playLevel.sky && playLevel.sky.exit;
    if (!box) return;

    const body = playRunner.body;
    if (!(body.x < box.x + box.w && body.x + body.w > box.x &&
          body.y < box.y + box.h && body.y + body.h > box.y)) return;

    puffSky(body.x + body.w / 2, body.y + body.h, 40, 5, true);
    playSky = false;
    rebuildPlayground();

    // Home the long way: the sky is gone from under them and they fall the
    // whole height of the menu to the floor they started on.
    playRunner.safe.x = playLevel.spawn.x + (1 - body.w) / 2;
    playRunner.safe.y = playLevel.spawn.y + 1 - body.h;
    body.vx = 0;
    body.vy = 0;
  }

  // ------------------------------------------------------------ drawing it
  //
  // Every tile the carver laid, and nothing else: what is drawn and what is
  // solid come from the same list, so the bridge cannot grow a step that is
  // only paint.
  const SCONCE = [
    "...##...",
    "..####..",
    ".##oo##.",
    "##o..o##",
    "##o..o##",
    ".##oo##.",
    "..####..",
    "...##...",
  ];

  function drawSky(ctx) {
    if (!playSky || !playLevel.sky) return;
    const T = Mainscreen.TILE;

    ctx.fillStyle = colours.stone;
    playLevel.sky.tiles.forEach((tile) => {
      ctx.fillRect(tile.x * T, tile.y * T, T, T);
    });

    // A lit top edge on any tile with sky above it, so a deck reads as
    // something to land on rather than as a bar of shadow.
    ctx.fillStyle = colours.stoneRim;
    playLevel.sky.tiles.forEach((tile) => {
      if (Level.at(playLevel, tile.x, tile.y - 1) === Level.TILE.GROUND) return;
      ctx.fillRect(tile.x * T, tile.y * T, T, 2);
    });

    const box = playLevel.sky.exit;
    const px = Math.max(1, Math.floor((box.w * T) / SCONCE[0].length));
    const artW = px * SCONCE[0].length;
    const artH = px * SCONCE.length;
    const left = box.x * T + (box.w * T - artW) / 2;
    const top = box.y * T + (box.h * T - artH) / 2;

    const cx = left + artW / 2;
    const cy = top + artH / 2;
    const reach = artW * 1.6;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    glow.addColorStop(0, "rgba(240, 217, 122, 0.5)");
    glow.addColorStop(1, "rgba(240, 217, 122, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);

    for (let row = 0; row < SCONCE.length; row++) {
      for (let col = 0; col < SCONCE[row].length; col++) {
        const mark = SCONCE[row][col];
        if (mark === ".") continue;
        ctx.fillStyle = mark === "o" ? colours.goldLight : colours.gold;
        ctx.fillRect(left + col * px, top + row * px, px, px);
      }
    }
  }

  window.addEventListener("resize", () => {
    queuePlayground();
    if (phase === "game") fitGame();
  });

  // Any click can move a card, and a mouse click leaves its button focused,
  // which would hand every keypress to that button instead of to the runner.
  // Only real pointer clicks blur: activating a button from the keyboard has no
  // pointer behind it, and stealing focus there would strand a keyboard user
  // halfway down the menu with nothing selected.
  // The menu cards rise into place over the first second, one after another.
  // Collision measured while that is still happening is collision for where the
  // cards were passing through rather than where they came to rest, so each one
  // asks for a rebuild as it settles.
  document.addEventListener("animationend", queuePlayground);

  document.addEventListener("click", (event) => {
    queuePlayground();
    const control = event.target && event.target.closest && event.target.closest("button");
    if (control && event.detail > 0) control.blur();
  });

  drawControls();

  Input.attach();

  // The menu is a level now, so the loop runs the whole time the page is up.
  // It was stopped on the menu when the menu was plain DOM and nothing on it
  // moved; there is somebody standing on it now.
  let lastFrame = performance.now();
  let looping = false;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (phase === "menu") {
      stepPlayground(dt);
      renderPlayground();
      requestAnimationFrame(frame);
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
    showTotal();
    startLoop();
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
