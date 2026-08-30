// game.js — entry point: canvas setup, game loop, state machine

const Game = (() => {
  // A fixed simulation step is what makes a run reproducible from its seed and
  // its inputs alone — variable-rate physics would give every machine a slightly
  // different run and make replays and ghosts impossible.
  const STEP = 1 / 60;
  const MAX_CATCHUP = 5;

  // Time to read the map before the clock starts. The camera is free the whole
  // time, which is the point: the route is worth looking at before you run it.
  const SCOUT_SECONDS = 10;

  function create(level) {
    return {
      level,
      player: Player.create(level),
      scout: SCOUT_SECONDS,
      // Every button press, at a fixed 60 Hz. A seed plus this tape reproduces
      // the run exactly, which is what lets a claimed time be checked rather
      // than taken on trust.
      tape: [],
      accumulator: 0,
      steps: 0,
    };
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
    // Scouting: the view moves, the runner does not, and the clock has not
    // started. Jump cuts it short for anyone who already knows the seed.
    if (session.scout > 0) {
      // The ten seconds are the point, so they are not skippable: the map is
      // meant to be read before it is run, and a skip button turns that into a
      // thing you press to get past.
      session.scout = Math.max(0, session.scout - dt);
      poll(); // consumed so a held jump does not buffer into the start
      return session;
    }

    session.accumulator += Math.min(dt, 0.25);

    let taken = 0;
    while (session.accumulator >= STEP && taken < MAX_CATCHUP) {
      const input = poll();
      record(session, input.mask || 0);
      Player.update(session.player, session.level, input, STEP);
      session.accumulator -= STEP;
      session.steps++;
      taken++;
    }

    // After a long stall, drop the backlog rather than fast-forwarding through
    // it — catching up at speed is how a tab-switch turns into a death.
    if (taken === MAX_CATCHUP) session.accumulator = 0;
    return session;
  }

  return { STEP, MAX_CATCHUP, SCOUT_SECONDS, create, advance, tape };
})();
