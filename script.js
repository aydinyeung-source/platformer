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
  // pile of whole caves — which is what makes it worth looking at rather than a
  // number that drifts up whenever you press Play.
  //
  // Whole caves used to mean whole thousands. The sprint is half of one, so the
  // total now lands on halves as well, and the reading below has to say so.
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

  // Metres up to ten thousand of them, kilometres after that. Every run is a
  // multiple of five hundred, so a career only ever lands on a whole kilometre
  // or a half — and one decimal place says a half exactly. There is no rounding
  // here to be wrong about: a total that reads 10.5 km is 10 500 metres.
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

    // Painted twice — once from this machine, once when the cloud answers — and
    // the second paint can be a taller list than the first. Same reason the
    // board measures again after its rows land.
    queuePlayground();
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

  // ----------------------------------------------------- the daily leaderboard

  const boardList = document.querySelector("[data-board-list]");
  const boardNote = document.querySelector("[data-board-note]");

  // Time, and what it cost. A clean run says so by not mentioning it: printing
  // "0 falls" on every row makes the number furniture, and the whole reason it
  // is there is that it is the difference between two runs of the same length.
  function result(row) {
    const time = Runs.clock(row.seconds);
    if (!row.falls) return time;
    return time + " · " + row.falls + (row.falls === 1 ? " fall" : " falls");
  }

  function renderBoard(rows, empty) {
    boardList.textContent = "";

    if (!rows || !rows.length) {
      boardNote.hidden = false;
      boardNote.textContent = empty;
    } else {
      boardNote.hidden = true;
      rows.forEach((row, i) => {
        const item = document.createElement("li");
        item.className = "board__row";
        cell(item, "board__place", "#" + (i + 1));
        cell(item, "board__who", row.who);
        cell(item, "board__time", result(row));
        boardList.append(item);
      });
    }

    // The shelf just changed height, and the shelf is something the runner
    // stands on. Collision is read off the page, so the page has to be measured
    // again or there is a card here with nothing underneath it.
    queuePlayground();
  }

  function loadBoard() {
    // The board is everyone's runs, which means it is the one thing here that
    // cannot be answered from this machine. Say so rather than showing an empty
    // list, which reads as "nobody has run today" and is a different claim.
    if (!Runs.signedIn()) {
      renderBoard([], "Sign in to see today's leaderboard");
      return;
    }

    renderBoard([], "Loading today's runs…");
    Runs.dailyLeaderboard(Rng.dailySeed(), 10).then((rows) => {
      renderBoard(rows, "No runs yet today — be the first!");
    });
  }

  function showPanel(name) {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
    // The cards are held to one height so this cannot move them, but what is
    // solid did change: a different card is on screen with different edges on
    // it. Collision is read off the page, so the page is measured again. The
    // two loaders below measure again after their rows land; this is for the
    // switch itself, and for the Play tab, which has nothing to load.
    queuePlayground();

    if (name === "runs") loadRuns();
    if (name === "board") loadBoard();
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

  // ---------------------------------------------------------- the painting
  //
  // Hung on the back wall either side of the gym. Loaded the way everything
  // else drawn from a file is: started here, awaited nowhere, and asked for a
  // repaint when it turns up, because the room is painted into a picture once
  // per rebuild and a canvas drawn before the image loaded would keep the empty
  // wall until something else happened to move.
  const picture = new Image();
  let pictureReady = false;

  // How much of the wall's height the picture is asked to take.
  const PICTURE_SHARE = 0.4;

  // Where the paint actually is inside the file.
  //
  // The frame occupies twenty by twenty-eight of a thirty-two square, and the
  // rest is transparent. Sized by the square it hangs a third smaller than
  // asked for with a band of nothing all round it, which reads as a small
  // picture badly hung rather than a large one. Measured, it reads as what it
  // is — and it stays right if the drawing is redone at another size.
  function paintBounds(img) {
    const scratch = document.createElement("canvas");
    scratch.width = img.width;
    scratch.height = img.height;
    const ctx = scratch.getContext("2d");
    ctx.drawImage(img, 0, 0);

    let data;
    try {
      data = ctx.getImageData(0, 0, img.width, img.height).data;
    } catch (err) {
      return null; // a file:// page will not hand its pixels back
    }

    let x0 = img.width;
    let y0 = img.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (data[(y * img.width + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  picture.addEventListener("load", () => {
    pictureReady = true;
    // Whole file if the pixels cannot be read: a little small, never wrong.
    picture.paint = paintBounds(picture) ||
      { x: 0, y: 0, w: picture.width, h: picture.height };
    queuePlayground();
  });
  // Missing or unreadable: bare wall, which is a wall and not a broken image.
  picture.addEventListener("error", () => {
    pictureReady = false;
  });
  // The name is deliberately dull. It hangs in a room nobody is told about, and
  // a file called mona.png sitting in an asset list is the whole thing given
  // away by anyone who thinks to look at what the page loads. Leave it looking
  // like furniture.
  //
  // It is also plain ASCII with no spaces in it, which is not decoration
  // either: the site is served by Cloudflare Workers, where an asset path and
  // the key it is stored under can disagree about how to encode a space or a
  // bracket, and the failure is a silent 404 that looks exactly like a drawing
  // bug. Redraws go here.
  picture.src = "assets/ui_drop_shadow_03.png";

  // ------------------------------------------------------------ the gym map
  //
  // The gym is a picture. Forty pixels by twenty-five in four flat colours —
  // black solid, green air, red lava, yellow the door — read here into one
  // character per pixel and handed to the carver. Redraw the file, reload the
  // page, and the room has changed: there is no step in between for the drawing
  // and the level to disagree at.
  //
  // Either name, first one that answers. The file on disk is gym.png.png —
  // a double extension, which is how it came out of the editor — but the
  // obvious thing to call a replacement is gym.png, and a room that silently
  // ignores the picture you just saved because of an extension is a bad
  // afternoon. So the plain name is tried first and the double one is the
  // fallback, and either works.
  const GYM_SRC = ["gym.png", "gym.png.png"];

  // Nearest of the four rather than an exact match. An editor that antialiases
  // an edge, or writes 254 where it meant 255, should cost a pixel's worth of
  // rounding and not the whole room.
  const GYM_INK = [
    { r: 0, g: 0, b: 0, mark: "#" },
    { r: 0, g: 255, b: 0, mark: "." },
    { r: 255, g: 0, b: 0, mark: "L" },
    { r: 255, g: 255, b: 0, mark: "D" },
  ];

  let gymMap = null;

  function nearestInk(r, g, b) {
    let best = GYM_INK[0];
    let closest = Infinity;
    for (const ink of GYM_INK) {
      const d = (r - ink.r) ** 2 + (g - ink.g) ** 2 + (b - ink.b) ** 2;
      if (d < closest) {
        closest = d;
        best = ink;
      }
    }
    return best.mark;
  }

  function loadGymMap(which) {
    const at = which || 0;
    if (at >= GYM_SRC.length) return; // no picture under either name
    const art = new Image();

    art.addEventListener("load", () => {
      const scratch = document.createElement("canvas");
      scratch.width = art.width;
      scratch.height = art.height;
      const ctx = scratch.getContext("2d");
      ctx.drawImage(art, 0, 0);

      let pixels;
      try {
        pixels = ctx.getImageData(0, 0, art.width, art.height).data;
      } catch (err) {
        // A page opened straight off the disk taints the canvas and the browser
        // refuses to read it back. Nothing to be done about that from here, and
        // the room baked into mainscreen.js is exactly this picture anyway.
        return;
      }

      const rows = [];
      for (let y = 0; y < art.height; y++) {
        let line = "";
        for (let x = 0; x < art.width; x++) {
          const at = (y * art.width + x) * 4;
          line += nearestInk(pixels[at], pixels[at + 1], pixels[at + 2]);
        }
        rows.push(line);
      }
      gymMap = rows;

      // Only matters if somebody is already standing in the room it describes.
      if (inGym) queuePlayground();
    });

    // Not under that name: try the next. When both are gone the baked copy
    // stands, and it is the same room.
    art.addEventListener("error", () => loadGymMap(at + 1));
    art.src = GYM_SRC[at];
  }

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

  // Keys that move the page, and must not. The stylesheet takes the scrollbars
  // away, which is most of the job; this is the rest of it, because a browser
  // with nothing to scroll still answers these by walking the focus ring down
  // the page and dragging the view with it.
  //
  // input.js already swallows the arrows and space — but only when the key
  // reaches the page. A button that has been tabbed to is a UI target, so
  // input.js hands the press back to the browser, and the runner's own jump and
  // camera keys scroll the menu out from under him. Caught here on the way
  // down, before anything focused gets a say.
  const SCROLLS_PAGE = [
    "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "PageUp", "PageDown", "Home", "End",
  ];

  document.addEventListener("keydown", (event) => {
    if (SCROLLS_PAGE.indexOf(event.code) < 0 || typing()) return;

    // Space on a focused button is that button being pressed, and a menu that
    // can only be worked with a mouse is a worse menu than one that scrolls.
    // Nothing else in this list activates anything, so nothing else is spared.
    const focused = document.activeElement;
    if (event.code === "Space" && focused && focused.tagName === "BUTTON") return;

    event.preventDefault();
  }, true);

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
  // The menu itself, which slides out of the window to make room for the gym.
  const stage = document.querySelector(".stage");
  // The version, the name and the career total in the top corner: the menu's
  // furniture, faded out while the runner is in a room the menu is not in.
  const corner = document.querySelector(".corner");
  const playCanvas = document.querySelector("[data-playground]");
  const playCtx = playCanvas.getContext("2d");
  const doorButton = document.querySelector("[data-door]");

  let playLevel = null;
  let playRunner = null;
  let playAcc = 0;
  let playDirty = true;
  let playEntering = false;
  let doorRect = null;
  // Which of the two rooms the runner is standing in. The menu is the ground
  // floor and the gym is the storey above it; everything that reads the page
  // has to know which, because upstairs there is no page to read.
  let inGym = false;

  // And whether we are between the two of them. The slide takes 1.1 seconds,
  // both rooms are on screen for all of it, and the runner is a passenger:
  // frozen, out of reach of the keyboard, and out of reach of gravity.
  const SLIDE_MS = 1100;
  let sliding = false;
  let slideShot = null; // a still of the room being left
  let shotIsGym = false;
  let slideTimer = 0;

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
  // Lifting stops at the lid. Every tile outside the grid reads as empty, so a
  // body lifted past the ceiling comes out the far side of it "free" — and then
  // falls back and stands on the roof of the world, off the top of the screen,
  // out of reach of everything. Better to give up the lift and take the spawn.
  function freeUp(level, runner) {
    const body = runner.body;
    const lid = Mainscreen.EDGE;
    let lifted = 0;
    while (inRock(level, body) && body.y - 1 >= lid && lifted < level.height) {
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

    // The layer is position:fixed inset:0, so it stops at the scrollbars — and
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

    // Two rooms, one rebuild. Downstairs the level is the page measured; up in
    // the gym there is no page to measure — the menu has slid out of the window
    // — so it is built from the window instead.
    playLevel = inGym
      ? Mainscreen.createGym(w, h, gymMap)
      : Mainscreen.fromPage(document, w, h, { sky: playSky });

    // The walls, repainted with them. This is the only place the level changes,
    // so it is the only place the picture of it can go stale.
    paintRoom(dpr);

    // Measured in the same pass as the collision, so the art lands exactly
    // where the tiles that finish the run are. Null upstairs: the menu is out
    // of the window, and its Play door is not something anyone can be standing
    // in front of.
    doorRect = inGym || !doorButton ? null : doorButton.getBoundingClientRect();

    if (!playRunner) {
      playRunner = Player.create(playLevel);
      return;
    }

    // Keep them where they were standing. Only the room around them changed.
    //
    // Inside the box on every side, not just three of them. A window that gets
    // shorter or narrower moves the walls in under a body that was standing
    // where they used to be, and a body left outside the grid is one the tiles
    // cannot get hold of: nothing outside is solid, so nothing outside stops it.
    const body = playRunner.body;
    const edge = Mainscreen.EDGE;
    body.x = Math.max(edge, Math.min(body.x, playLevel.width - body.w - edge));
    body.y = Math.max(edge, Math.min(body.y, playLevel.height - body.h - edge));
    freeUp(playLevel, playRunner);
    playRunner.safe.x = body.x;
    playRunner.safe.y = body.y;
  }

  function resetPlayground() {
    playRunner = null;
    // Back downstairs, and not halfway between. A run always ends on the menu,
    // so the menu has to be in the window when it does — and a slide left
    // running would keep a still of a room nobody is in on top of it.
    inGym = false;
    sliding = false;
    slideShot = null;
    window.clearTimeout(slideTimer);
    stage.classList.remove("is-slid-down");
    if (corner) corner.classList.remove("is-upstairs");
    // Coming back from a run rebuilds the menu from nothing, and an unlocked
    // tunnel is part of the menu now — so it is asked for again here rather
    // than cleared. Without this, finishing a run would take the tunnel away
    // from somebody who had already earned it.
    playSky = skyUnlocked();
    playDust.length = 0;
    playAcc = 0;
    playEntering = false;
    skyDoorArmed = true;
    gymDoorArmed = true;
    queuePlayground();
  }

  const IDLE = {
    left: false, right: false, jumpHeld: false, jumpPressed: false, slideHeld: false, mask: 0,
  };

  function stepPlayground(dt) {
    if (playDirty || !playLevel) rebuildPlayground();

    // Between storeys the runner is cargo. No input, no gravity, no doors: they
    // are standing exactly where the arrival put them and the camera is doing
    // the moving.
    //
    // The poll still happens and is thrown away, for the same reason the typing
    // guard polls — edges banked through a second of slide would all fire on
    // the frame it ends, and a jump saved up for a second is a jump nobody
    // asked for.
    if (sliding) {
      readInput();
      playAcc = 0;
      stepDust(dt);
      return;
    }

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
    // Not upstairs: the combo is about the tunnel, and the gym has no tunnel to
    // summon or be lifted into.
    if (!inGym && comboHeld() && nearOrigin(playRunner.body)) armSky();
    checkSkyDoor();
    checkGymDoor();

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

  // ---------------------------------------------------------------- the room
  //
  // The menu has always had walls. A solid column down each side and a lid
  // across the top are what stop a wall kick carrying the runner out of the
  // window, and until now every one of them was invisible — a wall you could
  // only find by walking into it, which is the one thing a wall must never be.
  // These are exactly those tiles, painted at last.
  //
  // Polished white marble, lit from the left. Five tones and each has a job:
  // the lit edge, the face the light lands on flat, the turn away from it, the
  // cut of a groove, and the one line dark enough to be an edge.
  //
  // That last one earns its place twice over. Everything else here is lighter
  // than the menu's paper, so on a pale page the outline is the only tone that
  // can say where marble stops and the room behind it starts — without it the
  // pillars dissolve into the background they are supposed to be framing.
  const MARBLE = {
    light: "#ffffff",
    face: "#f4f7f5",
    shade: "#dde5e1",
    groove: "#c5d1cc",
    outline: "#8a9992",
  };

  // Eight bands across the width of a shaft: the lit edge, the face, a cut
  // groove, face again, a second groove, face, the turn into shade, and the
  // dark side. Fluting is the whole difference between a column and a bar —
  // one of these has a round side and a shaded one, and the other is a
  // rectangle.
  const FLUTING = [
    MARBLE.light, MARBLE.face, MARBLE.groove, MARBLE.face,
    MARBLE.groove, MARBLE.face, MARBLE.shade, MARBLE.outline,
  ];

  // The right-hand pillar takes the same bands the other way round, so both are
  // lit from the middle of the room and shaded towards the walls. Running them
  // both the same way is the physically honest thing for a single light source
  // and it looks wrong here for a reason worth writing down: a pillar's outer
  // edge is the edge of the window, where there is nothing to stand out
  // against, and its inner edge is the only one the page can see. Unmirrored,
  // the dark band lands on the window edge at both ends and the right-hand
  // pillar has no edge at all — it fades into the paper it is meant to frame.
  const FLUTING_MIRROR = FLUTING.slice().reverse();

  // Whole pixels, and never less than one. A moulding worked out as a fraction
  // of a small tile rounds away to nothing, and a column with no capital is a
  // post.
  function band(ctx, x, y, w, h, ink) {
    ctx.fillStyle = ink;
    ctx.fillRect(x, y, w, Math.max(1, Math.round(h)));
  }

  // The eight bands, with their edges rounded to whole pixels and worked out
  // from the tile rather than from each other, so they always add up to exactly
  // one tile and the grooves stay hard lines instead of smearing over two.
  function flutedShaft(ctx, x, y, T, h, bands) {
    const ink = bands || FLUTING;
    for (let i = 0; i < ink.length; i++) {
      const x0 = Math.round((i * T) / ink.length);
      const x1 = Math.round(((i + 1) * T) / ink.length);
      if (x1 <= x0) continue;
      ctx.fillStyle = ink[i];
      ctx.fillRect(x + x0, y, x1 - x0, h);
    }
  }

  // One volute: the scroll at the corner of an Ionic capital, seen end on, so
  // it is a disc with a spiral wound into it. At a dozen pixels across there is
  // no room to wind anything — what reads at this size is a round edge, an eye
  // in the middle of it, and light on the upper left. The half pixel is what
  // keeps a one pixel stroke on one pixel instead of straddling two.
  function volute(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = MARBLE.face;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, r - 0.5, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = MARBLE.outline;
    ctx.stroke();

    // The lit quarter, over the top left of the roll.
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, r - 1.5, Math.PI, Math.PI * 1.5);
    ctx.strokeStyle = MARBLE.light;
    ctx.stroke();

    // The eye, and one turn of the spiral coming off it.
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r * 0.34), 0, Math.PI * 2);
    ctx.fillStyle = MARBLE.shade;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, Math.max(1.5, r * 0.62), Math.PI * 0.35, Math.PI * 1.85);
    ctx.strokeStyle = MARBLE.groove;
    ctx.stroke();
  }

  // The capital, Ionic: a flat abacus on top, a pair of volutes scrolled out to
  // the corners under it, and the neck where the flutes start. It is the one
  // part of a column nobody mistakes for anything else, which is why it is
  // worth the arcs — everything else in this room is rectangles.
  // How far the capital and the base project past the shaft. A column the same
  // width all the way up is a pipe: the flare is the whole of what makes the
  // top read as carrying something and the foot as standing on something.
  //
  // Paint, and nothing but paint. The shaft's tile is the wall the runner
  // actually collides with and it is untouched — the overhang leans out over
  // the air beside it, which is what an overhang is. Half of each one is off
  // the edge of the window, because that is where these columns stand; what is
  // left is a capital projecting into the room, which is what you would see of
  // a column at the edge of a photograph.
  // Deep enough that the scroll can sit past the shaft rather than on it. At a
  // sixth of a tile the volute was wider than the projection it stood on, so
  // the coil landed inboard with a bare lip of cushion sticking out past it —
  // a circle drawn inside a column with a shelf attached, which is what nobody
  // has ever built. Past a quarter of a tile the scroll's own centre clears the
  // shaft and it starts doing what a volute does: turning the corner.
  function flareOf(T) {
    return Math.max(4, Math.round(T * 0.28));
  }

  function pillarCapital(ctx, x, y, T, bands) {
    const flare = flareOf(T);
    const wide = T + flare * 2;
    const left = x - flare;
    const abacus = Math.max(3, Math.round(T * 0.17));
    const scroll = Math.max(7, Math.round(T * 0.46));
    const neck = Math.max(2, Math.round(T * 0.1));
    const shaftTop = y + abacus + scroll + neck;

    // Flutes first, from the neck down, so everything above overpaints them.
    if (shaftTop < y + T) flutedShaft(ctx, x, shaftTop, T, y + T - shaftTop, bands);

    // The cushion, flared out to give the scrolls corners to sit on. Without it
    // they are two beads stuck to a post rather than one carved block.
    band(ctx, left, y + abacus, wide, scroll, MARBLE.face);
    band(ctx, left, y + abacus + scroll - 1, wide, 1, MARBLE.groove);

    // Hard out on the corners: each scroll's outer curve lands exactly on the
    // edge of the cushion, so the coil is what ends the capital rather than
    // something sitting inboard of a bare ledge. With the flare deeper than the
    // scroll's radius that puts both centres outside the shaft entirely, which
    // is the whole difference between a volute and a circle drawn on a column.
    const r = scroll / 2;
    volute(ctx, left + r, y + abacus + r, r);
    volute(ctx, left + wide - r, y + abacus + r, r);

    // The abacus: the slab the cornice actually sits on, and the widest thing
    // on the column. Drawn after the scrolls so they tuck under it.
    band(ctx, left, y, wide, abacus, MARBLE.face);
    band(ctx, left, y, wide, 1, MARBLE.light);
    band(ctx, left, y + abacus - 1, wide, 1, MARBLE.outline);

    // And the neck, which comes back in to the shaft's own width — the step
    // back in is what makes the flare above it read as a flare.
    band(ctx, x, y + abacus + scroll, T, neck, MARBLE.face);
    band(ctx, x, y + abacus + scroll + neck - 1, T, 1, MARBLE.groove);
  }

  // And the base it stands on: flutes running down into a torus — the fat
  // convex roll every Roman column has at its foot — and a square plinth under
  // that. The roll is lit across its crown and turns to shade underneath, which
  // is the whole of what makes it read as round rather than as another band.
  function pillarBase(ctx, x, y, T, bands) {
    const flare = flareOf(T);
    const plinth = Math.max(3, Math.round(T * 0.3));
    const torus = Math.max(3, Math.round(T * 0.26));
    const top = y + T - plinth - torus;

    flutedShaft(ctx, x, y, T, top - y, bands);

    // The roll takes half the overhang and the plinth all of it, so the foot
    // steps out twice on the way down instead of once. One step is a bracket;
    // two is a column arriving at the floor.
    const half = Math.max(1, Math.round(flare / 2));
    const roll = T + half * 2;
    const rx = x - half;
    band(ctx, rx, top, roll, torus, MARBLE.face);
    band(ctx, rx, top, roll, 1, MARBLE.groove);
    band(ctx, rx, top + 1, roll, Math.max(1, Math.round(torus * 0.35)), MARBLE.light);
    band(ctx, rx, top + torus - Math.max(1, Math.round(torus * 0.3)), roll,
      Math.max(1, Math.round(torus * 0.3)), MARBLE.shade);

    // The plinth, matching the abacus above it and overhanging the floor it
    // stands on — which is why the pillars are drawn after the floor.
    const wide = T + flare * 2;
    const left = x - flare;
    band(ctx, left, y + T - plinth, wide, plinth, MARBLE.face);
    band(ctx, left, y + T - plinth, wide, 1, MARBLE.light);
    band(ctx, left, y + T - 1, wide, 1, MARBLE.outline);
  }

  // The lid, drawn only where the lid is actually there. Across an ordinary
  // menu that is every column; with the tunnel up it is every column except the
  // ones the tunnel opens through, where the ceiling is deliberately cut away.
  // Painting a cornice across that hole would draw a ceiling the runner passes
  // straight through.
  //
  // Run by run rather than column by column: a window is sixty-odd columns and
  // this is four rectangles either way.
  // ------------------------------------------------------- the side walls
  //
  // Where the window is wider than the room there is space beyond the pillars,
  // and the pillars cannot be moved out to cover it — they are the walls, and
  // painting one anywhere but where the collision is means walking into
  // something well before you reach it. So what goes out there is a back wall
  // instead: the colonnade stands in front of it, which is what a colonnade is
  // for, and there is somewhere to hang a picture.
  //
  // In shade rather than face, so it reads as being behind the room rather than
  // as more of the same floor stood on end.
  function drawSideWalls(ctx, T, cols, rows, bleedX) {
    const top = T;
    const bottom = (rows - 1) * T;
    const h = bottom - top;

    for (const x of [-bleedX, cols * T]) {
      ctx.fillStyle = MARBLE.shade;
      ctx.fillRect(x, top, bleedX, h);
      // A seam top and bottom, so the wall meets the cornice and the floor
      // rather than merging into them.
      ctx.fillStyle = MARBLE.groove;
      ctx.fillRect(x, top, bleedX, 1);
      ctx.fillRect(x, bottom - 1, bleedX, 1);
      // Only the right-hand wall gets one. Two of them read as decoration —
      // a matching pair either side of the room, which is what a border is.
      // One, off in the corner of a room nobody was told about, reads as
      // somebody's private joke, which is what it is.
      //
      // Hung against the pillar rather than centred across the wall: its inner
      // edge touches the column and whatever will not fit runs off the side of
      // the window. A picture in the middle of a strip of wall reads as
      // decoration on a leftover margin; one that starts where the colonnade
      // ends reads as being on the wall behind it.
      if (x > 0) hangPicture(ctx, x, top, bleedX, h);
    }
  }

  // Sized off the wall's height rather than its width, because height is the
  // dimension there is plenty of: the wall is as tall as the room and only as
  // wide as the window had to spare. Whole source pixels only — a pixel-art
  // painting on a fractional scale is a blurred one — so it lands a little over
  // or under the share it was aiming for.
  //
  // Wider than the wall, and meant to be: it starts at the pillar and runs off
  // the right of the window. A canvas past the frame reads as a big painting
  // seen from inside the room, which is the thing a small one centred on a
  // strip of wall never manages.
  //
  // Halfway down the wall, because that is where a picture hangs when there is
  // nothing else on the wall to line it up with.
  function hangPicture(ctx, x, y, w, h) {
    if (!pictureReady || !picture.paint) return;

    const cut = picture.paint;
    const px = Math.max(1, Math.round((h * PICTURE_SHARE) / cut.h));
    const dw = cut.w * px;
    const dh = cut.h * px;
    const left = Math.round(x);
    const top = Math.round(y + (h - dh) / 2);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(picture, cut.x, cut.y, cut.w, cut.h, left, top, dw, dh);
    ctx.restore();
  }

  // One stretch of it, from x for w pixels. `up` is how far above the ceiling's
  // own row the stone carries on — nothing in the menu, where the room is the
  // window, and the top margin in the gym, where it is not.
  function corniceBand(ctx, x, w, T, up) {
    band(ctx, x, -up, w, T + up, MARBLE.face);
    band(ctx, x, -up, w, 1, MARBLE.light);
    band(ctx, x, Math.round(T * 0.44), w, 1, MARBLE.groove);
    band(ctx, x, Math.round(T * 0.68), w, T - Math.round(T * 0.68) - 1, MARBLE.shade);
    // One pixel, and the only line in the room that says where the ceiling
    // stops and the air begins. In slate it was the lit edge; in marble it
    // has to be the dark one, because every other tone up here is brighter
    // than the page and a white line on pale paper draws nothing at all.
    band(ctx, x, T - 1, w, 1, MARBLE.outline);
  }

  function drawCornice(ctx, T, cols, bleedX, bleedY) {
    let start = -1;

    const close = (end) => {
      if (start < 0) return;
      corniceBand(ctx, start * T, (end - start + 1) * T, T, bleedY);
      start = -1;
    };

    for (let col = 0; col < cols; col++) {
      const lidded = Level.at(playLevel, col, 0) === Level.TILE.GROUND;
      if (lidded && start < 0) start = col;
      if (!lidded) close(col - 1);
    }
    close(cols - 1);

    // And out past the walls on both sides, where the room is narrower than
    // the window. The pillars stay where the walls are, because they are the
    // walls — what runs on behind them is the building carrying on, which is
    // what a colonnade looks like and what a room stopping short of the screen
    // does not.
    if (bleedX <= 0) return;
    corniceBand(ctx, -bleedX, bleedX, T, bleedY);
    corniceBand(ctx, cols * T, bleedX, T, bleedY);
  }

  // The gym's own masonry: everything inside the frame that the picture said
  // was solid, plus the lava it said was lava.
  //
  // Marble, like the room it stands in, with a lit edge wherever a block has
  // air above it — that edge is the whole of what says "you can land here", and
  // without it a course of white blocks on a white floor is a puzzle about
  // where the ledges are rather than about reaching them.
  function drawGymTiles(ctx, T, cols, rows) {
    const cap = Math.max(2, Math.round(T * 0.16));
    const lip = Math.max(2, Math.round(T * 0.22));

    for (let y = 1; y < rows; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const tile = Level.at(playLevel, x, y);
        if (tile === Level.TILE.EMPTY) continue;
        // The bottom row is the floor, and the floor is already drawn above
        // with a nicer edge than a plain block would get.
        if (y === rows - 1 && tile === Level.TILE.GROUND) continue;

        const px = x * T;
        const py = y * T;

        if (tile === Level.TILE.LAVA) {
          ctx.fillStyle = colours.lava;
          ctx.fillRect(px, py, T + 0.5, T + 0.5);
          // A brighter lip only where it meets air, so a pool reads as having a
          // surface rather than as a block of orange.
          if (Level.at(playLevel, x, y - 1) !== Level.TILE.LAVA) {
            ctx.fillStyle = colours.lavaTop;
            ctx.fillRect(px, py, T + 0.5, lip);
          }
          continue;
        }

        marbleBlock(ctx, px, py, T, Level.at(playLevel, x, y - 1) !== Level.TILE.GROUND);
      }
    }
  }

  // One block of it. Shaded underside and a seam down the right, so a run of
  // them reads as blocks rather than as one poured slab — and a lit cap on any
  // that has air above it, which is the whole of what says a thing can be
  // landed on.
  function marbleBlock(ctx, px, py, T, lit) {
    const under = Math.max(1, Math.round(T * 0.12));
    ctx.fillStyle = MARBLE.face;
    ctx.fillRect(px, py, T + 0.5, T + 0.5);
    ctx.fillStyle = MARBLE.shade;
    ctx.fillRect(px, py + T - under, T + 0.5, under);
    ctx.fillStyle = MARBLE.groove;
    ctx.fillRect(px + T - 1, py, 1, T + 0.5);
    if (!lit) return;
    ctx.fillStyle = MARBLE.light;
    ctx.fillRect(px, py, T + 0.5, Math.max(2, Math.round(T * 0.16)));
    ctx.fillStyle = MARBLE.outline;
    ctx.fillRect(px, py, T + 0.5, 1);
  }

  function drawRoom(ctx) {
    const T = playLevel.tile;
    const cols = playLevel.width;
    const rows = playLevel.height;

    // How far the window reaches past the room on each side. Nothing on the
    // menu, whose level is the window; on the gym it is whatever the centring
    // left over, and it is what the ceiling and the floor run out into.
    const bleedX = playLevel.originX || 0;
    const bleedY = playLevel.originY || 0;

    // The back wall first, behind everything, where the window is wider than
    // the room. Then the cornice and the floor run across it.
    if (bleedX > 0) drawSideWalls(ctx, T, cols, rows, bleedX);

    drawCornice(ctx, T, cols, bleedX, bleedY);

    // The floor, between the two pillars and along the bottom row. It is the
    // row the carver has always laid as solid ground and the row the runner
    // spawns standing on — so this draws no new surface, it draws the one that
    // was already underfoot and unpainted. Cards can never reach it: they are
    // cut off three rows higher so the corridor to the door stays open.
    // From one edge of the window to the other, and down past the bottom of the
    // room, so there is no pale strip anywhere along it. It used to start
    // inside the left pillar and stop inside the right one, which left a tile
    // of bare page in each bottom corner once the room stopped filling the
    // window. The pillars are drawn after this and cover their own feet.
    const floorY = (rows - 1) * T;
    const from = -bleedX;
    const inner = cols * T + bleedX * 2;
    const deep = T + bleedY;
    band(ctx, from, floorY, inner, deep, MARBLE.face);
    // The polished top surface, and directly under it the line that separates
    // it from the air. White alone is the right colour for a lit floor and the
    // wrong one for an edge on a pale page, so it gets both.
    band(ctx, from, floorY, inner, 1, MARBLE.light);
    band(ctx, from, floorY + 1, inner, 1, MARBLE.groove);
    band(ctx, from, floorY + Math.round(T * 0.55), inner, deep - Math.round(T * 0.55), MARBLE.shade);

    // And upstairs, everything the room is made of on the inside.
    //
    // Downstairs the tiles are cards and the browser draws them, so the canvas
    // only ever had to paint the shell around them. The gym's tiles are its
    // own — they came out of a picture and nothing else was drawing them — so
    // the whole obstacle course was solid, collidable and invisible.
    if (playLevel.gym) drawGymTiles(ctx, T, cols, rows);

    // The upper tunnel, and the gym's way back down. Both are as fixed as
    // the walls are, so they belong in the picture the room is painted into
    // rather than in the frame loop — the tunnel alone is eighty-odd blocks,
    // and eighty blocks of marble is four hundred rectangles a frame to say a
    // thing that has not changed since the last rebuild.
    drawSky(ctx);
    if (playLevel.gym && playLevel.door) drawSkyDoor(ctx, playLevel.door, T);

    // Both walls run the full height of the level and always have: the carver
    // fills them for every row, and the tunnel's own clearing refuses to cut
    // anything outside the edge columns. So a pillar needs no checking — it is
    // a capital under the cornice, a base on the floor, and shaft between.
    // Drawn after the floor so the bases sit on top of it rather than in it.
    for (const col of [0, cols - 1]) {
      const x = col * T;
      const bands = col === 0 ? FLUTING : FLUTING_MIRROR;
      pillarCapital(ctx, x, T, T, bands);
      for (let row = 2; row < rows - 1; row++) flutedShaft(ctx, x, row * T, T, T, bands);
      pillarBase(ctx, x, (rows - 1) * T, T, bands);
    }
  }

  // Painted once per rebuild rather than once per frame. A full height pillar
  // is eight bands a row and there are two of them, which comes to something
  // like four hundred and sixty rectangles — cheap enough one at a time and
  // silly sixty times a second for a picture that only changes when the window
  // does. Kept at device resolution and drawn back at CSS size, so the grooves
  // stay one hard pixel on a retina screen instead of a soft two.
  let roomArt = null;

  function paintRoom(dpr) {
    // The picture is the whole window rather than just the room, so the cornice
    // and the floor have somewhere to run to past the room's own walls. The
    // room is drawn into it wherever the centring put it, and the offset is
    // handed back so it can be taken off again at drawing time.
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const offX = playLevel.originX || 0;
    const offY = playLevel.originY || 0;

    roomArt = document.createElement("canvas");
    roomArt.width = Math.round(w * dpr);
    roomArt.height = Math.round(h * dpr);
    const ctx = roomArt.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(offX, offY);
    drawRoom(ctx);
    roomArt.cssW = w;
    roomArt.cssH = h;
    roomArt.offX = -offX;
    roomArt.offY = -offY;
  }

  // Everything in the room except whoever is standing in it. Split out because
  // it has to be drawn twice: once live, and once into a still picture of the
  // room being left behind while the two of them slide past each other.
  function drawScene(ctx) {
    // The room first, behind everything: the door stands in it, and the runner
    // stands in front of it.
    if (roomArt) ctx.drawImage(roomArt, roomArt.offX, roomArt.offY, roomArt.cssW, roomArt.cssH);
    // The room, its tunnel and both doorways are all in that one picture now.
    // What is left is the menu's own Play door, which is measured off the page
    // rather than the level, and the dust, which is the only thing up here that
    // moves.
    drawDoor(ctx);
    drawDust(ctx);
  }

  function drawRunnerHere(ctx) {
    const body = playRunner.body;
    const T = playLevel.tile;
    const scale = (T * Player.TUNING.height) / SHEET.activeH;
    const flashing = playRunner.recovering > 0 && Math.floor(playRunner.recovering * 20) % 2 === 0;
    const alpha = playRunner.finished ? playRunner.entering : flashing ? 0.45 : 1;
    const centreX = (body.x + body.w / 2) * T;
    const feetY = (body.y + body.h) * T;

    if (drawFrame(ctx, poseOf(playRunner), centreX, feetY, scale, playRunner.facing < 0, alpha)) return;

    // No sheet loaded: a shape rather than nothing, in the menu's own ink so it
    // reads as part of the page instead of as a broken image.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colours.ink;
    ctx.fillRect(centreX - (body.w * T) / 2, feetY - body.h * T, body.w * T, body.h * T);
    ctx.globalAlpha = 1;
  }

  // How far down the window the menu currently sits, asked of the browser
  // rather than worked out again here.
  //
  // The menu slides on a CSS transition and the canvas has to travel with it to
  // the pixel — the marble pillars are painted here and the cards they frame are
  // laid out there, and a curve reimplemented in JavaScript would agree with the
  // browser's for about two frames. So the number comes from the element: this
  // is exactly where the browser has put it this frame, whatever easing it is
  // using and however it is scheduling the work.
  function stageShift() {
    const raw = stage ? getComputedStyle(stage).transform : "none";
    if (!raw || raw === "none") return 0;
    try {
      return new DOMMatrix(raw).m42;
    } catch (err) {
      return inGym ? document.documentElement.clientHeight : 0;
    }
  }

  // Everything below draws in level space, with the top-left tile at the
  // origin. The menu is the window, so its origin is the window's; the gym is a
  // fixed forty by twenty-five room that the window is only a frame around, so
  // its origin is wherever centring put it.
  function room(ctx, extraY, withRunner) {
    ctx.save();
    ctx.translate(playLevel.originX || 0, (playLevel.originY || 0) + extraY);
    drawScene(ctx);
    if (withRunner) drawRunnerHere(ctx);
    ctx.restore();
  }

  function renderPlayground() {
    const viewW = document.documentElement.clientWidth;
    const viewH = document.documentElement.clientHeight;
    playCtx.clearRect(0, 0, viewW, viewH);

    if (!sliding) {
      room(playCtx, 0, true);
      return;
    }

    // Mid-slide, and both storeys are on screen. The menu is wherever the
    // browser has it; the gym is one window above that, because it is the room
    // upstairs and this is the camera panning between them rather than one
    // picture being swapped for another.
    const shift = stageShift();
    const menuY = shift;
    const gymY = shift - viewH;

    // Neither room has anybody in it while they are moving. The two storeys
    // can be at different scales — the gym takes the whole window and the menu
    // is drawn at whatever tile the page needs — so a runner shown in both, or
    // carried from one into the other, reads as the character changing size
    // halfway down the screen. Nobody is drawn until the room has stopped.
    //
    // The still is a picture of the whole window, so it moves as the window
    // moves — the centring is already baked into it.
    if (slideShot) {
      playCtx.drawImage(slideShot, 0, shotIsGym ? gymY : menuY, viewW, viewH);
    }

    room(playCtx, inGym ? gymY : menuY, false);
  }

  // -------------------------------------------------------- menu key state
  //
  // The menu keeps its own idea of what is held down, separately from input.js.
  // input.js knows the four bits the simulation runs on and nothing else, on
  // purpose: a recording of a run is a list of those four bits over time, and
  // anything else read through the same door would end up written into replays
  // that have no use for it.
  //
  // Three letters, a byte apiece, assembled rather than written out. Spelled in
  // full this line answers a question nobody has asked yet, and the answer is
  // worth more unspoken.
  const GESTURE = "6b6372";
  const COMBO = (GESTURE.match(/../g) || []).map(
    (byte) => "Key" + String.fromCharCode(parseInt(byte, 16)).toUpperCase()
  );

  const STORE_KEY = "platformer.view_prefs";

  // Whether this machine has been here before. Asked rather than remembered in
  // a variable, because the two places that want to know are the page opening
  // and the menu being rebuilt after a run, and those are far enough apart that
  // a stale copy between them is a bug waiting to happen.
  function skyUnlocked() {
    try {
      return localStorage.getItem(STORE_KEY) === "1";
    } catch (err) {
      return false; // storage blocked: it goes back to being earned each time
    }
  }

  // Every key the menu currently has held down. Its own set, kept apart from
  // input.js, which only knows the four bits the simulation runs on — a
  // recording of a run has no business carrying a cheat code in it.
  const menuHeldKeys = new Set();

  let playSky = false;
  // Set when a window turns out to have no room for the tunnel, and cleared
  // when the keys come up. Without it the combo would build and unbuild the
  // level twice a frame for as long as it is held.
  let skyRefused = false;

  // A key is remembered twice: by where it sits on the board, and by the letter
  // it actually typed.
  //
  // event.code is the physical position, which never changes and is wrong for
  // anyone not on QWERTY — a Dvorak keyboard puts a letter where QWERTY keeps
  // an entirely different one, so matching on code alone asks those players to
  // press keys they cannot see. event.key is the letter that came out, which is
  // right for them and goes wrong the moment a modifier rewrites it. Holding
  // both means the same letters work on every layout, and neither reading has
  // to be the correct one on its own.
  function keyTokens(event) {
    const tokens = [event.code];
    const typed = String(event.key || "").toLowerCase();
    if (typed.length === 1 && typed >= "a" && typed <= "z") {
      tokens.push("Key" + typed.toUpperCase());
    }
    return tokens;
  }

  function comboHeld() {
    return COMBO.every((code) => menuHeldKeys.has(code));
  }

  // Measured in tiles — which is what it always meant, and used to be written
  // in pixels only because a tile was a fixed twenty of them. A tile is the
  // window's now, so the same figure in pixels would mean somewhere different
  // on every monitor.
  //
  // Six by six, and not much else. Fourteen by sixteen was half the screen — a
  // zone that large stops being somewhere you have to get to and becomes most
  // of the room, which costs the whole thing the only quality it had.
  //
  // Six down rather than two or three, though, and that is the ceiling's doing.
  // There is a lid on row zero, so a climb up the wall does not hang at the top
  // waiting to be noticed: the runner's head meets rock at y of one, stops
  // dead, and falls. A window of two or three rows would have to be caught on
  // the frame of the bonk. Five rows of fall is time enough to have the keys
  // already down, which keeps the difficulty in the climb rather than in a
  // reflex at the end of it.
  function nearOrigin(body) {
    return body.x < 6 && body.y < 6;
  }

  // On the window rather than the document, so a press is seen wherever it
  // lands. Every key is remembered, not only the three: a set that holds one
  // key while ignoring the rest cannot answer "are these three down together",
  // which is the only question ever asked of it.
  window.addEventListener("keydown", (event) => {
    if (typing()) return;
    keyTokens(event).forEach((token) => menuHeldKeys.add(token));
  });

  // Never guarded by typing(). A key pressed on the menu and released after the
  // seed field takes focus is a key this set would otherwise believe is still
  // down for the rest of the session.
  window.addEventListener("keyup", (event) => {
    keyTokens(event).forEach((token) => menuHeldKeys.delete(token));
    skyRefused = false;
  });

  // Alt-tabbing away with two of the three down otherwise leaves them down.
  window.addEventListener("blur", () => menuHeldKeys.clear());

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
    const T = playLevel.tile;
    playDust.forEach((mote) => {
      const left = 1 - mote.age / mote.life;
      ctx.globalAlpha = left * 0.7;
      ctx.fillStyle = mote.gold ? colours.goldLight : colours.inkMuted;
      // A fifth of a tile, which is the four pixels this used to be back when a
      // tile was twenty of them. Written against the tile so the dust grows
      // with the runner it comes off rather than staying a speck beside them.
      const size = Math.max(1, Math.round(left * T * 0.2));
      ctx.fillRect(Math.round(mote.x * T), Math.round(mote.y * T), size, size);
    });
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------- arming the sky

  // Holding the combo up in the corner puts the runner in the tunnel, whether
  // or not the tunnel is already there. It used to build it once and never
  // speak again, which was fine while dropping out of it took it down with you
  // — now that it stays up, a one-shot would leave the only way back a climb
  // the player might not have found yet. So it is a lift as well as a summons.
  //
  // It cannot repeat: the entry is past the sixth column and the zone stops at
  // it, so the runner is out of the zone the instant they arrive.
  function armSky() {
    if (skyRefused) return;
    if (!playSky) skyDoorArmed = true; // a new tunnel has its door to be reached
    playSky = true;
    rebuildPlayground();

    // No room for the tunnel on this window: put it back the way it was
    // rather than build half of it.
    if (!playLevel.sky) {
      playSky = false;
      skyRefused = true;
      rebuildPlayground();
      return;
    }

    // Found once, found for good. It is worth the finding the first time and
    // is only a chore on the second, so from here on the tunnel is simply part
    // of the menu — and the combo goes on working as the way up to it.
    try {
      localStorage.setItem(STORE_KEY, "1");
    } catch (err) {
      // Private window: they will have to find it again next time, which is no
      // worse than it was before it was remembered at all.
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

  // There is no way home any more, and that is deliberate. Dropping through the
  // gap used to take the tunnel down with the runner; now the tunnel stays put
  // and they land on the menu underneath it, which is what a second storey
  // ought to do. Nothing tears the sky back down once it is up.
  //
  // The two doors, and the latch that keeps them from arguing.
  //
  // A door fires on the edge of being touched, not for as long as it is being
  // touched: it disarms as it triggers and arms again once the runner is
  // clear of it. Without that, arriving is indistinguishable from knocking.
  // These two doors are the same place on the screen a storey apart, so coming
  // up through one lands you at the foot of the other — and a door that reads
  // an arrival as a fresh touch sends you straight back where you came from,
  // which the two rooms will happily do to each other all afternoon.
  //
  // Arriving disarms the destination outright, on top of standing the runner
  // clear of the frame. Either alone would do it; both means the placement can
  // move later without the loop quietly coming back.
  let skyDoorArmed = true;
  let gymDoorArmed = true;

  function inBox(body, box) {
    return body.x < box.x + box.w && body.x + body.w > box.x &&
      body.y < box.y + box.h && body.y + body.h > box.y;
  }

  function checkSkyDoor() {
    const box = playSky && playLevel.sky && playLevel.sky.door;
    if (!box) return;

    const body = playRunner.body;
    if (!inBox(body, box)) {
      // Stepping out of the doorway arms it again, so a second visit is worth
      // as much as the first.
      skyDoorArmed = true;
      return;
    }
    if (!skyDoorArmed) return;

    skyDoorArmed = false;
    puffSky(body.x + body.w / 2, body.y + body.h / 2, 26, 4, true);
    enterGym();
  }

  // ------------------------------------------------------------- the storeys
  //
  // Going up. The menu slides out of the bottom of the window and the gym is
  // built in the space it leaves — one building with a floor between two rooms,
  // rather than one screen being swapped for another.
  //
  // Placed the way arming the sky places: feet on the floor, standing rather
  // than sliding, and the velocity zeroed, because whatever the runner was
  // doing in the other room is not something they are still doing in this one.
  // The first solid row at or below a starting point.
  //
  // An arrival used to be put down at the bottom edge of the doorway it came
  // through, which was the floor for as long as every door happened to be drawn
  // sitting on one. The gym is a picture somebody edits, so that stopped being
  // true the first time a door moved up a row — and the runner arrived hanging
  // a tile in the air and fell. Asking the tiles costs nothing and cannot go
  // out of date.
  function groundUnder(level, tx, fromY) {
    for (let y = fromY; y < level.height; y++) {
      if (Level.at(level, tx, y) === Level.TILE.GROUND) return y;
    }
    return level.height - 1;
  }

  function stand(level, at) {
    const body = playRunner.body;
    body.h = Player.TUNING.height;
    playRunner.sliding = false;
    playRunner.skimming = false;
    playRunner.slideDropY = null;
    body.x = at.x;
    body.y = at.y;
    body.vx = 0;
    body.vy = 0;
    playRunner.safe.x = body.x;
    playRunner.safe.y = body.y;
    puffSky(body.x + body.w / 2, body.y + body.h, 22, 3.2, true);
  }

  // A still of the room as it stands, taken before the level under it changes.
  // Kept at device resolution and drawn back at window size, so a slide is not
  // a soft copy of the room sliding past a sharp one.
  function takeSnapshot() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    slideShot = document.createElement("canvas");
    slideShot.width = Math.round(w * dpr);
    slideShot.height = Math.round(h * dpr);
    const ctx = slideShot.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(playLevel.originX || 0, playLevel.originY || 0);
    drawScene(ctx);
    shotIsGym = inGym;
  }

  function beginSlide() {
    sliding = true;
    window.clearTimeout(slideTimer);
    // transitionend is the signal. This is the backstop for when it never
    // comes: an interrupted transition, a tab hidden for the whole of it, or
    // reduced motion cutting the duration to nothing at all.
    slideTimer = window.setTimeout(endSlide, SLIDE_MS + 200);
  }

  function endSlide() {
    window.clearTimeout(slideTimer);
    sliding = false;
    slideShot = null;
    // The menu has stopped moving, so now it can be measured.
    queuePlayground();
  }

  function enterGym() {
    if (inGym || sliding) return;
    takeSnapshot(); // the menu, as the runner last saw it
    inGym = true;
    stage.classList.add("is-slid-down");
    if (corner) corner.classList.add("is-upstairs");
    rebuildPlayground();

    // Beside the gym's own door, which is the same two columns as the tunnel's
    // and one storey down — so going up through one puts the runner at the foot
    // of the other, in the same place on the screen. A tile and a half clear of
    // the frame rather than standing in it, and facing left, into the room,
    // because the room is the point and all of it is that way.
    const body = playRunner.body;
    const door = playLevel.door;
    stand(playLevel, {
      x: door.x - 1.5,
      y: groundUnder(playLevel, Math.floor(door.x - 1.5), door.y + door.h) - body.h,
    });
    playRunner.facing = -1;
    gymDoorArmed = false;
    beginSlide();
  }

  function leaveGym() {
    if (!inGym || sliding) return;
    takeSnapshot(); // the gym, as the runner last saw it
    inGym = false;
    stage.classList.remove("is-slid-down");
    if (corner) corner.classList.remove("is-upstairs");
    rebuildPlayground();

    // Back out onto the deck, a tile and a half clear of the door they came
    // through, facing away down the tunnel. The fallback is the menu floor: a
    // window with no room for the tunnel has nowhere up there to put anybody.
    const body = playRunner.body;
    const door = playLevel.sky && playLevel.sky.door;
    stand(playLevel, door
      ? { x: door.x - 1.5,
          y: groundUnder(playLevel, Math.floor(door.x - 1.5), door.y + door.h) - body.h }
      : { x: playLevel.spawn.x + (1 - body.w) / 2, y: playLevel.spawn.y + 1 - body.h });
    playRunner.facing = -1;
    skyDoorArmed = false;
    beginSlide();
  }

  // The gym's own door, in the bottom corner furthest from where you land.
  function checkGymDoor() {
    if (!inGym || !playLevel.door) return;

    const box = playLevel.door;
    const body = playRunner.body;
    if (!inBox(body, box)) {
      gymDoorArmed = true;
      return;
    }
    if (!gymDoorArmed) return;

    gymDoorArmed = false;
    puffSky(body.x + body.w / 2, body.y + body.h / 2, 26, 4, true);
    leaveGym();
  }

  // ------------------------------------------------------------ drawing it
  //
  // Every tile the carver laid, and nothing else: what is drawn and what is
  // solid come from the same list, so the tunnel cannot grow a step that is
  // only paint.

  // The door at the far end of the tunnel: an arch of gold with light coming
  // out from under it, standing on the deck with its back to the right-hand
  // pillar. Drawn the way the cave's own door is drawn — a round-topped frame
  // with a lighter opening inside it — because it is meant to be recognised as
  // the same kind of thing, which is to say a way through.
  //
  // Visible from the moment the tunnel is walked into. A target at the far end
  // is the only thing making a corridor a corridor rather than a shelf.
  function drawSkyDoor(ctx, box, T) {
    const w = box.w * T;
    const h = box.h * T;
    const x = box.x * T;
    const y = box.y * T;

    // The glow first, and under everything. Written out in parts because a
    // gradient needs the colour broken up and a token arrives as one string —
    // this is --gold-light, and it has to be kept in step with it by hand.
    const cx = x + w / 2;
    const cy = y + h * 0.6;
    const reach = w * 1.8;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    glow.addColorStop(0, "rgba(240, 217, 122, 0.45)");
    glow.addColorStop(1, "rgba(240, 217, 122, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);

    // The frame. Narrower than its two tiles and standing on the deck, so it
    // reads as something in the doorway rather than as the doorway being the
    // whole end of the tunnel.
    const fw = w * 0.72;
    const fh = h * 0.94;
    const fx = x + (w - fw) / 2;
    const fy = y + h - fh;
    const r = fw / 2;

    ctx.beginPath();
    ctx.moveTo(fx, fy + fh);
    ctx.lineTo(fx, fy + r);
    ctx.arc(fx + r, fy + r, r, Math.PI, 0);
    ctx.lineTo(fx + fw, fy + fh);
    ctx.closePath();
    ctx.fillStyle = colours.gold;
    ctx.fill();

    // And the opening: the same arch inset, in the lighter gold, so the door
    // reads as a way through rather than a slab leaning on the wall.
    const iw = fw * 0.58;
    const ir = iw / 2;
    const ix = fx + (fw - iw) / 2;
    const iy = fy + Math.max(2, T * 0.16);

    ctx.beginPath();
    ctx.moveTo(ix, fy + fh);
    ctx.lineTo(ix, iy + ir);
    ctx.arc(ix + ir, iy + ir, ir, Math.PI, 0);
    ctx.lineTo(ix + iw, fy + fh);
    ctx.closePath();
    ctx.fillStyle = colours.goldLight;
    ctx.fill();
  }

  function drawSky(ctx) {
    if (!playSky || !playLevel.sky) return;
    const T = playLevel.tile;

    // Marble, like everything else in this room. It was dark stone while the
    // menu was dark stone; the walls went white and the tunnel above it
    // stayed behind, reading as a slab of somewhere else laid over the top of
    // the building rather than as another floor of it.
    playLevel.sky.tiles.forEach((tile) => {
      marbleBlock(ctx, tile.x * T, tile.y * T, T,
        Level.at(playLevel, tile.x, tile.y - 1) !== Level.TILE.GROUND);
    });

    // Stone, and then the one gold thing up here. The sconce that used to burn
    // over the gap is gone with the exit it marked: it was a sign pointing at a
    // way out, and there is no way out to point at.
    if (playLevel.sky.door) drawSkyDoor(ctx, playLevel.sky.door, T);
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

  // And the same for the slide between storeys. getBoundingClientRect answers
  // honestly all the way down, so a rebuild taken while the menu is still
  // moving measures it somewhere it is not going to stay. The one that counts
  // is the one after the transform has stopped.
  stage.addEventListener("transitionend", (event) => {
    if (event.propertyName === "transform") endSlide();
  });

  document.addEventListener("click", (event) => {
    queuePlayground();
    const control = event.target && event.target.closest && event.target.closest("button");
    if (control && event.detail > 0) control.blur();
  });

  // The layout also moves when nobody touches it. Recent runs paints twice —
  // once from this machine, which is instant, and again when the cloud answers,
  // which is whenever it answers — and that second paint changes the card's
  // height with no click, no key and no resize behind it to ask for a rebuild.
  //
  // That was survivable while the menu stacked from the top, because only the
  // card itself moved. Centred, a card that grows pushes everything above it up
  // by half of what it gained: the tabs, the title, and the door. A collision
  // map from before that is a picture of where the menu used to be, and the
  // door is the one thing on the screen that has to be where it looks.
  //
  // So the boxes are watched rather than guessed at. Anything that changes size
  // asks for the same rebuild a click does, and asking is free — it sets a flag
  // the next frame reads.
  if (window.ResizeObserver) {
    const watcher = new ResizeObserver(queuePlayground);
    document.querySelectorAll(".stage, .screen, [data-solid], [data-door]")
      .forEach((box) => watcher.observe(box));
  }

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
      // Crumbling stone. Grit while it is going, and a puff where it comes
      // back — both watched off the simulation rather than driven by it, so a
      // dropped frame costs dust and never a block.
      for (const c of session.crumbles) {
        if (c.state === "shaking" && Math.random() < 0.3) {
          mote(c.x + Math.random(), c.y + 1, (Math.random() - 0.5) * 0.6, 0.6, FRAME.dust, 0.3);
        }
        if (c.puffed === c.reforms) continue;
        // Nothing on the first pass: they start at zero, and a block that has
        // never gone anywhere has not come back.
        if (c.puffed !== undefined) puff(c.x + 0.5, c.y + 1, 4, 2.5);
        c.puffed = c.reforms;
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
    // Anyone who has found the tunnel once opens the page with it already
    // built. Set before the loop starts, because the first frame is the one
    // that measures the page and carves the level from it.
    playSky = skyUnlocked();

    // Started now and awaited nowhere. The gym is several doors away from
    // anything a player can reach in the first second, and the room baked into
    // mainscreen.js stands in until the picture arrives.
    loadGymMap();

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

  // Kept on the device, so a cave does not need a connection to be carved. The
  // worker only ever answers for files this origin serves — every Supabase call
  // still goes out and, offline, still fails the way the code already expects.
  //
  // Deferred to load, because registering competes with the very files it is
  // registering to cache, and the first visit is the one that has to fetch all
  // of them anyway.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // Opened from a file:// path, served without HTTPS, or refused by the
        // browser's settings. The game plays exactly as it did before — online,
        // and from the network every time.
      });
    });
  }

  // The menu waits for the gate. Booting behind the login card would roll a seed
  // and start the loop for someone who is not signed in yet.
  const gate = document.querySelector(".app");
  if (!gate || !gate.hidden) boot();
  else window.addEventListener("platformer:unlocked", boot, { once: true });
})();
