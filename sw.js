// sw.js — the game, kept on the device

// Once it has loaded, this game is a seed, some arithmetic and a canvas. There
// is no level to download and no server to ask what happens next, so there is
// no good reason it should need the network to start. The worker is what makes
// that true rather than nearly true.

// The version does not move any more, and the cache no longer hangs off it.
//
// It used to. The name of the cache was the version string, the cache was
// answered before the network, and the only thing that could ever retire a
// stale file was somebody remembering to type a new number into three files at
// once. That works exactly as long as the number keeps moving. Frozen, it is
// the worst bug this file could have: an installed copy that has decided what
// the game is and will never ask again, with no error and nothing to notice.
//
// So the strategy carries the freshness instead of the string. Every request
// goes to the network first and falls back to the cache when the network is not
// there — which is the same offline guarantee as before, arrived at without
// anything to remember. The cache name is fixed because it no longer identifies
// a version of anything; it is just where this app's copy lives.
const VERSION = "1.0.0";
const CACHE = "platformer";

// Every file index.html actually pulls in, plus the two things an installed app
// needs to look like one. js/audio.js and js/utils.js are deliberately absent:
// they are one-line stubs nothing loads, and a precache list that names files
// the page never asks for is a list that stops describing the page.
const CORE = [
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.webmanifest",
  "./js/rng.js",
  "./js/input.js",
  "./js/camera.js",
  "./js/ui.js",
  "./js/mainscreen.js",
  "./js/level.js",
  "./js/physics.js",
  "./js/player.js",
  "./js/enemy.js",
  "./js/game.js",
  "./js/runs.js",
  "./js/auth.js",
  "./assets/sprites/player.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
];

// Files that are wanted offline but may not be there to fetch. This list used
// to mean something stronger — the handful allowed past a cache-first rule —
// and it does not need to any more, because everything is asked of the network
// now. All that is left is that these cannot go in the list above: addAll is
// all or nothing, and one 404 in it would cost the entire install.
//
// Two names for the gym because the file came out of its editor as gym.png.png
// and the obvious thing to call a replacement is gym.png; only one of them will
// exist.
const OPTIONAL = ["gym.png", "gym.png.png", "assets/ui_drop_shadow_03.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // All or nothing. A half-filled cache is the worst of both worlds: it
      // answers offline and answers wrong, with a page whose stylesheet is
      // there and whose physics is not.
      await cache.addAll(CORE);

      // The directory index is the same page as index.html on most hosts and a
      // 404 on a few. Asked for on its own so that a host which does not serve
      // it costs one navigation fallback rather than the entire install.
      await cache.add("./").catch(() => {});

      // The artwork, under either name it might be saved as, one at a time so
      // a missing one costs only itself.
      for (const name of OPTIONAL) {
        await cache.add("./" + name).catch(() => {});
      }

      // Take over without waiting for every tab to close. Nothing is served
      // from the cache while the network is answering, so an early activation
      // cannot hand anybody a mix of old files and new ones.
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("platformer") && name !== CACHE)
            .map((name) => caches.delete(name))
        )
      )
      // Only this app's caches, matched by prefix. Anything else on the origin
      // belongs to somebody else and is not ours to delete. The prefix has no
      // dash on it now so that it still sweeps up every platformer-1.86.2 left
      // on a device from back when the cache was named after the version.
      .then(() => self.clients.claim())
  );
});

// What is ours to answer, and what is emphatically not.
//
// Only GET, and only this origin. That one rule is what keeps the cloud live:
// every Supabase call — signing in, refreshing a token, the heartbeat that
// decides whether this tab still owns the account, submitting a finished run —
// is either a POST or a request to another origin, and usually both. None of it
// is touched here, so none of it can be answered from a cache. An account that
// logs in from a stale copy of a token response is not an account, and a
// leaderboard that answers from disk is a leaderboard of one.
function mine(request) {
  if (request.method !== "GET") return false;
  return new URL(request.url).origin === self.location.origin;
}

// The network, and the cache when there isn't one.
//
// Every file goes the same way now. There is no list of which ones are allowed
// to be fresh, because they all are: the artwork that gets redrawn without a
// line of code moving and the code itself are the same problem, and the answer
// to both is to ask. What the cache is for is the case where asking fails.
async function serve(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);

    // Whole responses from this origin only. A redirect or an opaque
    // cross-origin reply cached here is a file that cannot be read back and a
    // cache that cannot be cleared by looking at it.
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
      return response;
    }

    // A 404 or a redirect is not an answer worth preferring over the copy that
    // is already here and known to work. ignoreSearch, so index.html?installed=1
    // is still index.html — nothing this app serves varies by query string.
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    // Offline, and never cached. A page request can still be answered with the
    // one page this app has — it is a single document, so any address inside
    // the scope is that document.
    if (request.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  // Not calling respondWith at all is the point: the request goes to the
  // network exactly as it would with no worker installed.
  if (!mine(event.request)) return;
  event.respondWith(serve(event.request));
});
