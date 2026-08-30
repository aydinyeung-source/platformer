// leaderboard.js — recording runs and reading your own recent ones

const Runs = (() => {
  const VERSION = "1.12.0";

  function playerId() {
    const session = window.Auth && window.Auth.loadSession();
    return session && session.user && session.user.id;
  }

  // Only the result is kept — seed, distance, time. The run itself is not
  // stored: replaying it was worth the bytes for a public leaderboard, and this
  // is a personal history where nobody is competing to fake anything.
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
        checksum: run.checksum || null,
        client: VERSION,
      },
    });
  }

  // Your own runs, newest first. The filter on player_id is not optional:
  // profiles and runs are readable by everyone signed in, so an unfiltered
  // query would hand back the whole table.
  function mine(limit) {
    const id = playerId();
    if (!id) return Promise.reject(new Error("Not logged in"));

    const query =
      "/rest/v1/runs?player_id=eq." + id +
      "&select=seed,mode,reached,seconds,finished,created_at" +
      "&order=created_at.desc&limit=" + (limit || 10);

    return window.Auth.authed(query);
  }

  function clock(seconds) {
    const total = Math.floor(seconds);
    const rest = Math.round((seconds - total) * 100);
    return (
      String(Math.floor(total / 60)).padStart(2, "0") + ":" +
      String(total % 60).padStart(2, "0") + "." +
      String(rest).padStart(2, "0")
    );
  }

  return { VERSION, submit, mine, clock };
})();
