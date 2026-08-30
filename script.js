// script.js — main menu: seed choice, run length, and handing off to a run

(() => {
  const SOUND_KEY = "platformer.sound";

  const soundButton = document.querySelector('[data-toggle="sound"]');
  const fullscreenButton = document.querySelector('[data-action="fullscreen"]');
  const playButton = document.querySelector('[data-action="play"]');

  function setSound(on) {
    soundButton.classList.toggle("is-on", on);
    soundButton.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch (e) {
      /* private mode — the preference just does not persist */
    }
  }

  let soundOn = true;
  try {
    soundOn = localStorage.getItem(SOUND_KEY) !== "off";
  } catch (e) {
    /* storage unavailable */
  }
  setSound(soundOn);

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    setSound(soundOn);
  });

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
    hazeFar: token("--haze-far"),
    hazeNear: token("--haze-near"),
    rule: token("--rule"),
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

  function startLoading() {
    phase = "loading";
    // The honest part: the run is generated here, the moment Play is pressed.
    level = Level.generate(seedInput.value, { mode: activeValue(modeButtons, "mode") });
    loader.hidden = false;

    loadMeta =
      "Seed " + seedInput.value.toUpperCase() + " · " + level.meters.toLocaleString("en-US") + " m";
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

  // World row where daylight stops. Above it is sky and parallax; below it is
  // rock, and the backdrop must not show through it.
  const SKY_BOTTOM = 26;

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

  function drawRunner(ctx, player) {
    const body = player.body;
    const w = body.w * gameTile;
    const h = body.h * gameTile;
    const px = body.x * gameTile - gameCamera.x;
    const py = body.y * gameTile - gameCamera.y;

    // Recovering flashes, so a setback is visible without a message.
    ctx.globalAlpha = player.recovering > 0 && Math.floor(player.recovering * 20) % 2 === 0 ? 0.35 : 1;
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

    const player = session.player;

    // Submit once, whether the run ended at the door or in the lava.
    if ((player.finished || player.dead) && !session.submitted) {
      session.submitted = true;
      Runs.submit({
        seed: level.seed,
        mode: level.mode,
        reached: Player.metres(player),
        seconds: player.time,
        falls: player.falls,
        finished: player.finished,
        checksum: level.checksum,
      }).catch(() => {
        // A failed submission must never interrupt the run that earned it.
      });
    }

    const line = session.scout > 0
      ? "Scan the map · " + Math.ceil(session.scout) + "s · arrows to look, shift to sweep"
      : player.dead
      ? "Lost to the lava · " + Player.metres(player).toLocaleString("en-US") + " m · escape to leave"
      : player.finished
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

    fitGame();
    const body = session.player.body;
    Camera.centerOn(gameCamera, body.x * gameTile, body.y * gameTile);
    startLoop();
    hudSeed.textContent = seedInput.value.toUpperCase() + " · " + Level.resolveMode(level.mode).label;
    renderGame();
  }

  function quitGame() {
    phase = "menu";
    session = null;
    gameView.hidden = true;
    loader.hidden = true;
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
      mask: frame.mask,
    };
  }

  playButton.addEventListener("click", startLoading);
  document.querySelector('[data-action="quit"]').addEventListener("click", quitGame);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && phase !== "menu") quitGame();
  });

  // --------------------------------------------------------------------- boot

  Input.SCHEME.forEach((entry) => {
    const term = document.createElement("dt");
    term.className = "controls__action";
    term.textContent = entry.action;

    const detail = document.createElement("dd");
    detail.className = "controls__keys";
    detail.textContent = entry.keys;

    document.querySelector("[data-controls]").append(term, detail);
  });

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
  }

  // The menu waits for the gate. Booting behind the login card would roll a seed
  // and start the loop for someone who is not signed in yet.
  const gate = document.querySelector(".app");
  if (!gate || !gate.hidden) boot();
  else window.addEventListener("platformer:unlocked", boot, { once: true });
})();
