// game.js — entry point: canvas setup, game loop, state machine

const Game = (() => {
  // A fixed simulation step is what makes a run reproducible from its seed and
  // its inputs alone — variable-rate physics would give every machine a slightly
  // different run and make replays and ghosts impossible.
  const STEP = 1 / 60;
  const MAX_CATCHUP = 5;

  // A tape read back. The recording is run-length encoded — a mask and how many
  // steps it was held — and this unpacks it into one input per step, the same
  // shape the live poll produces.
  //
  // The press edge has to be rebuilt rather than stored: a tape remembers what
  // was held, and "pressed" means held now and not the step before. Getting
  // that wrong makes a replayed jump fire every frame the button was down,
  // which is a ghost that flies.
  function decodeTape(tapeString) {
    const runs = [];
    for (const chunk of String(tapeString || "").split(".")) {
      const parts = chunk.split("x");
      if (parts.length !== 2) continue;
      const mask = parseInt(parts[0], 16);
      const count = parseInt(parts[1], 10);
      if (Number.isFinite(mask) && Number.isFinite(count) && count > 0) runs.push([mask, count]);
    }

    let at = 0;
    let left = runs.length ? runs[0][1] : 0;
    let previous = 0;

    return function step() {
      const mask = at < runs.length ? runs[at][0] : 0;
      if (at < runs.length) {
        left--;
        if (left <= 0) {
          at++;
          left = at < runs.length ? runs[at][1] : 0;
        }
      }

      const pressed = mask & ~previous;
      previous = mask;
      return {
        left: (mask & Input.SIM.LEFT) !== 0,
        right: (mask & Input.SIM.RIGHT) !== 0,
        jumpHeld: (mask & Input.SIM.JUMP) !== 0,
        jumpPressed: (pressed & Input.SIM.JUMP) !== 0,
        slideHeld: (mask & Input.SIM.DOWN) !== 0,
        mask,
      };
    };
  }

  // How long a block shakes before it goes, and how long it is away.
  //
  // The shake is a warning and has to be long enough to read and short enough
  // that standing still is not a plan: four tenths is about a stride. The two
  // and a half is longer than it takes to fall past where it was, so a block
  // you broke is a block that is genuinely not there on the way back — and
  // shorter than it takes to walk round, so nothing is ever permanently gone.
  const CRUMBLE = { shake: 0.4, gone: 2.5 };

  function crumbles(level) {
    return (level.crumbles || []).map((c) => ({
      x: c.x,
      y: c.y,
      state: "idle",
      timer: 0,
      // Counted up when the block comes back, and watched by the renderer. The
      // simulation never reads it, so a run with the window closed plays out
      // exactly the same.
      reforms: 0,
    }));
  }

  // One fixed step of them. Called from inside the simulation loop for the same
  // reason the stalactites are: a seed and a tape have to reproduce exactly
  // which blocks went and when.
  function stepCrumbles(session, dt) {
    const list = session.crumbles;
    if (!list.length) return;

    const level = session.level;
    const body = session.player.body;
    const feet = body.y + body.h;

    for (const c of list) {
      const key = c.y * level.width + c.x;

      if (c.state === "idle") {
        // Stood on: the feet are resting on this tile's own top surface and the
        // body is over its column. Landing is what starts it, not passing
        // through the space above it or brushing its side.
        const on = body.onGround &&
          Math.abs(feet - c.y) < 0.05 &&
          body.x < c.x + 1 &&
          body.x + body.w > c.x;
        if (on) {
          c.state = "shaking";
          c.timer = CRUMBLE.shake;
        }
        continue;
      }

      c.timer -= dt;
      if (c.timer > 0) continue;

      if (c.state === "shaking") {
        c.state = "broken";
        c.timer = CRUMBLE.gone;
        level.broken.add(key);
        level.shaking.delete(key);
      } else {
        c.state = "idle";
        c.timer = 0;
        level.broken.delete(key);
        c.reforms++;
      }
    }

    // The shaking set is rebuilt rather than maintained, because it is only
    // ever read by the renderer and a set that is written in two places is a
    // set that ends up wrong in one of them.
    level.shaking.clear();
    for (const c of list) {
      if (c.state === "shaking") level.shaking.add(c.y * level.width + c.x);
    }
  }

  function create(level, options = {}) {
    // Which blocks are missing, and which are on their way out. Hung on the
    // level because that is what the physics and the renderer are handed, and
    // emptied here because they belong to the run rather than to the map — two
    // runs on one seed start with everything standing.
    level.broken = new Set();
    level.shaking = new Set();

    const session = {
      level,
      player: Player.create(level),
      // Hazards that move are part of the run, not part of the scenery, so they
      // live in the session and tick with it.
      stalactites: Enemy.create(level.stalactites),
      crumbles: crumbles(level),
      // Every button press, at a fixed 60 Hz. A seed plus this tape reproduces
      // the run exactly, which is what lets a claimed time be checked rather
      // than taken on trust.
      tape: [],
      accumulator: 0,
      steps: 0,
      // Teaching. A handcrafted level carries a list of points it wants to say
      // something at; everything else carries none and never pauses.
      taught: 0,
      lesson: null,
      // The ghost, when there is one to race: a second runner on the same
      // level, driven by a recording instead of a keyboard. It shares nothing
      // with the live one — its own body, its own clock — so it cannot be
      // bumped into, cannot set off a stalactite, and cannot be blamed.
      ghost: null,
      ghostInput: null,
    };

    // Inside a level, and only inside one. The menu builds its own runner and
    // never comes through here, which is what keeps him from sitting down and
    // staring out of a menu somebody left open in a background tab.
    //
    // The live runner and not the ghost. The ghost is a pacing line drawn at a
    // third alpha — faithful to the tape, so if you stood still it stands still
    // — but a second figure turning to look at you while you are racing reads
    // as a bug or a stranger rather than as a replay of yourself.
    session.player.glumps = true;

    if (options.ghostTape) {
      session.ghost = Player.create(level);
      session.ghostInput = decodeTape(options.ghostTape);
      // The ghost runs in a world where nothing has been broken. Same tiles,
      // same everything, one field different — a level object standing on the
      // real one with no set of missing blocks in it.
      //
      // Without that, breaking a block underfoot would take it out from under a
      // recording made when it was there, and the ghost would drop through the
      // floor of its own run and into whatever is below. A ghost is a picture
      // of a run that already happened; the present has no business editing it.
      session.ghostLevel = Object.assign(Object.create(level), { broken: null });
    }

    return session;
  }

  // Reading is not playing, so the clock is not running while you read. The
  // timer only advances inside Player.update, and a paused session does not
  // call it — there is no separate clock to remember to stop.
  function resume(session) {
    session.lesson = null;
    session.accumulator = 0;
    return session;
  }

  // Run-length encoded, because a run is mostly the same buttons held down: a
  // two-minute run collapses from 7200 steps to a few hundred pairs.
  function record(session, mask) {
    const last = session.tape[session.tape.length - 1];
    if (last && last[0] === mask) last[1]++;
    else session.tape.push([mask, 1]);
  }

  function tape(session) {
    return session.tape.map((pair) => pair[0].toString(16) + "x" + pair[1]).join(".");
  }

  function advance(session, dt, poll) {
    // Mid-lesson: the world holds still and the camera does not, so you can
    // look at the thing being explained while it is being explained.
    if (session.lesson) {
      poll();
      return session;
    }

    session.accumulator += Math.min(dt, 0.25);

    let taken = 0;
    while (session.accumulator >= STEP && taken < MAX_CATCHUP) {
      const input = poll();
      record(session, input.mask || 0);
      Player.update(session.player, session.level, input, STEP);
      Enemy.update(session.stalactites, session.player, session.level, STEP);
      stepCrumbles(session, STEP);

      // The ghost runs on the same clock and nothing else in common: it is a
      // recording being played, not a runner being simulated against.
      if (session.ghost && !session.ghost.finished) {
        Player.update(session.ghost, session.ghostLevel, session.ghostInput(), STEP);
      }
      session.accumulator -= STEP;
      session.steps++;
      taken++;

      // Reached the next thing worth saying. Stop here rather than at the end
      // of the frame, so the runner is standing where the lesson is about.
      const marks = session.level.teach;
      if (marks && session.taught < marks.length &&
          session.player.body.x >= marks[session.taught].x) {
        session.lesson = marks[session.taught];
        session.taught++;
        session.accumulator = 0;
        break;
      }
    }

    // After a long stall, drop the backlog rather than fast-forwarding through
    // it — catching up at speed is how a tab-switch turns into a death.
    if (taken === MAX_CATCHUP) session.accumulator = 0;
    return session;
  }

  return { STEP, MAX_CATCHUP, CRUMBLE, create, advance, resume, tape, decodeTape };
})();
