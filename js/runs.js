// leaderboard.js — recording runs and reading your own recent ones

const Runs = (() => {
  const VERSION = "1.0.0";

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
        // Said out loud rather than left to a column default, because the read
        // policy on this table is "NOT hidden" and SQL's NOT of NULL is NULL,
        // not true — and a row-level security check that comes back NULL hides
        // the row. A run inserted without this lands in the table, returns a
        // perfectly happy 201, and is then invisible to every query the game
        // makes, including the one that just wrote it. Nothing reports an error
        // anywhere along that path.
        hidden: false,
      },
    }).then(
      () => saved,
      (error) => {
        // Swallowed for the player, not for whoever is trying to work out why
        // the cloud is empty. Nothing here interrupts a finished run — that
        // rule stands — but a rejected upload used to leave no trace at all:
        // the local copy saved, the history looked right, and the only symptom
        // was a leaderboard nobody appeared on. A silent failure that lies
        // about succeeding is worse than a noisy one.
        console.warn("Run not uploaded:", error && error.message);
        return saved;
      }
    );
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

  // ---------------------------------------------------------- the leaderboard

  // One line per player, their best. Ordered by time already, so the first of
  // anybody's runs to arrive is the one that counts and the rest are the same
  // person having another go — which is worth exactly nothing on a board of ten
  // and would push nine other people off it.
  function best(rows, limit) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const id = row.player_id || "";
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push({
        id,
        who: "Player",
        seconds: Number(row.seconds),
        falls: Math.max(0, row.falls | 0),
        created_at: row.created_at,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Whose runs they were, asked for separately.
  //
  // The obvious way to do this is to embed the name in the first query and let
  // the database do the join. It cannot: PostgREST works out embeds from the
  // foreign keys, runs.player_id has no constraint pointing at profiles.id, and
  // asking for one anyway is a 400 with PGRST200 on it rather than a row with a
  // null name. That is a schema fact and no amount of trying it differently
  // changes it, so the join happens here instead — ten rows in, one query out,
  // and a board that works on the schema that exists rather than the one it
  // would have been tidier to have.
  //
  // Ranked before this runs, so it asks about ten people rather than forty.
  // Names are decoration on a list of times: if this fails, every row keeps the
  // placeholder it already has and the board is still a board.
  function withNames(rows) {
    const ids = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
    if (!ids.length) return Promise.resolve(rows);

    return window.Auth.authed(
      "/rest/v1/profiles?select=id,username&id=in.(" + ids.join(",") + ")"
    ).then((found) => {
      const names = new Map(
        (Array.isArray(found) ? found : []).map((row) => [row.id, row.username])
      );
      rows.forEach((row) => {
        row.who = names.get(row.id) || row.who;
      });
      return rows;
    }, () => rows);
  }

  // Today's cave, fastest first. Finished runs only — a leaderboard of people
  // who did not get there is a different list.
  //
  // Always resolves; signed out, the request never had a chance and an empty
  // list is the honest answer.
  function dailyLeaderboard(seed, limit = 10, mode = null) {
    const count = Math.max(1, limit || 10);

    // Times are only comparable within one length. The daily fixes its length
    // now, so every row worth ranking carries the same mode — but rows from
    // before it did are still in the table, and a 500 metre time on a board of
    // 1000 metre ones would sit at the top of it for ever.
    const length = mode ? "&mode=eq." + encodeURIComponent(mode) : "";

    // Normalised before it is asked for, and this is the whole reason the board
    // was empty. A seed is written down twice in different shapes: the daily is
    // generated as four characters, a dash and four more, but what a run is
    // filed under is the key — separators stripped, so that a seed retyped with
    // spaces or lowercase is understood to be the same cave. Asking for the
    // dashed spelling asks for a seed no row has ever been saved with, and the
    // answer is an empty list rather than an error, which is the kind of wrong
    // that looks like nobody has played yet.
    //
    // keyFor survives being applied to its own output, so a caller that has
    // already normalised is not punished for it.
    const filed = Rng.keyFor(seed);

    const query = (select) =>
      "/rest/v1/runs?seed=eq." + encodeURIComponent(filed) +
      "&finished=eq.true" + length + "&select=" + select +
      "&order=seconds.asc&limit=" + count * 4;

    return window.Auth.authed(query("player_id,seconds,falls,created_at")).then(
      (rows) => withNames(best(Array.isArray(rows) ? rows : [], count)),
      () => []
    );
  }

  function signedIn() {
    return Boolean(playerId());
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

  return {
    VERSION,
    submit,
    mine,
    dailyLeaderboard,
    signedIn,
    clock,
    saveLocalRun,
    getLocalRuns,
  };
})();
