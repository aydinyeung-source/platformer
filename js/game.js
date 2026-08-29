// game.js — entry point: canvas setup, game loop, state machine

const Game = (() => {
  // A fixed simulation step is what makes a run reproducible from its seed and
  // its inputs alone — variable-rate physics would give every machine a slightly
  // different run and make replays and ghosts impossible.
  const STEP = 1 / 60;
  const MAX_CATCHUP = 5;

  function create(level) {
    return {
      level,
      player: Player.create(level),
      accumulator: 0,
      steps: 0,
    };
  }

  function advance(session, dt, poll) {
    session.accumulator += Math.min(dt, 0.25);

    let taken = 0;
    while (session.accumulator >= STEP && taken < MAX_CATCHUP) {
      Player.update(session.player, session.level, poll(), STEP);
      session.accumulator -= STEP;
      session.steps++;
      taken++;
    }

    // After a long stall, drop the backlog rather than fast-forwarding through
    // it — catching up at speed is how a tab-switch turns into a death.
    if (taken === MAX_CATCHUP) session.accumulator = 0;
    return session;
  }

  return { STEP, MAX_CATCHUP, create, advance };
})();
