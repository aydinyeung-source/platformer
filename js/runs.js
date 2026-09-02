// leaderboard.js — recording runs and reading your own recent ones

const Runs = (() => {
  const VERSION = "1.47.0";

  // Your history lives on this machine first and in the cloud second. The
  // cloud copy is a convenience — it follows you to another browser — but it
  // is never the only copy, because a run you just finished disappearing
  // because you are not signed in, or the wifi dropped, is a bug the player
  // reads as "the game did not notice what I just did".
  const LOCAL_KEY = "platformer.local_runs";
  const KEEP = 20;

  function playerId() {
    const session = window.Auth && window.Auth.loadSession();
    return session && session.user && session.user.id;
  }

  function getLocalRuns() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return []; // blocked or corrupt storage: this session has no history
    }
  }

  // The same rounding the cloud row gets, so a run written in both places
  // reads as one run rather than two near-identical ones.
  function tidy(run) {
    return {
      seed: run.seed,
      mode: run.mode,
      reached: Math.max(0, Math.round(run.reached)),
      seconds: Math.round(run.seconds * 100) / 100,
      falls: Math.max(0, run.falls | 0),
      finished: Boolean(run.finished),
      created_at: new Date().toISOString(),
    };
  }

  function saveLocalRun(run) {
    const saved = tidy(run);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify([saved].concat(getLocalRuns()).slice(0, KEEP)));
    } catch (err) {
      // A full or private store costs the history, not the run.
    }
    return saved;
  }

  // Only the result is kept — seed, distance, time. The run itself is not
  // stored: replaying it was worth the bytes for a public leaderboard, and this
  // is a personal history where nobody is competing to fake anything.
  //
  // Always resolves. The local write is the part that matters and it has
  // already happened by the time the upload is attempted, so a rejected upload
  // is not a failure worth telling anyone about.
  function submit(run) {
    const saved = saveLocalRun(run);
    const id = playerId();
    if (!id) return Promise.resolve(saved);

    return window.Auth.authed("/rest/v1/runs", {
      method: "POST",
      body: {
        player_id: id,
        seed: saved.seed,
        mode: saved.mode,
        reached: saved.reached,
        seconds: saved.seconds,
        falls: saved.falls,
        finished: saved.finished,
        checksum: run.checksum || null,
        client: VERSION,
      },
    }).then(() => saved, () => saved);
  }

  // A run is its result on a cave: the same seed, mode, distance and time is
  // the same run however many places it was written down.
  function key(row) {
    return [row.seed, row.mode, Math.round(Number(row.reached)), Number(row.seconds).toFixed(2)].join("|");
  }

  // Of two copies of the same run, the later stamp wins. The local copy is
  // written the moment the door is reached and the cloud copy whenever the
  // request lands, so keeping the earlier one can drop a run you just finished
  // below older ones and out of a ten-row list.
  function merge(rows, limit) {
    const seen = new Map();
    rows.forEach((row) => {
      if (!row || !row.seed) return;
      const already = seen.get(key(row));
      if (!already || new Date(row.created_at) > new Date(already.created_at)) {
        seen.set(key(row), row);
      }
    });
    return Array.from(seen.values())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  // Your own runs, newest first. The filter on player_id is not optional:
  // profiles and runs are readable by everyone signed in, so an unfiltered
  // query would hand back the whole table.
  //
  // The local ones are the floor. Signed in, the cloud is asked as well and
  // folded in — but it is asked for extras, not for permission, so being
  // logged out or offline shows the same list it always did.
  function mine(limit) {
    const count = limit || 10;
    const local = getLocalRuns();
    const id = playerId();
    if (!id) return Promise.resolve(merge(local, count));

    const query =
      "/rest/v1/runs?player_id=eq." + id +
      "&select=seed,mode,reached,seconds,finished,created_at" +
      "&order=created_at.desc&limit=" + count;

    return window.Auth.authed(query).then(
      (cloud) => merge((Array.isArray(cloud) ? cloud : []).concat(local), count),
      () => merge(local, count)
    );
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

  return { VERSION, submit, mine, clock, saveLocalRun, getLocalRuns };
})();
