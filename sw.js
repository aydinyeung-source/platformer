// sw.js — the game, kept on the device

// Once it has loaded, this game is a seed, some arithmetic and a canvas. There
// is no level to download and no server to ask what happens next, so there is
// no good reason it should need the network to start. The worker is what makes
// that true rather than nearly true.

// Bump this whenever any cached file changes, and mean it: the cache is served
// before the network, so a stale copy is served for ever until this string is
// different. It is the same version the page shows in its corner and the same
// one runs.js sends with a run, so all three move together or none of them do.
const VERSION = "1.55.0";
const CACHE = "platformer-" + VERSION;

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

      // Take over without waiting for every tab to close. The cache is named
      // after the version, so a worker that activates early cannot mix a new
      // page with old files — it has its own cache or it has nothing.
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
            .filter((name) => name.startsWith("platformer-") && name !== CACHE)
            .map((name) => caches.delete(name))
        )
      )
      // Only this app's caches, matched by prefix. Anything else on the origin
      // belongs to somebody else and is not ours to delete.
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

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);

  // ignoreSearch, so index.html?installed=1 is still index.html. Nothing this
  // app serves varies by query string.
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Whole responses from this origin only. A redirect or an opaque
    // cross-origin reply cached here is a file that cannot be read back and a
    // cache that cannot be cleared by looking at it.
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
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
  event.respondWith(cacheFirst(event.request));
});
