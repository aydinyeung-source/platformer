// enemy.js — hazards that move: what the cave does back

const Enemy = (() => {
  // A stalactite is the one thing in this cave that acts. Everything else is
  // terrain: it is where it is, and the only question is whether you can get
  // past it. This waits, notices you, and then commits — and because it commits
  // it has to be fair, which is what the warning is for.
  const TUNING = {
    gravity: 70,
    warning: 0.4, // seconds of shaking before it lets go
    notice: 3.5, // tiles away it starts paying attention
    lead: 0.4, // how near its aim has to be: this tolerance is the miss distance
    standing: 1, // how near the floor beneath it the runner has to be
    width: 0.8, // of a tile, for the purpose of being hit by one
  };

  // Four across and eight down: a wide base fixed to the rock, tapering to a
  // needle. Lit down the left and shadowed down the right, so it reads as
  // round — and in warm limestone, which is the one thing in this cave that is
  // neither the cold grey of the walls nor the orange of the fire, so it is
  // never mistaken for either.
  const ART_W = 4;
  const ART_H = 8;
  const ART = [
    { x: 0, y: 0, c: "#e6d5be" }, { x: 1, y: 0, c: "#c8a882" }, { x: 2, y: 0, c: "#a8896c" }, { x: 3, y: 0, c: "#6d543e" },
    { x: 0, y: 1, c: "#e6d5be" }, { x: 1, y: 1, c: "#c8a882" }, { x: 2, y: 1, c: "#a8896c" }, { x: 3, y: 1, c: "#6d543e" },
    { x: 1, y: 2, c: "#e6d5be" }, { x: 2, y: 2, c: "#c8a882" }, { x: 3, y: 2, c: "#6d543e" },
    { x: 1, y: 3, c: "#e6d5be" }, { x: 2, y: 3, c: "#c8a882" }, { x: 3, y: 3, c: "#6d543e" },
    { x: 1, y: 4, c: "#e6d5be" }, { x: 2, y: 4, c: "#6d543e" },
    { x: 1, y: 5, c: "#e6d5be" }, { x: 2, y: 5, c: "#6d543e" },
    { x: 1, y: 6, c: "#e6d5be" }, { x: 2, y: 6, c: "#6d543e" },
    { x: 1, y: 7, c: "#e6d5be" },
  ];

  // Simulation state, separate from where they are in the level: the level
  // knows where stalactites hang, a session knows which have fallen.
  function create(spots) {
    return (spots || []).map((s) => ({
      x: s.x,
      y: s.y,
      startY: s.y,
      floorY: s.floorY,
      vy: 0,
      state: "hanging",
      timer: 0,
    }));
  }

  // Awake only when the runner is on the floor it would land on: standing a
  // level below, or passing above it, is not being in its way.
  //
  // And it aims where the runner is going, not where they are. Between the
  // warning and the drop most of a second passes, and a runner at speed covers
  // six tiles in that — so a stalactite that waits until you are underneath it
  // lands behind you every time, which is a hazard that has never hurt anybody.
  // Leading the target is also the fairer of the two: it starts grinding while
  // you are still several tiles off and can see it, rather than directly over
  // your head.
  function noticed(s, player) {
    const body = player.body;
    const middle = body.x + body.w / 2;
    const centre = s.x + 0.5;

    const feet = body.y + body.h;
    if (!(feet > s.y && feet <= s.floorY + TUNING.standing)) return false;

    if (Math.abs(middle - centre) <= TUNING.notice) return true;

    // Where they will be when it arrives, if they hold their line.
    const drop = Math.sqrt(Math.max(0, 2 * (s.floorY - 1 - s.y)) / TUNING.gravity);
    const lead = middle + body.vx * (TUNING.warning + drop);
    return Math.abs(lead - centre) <= TUNING.lead;
  }

  function hits(s, player) {
    const body = player.body;
    const left = s.x + (1 - TUNING.width) / 2;
    return (
      body.x < left + TUNING.width &&
      body.x + body.w > left &&
      body.y < s.y + 1 &&
      body.y + body.h > s.y
    );
  }

  // One fixed step. Called from inside the simulation loop, never from the
  // frame loop: a stalactite is part of the run, so a seed and a tape have to
  // reproduce exactly when each one fell.
  function update(list, player, level, dt) {
    if (!list || player.finished) return list;

    for (const s of list) {
      if (s.state === "hanging") {
        if (noticed(s, player)) {
          s.state = "shaking";
          s.timer = TUNING.warning;
        }
        continue;
      }

      if (s.state === "shaking") {
        // The warning runs whether or not the runner is still there. Letting it
        // cancel would teach people to step back and forth under one until it
        // gave up, which is not a hazard, it is a switch.
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = "falling";
          s.timer = 0;
        }
        continue;
      }

      if (s.state !== "falling") continue;

      s.vy += TUNING.gravity * dt;
      s.y += s.vy * dt;

      if (player.recovering === 0 && hits(s, player)) {
        Player.recover(player, level);
        s.state = "shattered";
        continue;
      }

      // The floor it was always going to reach.
      if (s.y >= s.floorY - 1) {
        s.y = s.floorY - 1;
        s.state = "shattered";
      }
    }

    return list;
  }

  return { TUNING, ART, ART_W, ART_H, create, update, noticed, hits };
})();
