// leaderboard.js — submitting runs and reading the board

const Leaderboard = (() => {
  const VERSION = "1.9.0";

  function playerId() {
    const session = window.Auth && window.Auth.loadSession();
    return session && session.user && session.user.id;
  }

  // A run is submitted with the tape that produced it. The database refuses
  // times that are physically impossible on its own; the tape is what makes a
  // merely suspicious time disprovable afterwards.
  function submit(run) {
    const id = playerId();
    if (!id) return Promise.reject(new Error("Not logged in"));

    return window.Auth.authed("/rest/v1/runs", {
      method: "POST",
      body: {
        player_id: id,
        seed: run.seed,
        mode: run.mode,
        reached: Math.max(0, Math.round(run.reached)),
        seconds: Math.round(run.seconds * 100) / 100,
        falls: Math.max(0, run.falls | 0),
        finished: Boolean(run.finished),
        inputs: run.inputs || null,
        checksum: run.checksum || null,
        client: VERSION,
      },
    });
  }

  function top(seed, mode, limit) {
    return window.Auth.authed("/rest/v1/rpc/leaderboard", {
      method: "POST",
      body: { for_seed: seed, for_mode: mode, top: limit || 10 },
    });
  }

  function clock(seconds) {
    const total = Math.floor(seconds);
    const rest = Math.round((seconds - total) * 100);
    return (
      String(Math.floor(total / 60)).padStart(2, "0") +
      ":" +
      String(total % 60).padStart(2, "0") +
      "." +
      String(rest).padStart(2, "0")
    );
  }

  return { VERSION, submit, top, clock };
})();
