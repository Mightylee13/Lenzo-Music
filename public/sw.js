/* ============================================================
   LENZO MUSIC SERVICE WORKER
   Two independent caches:

   1) DEVICE AUDIO CACHE (audio-cache-v1)
      Once a song has played, its audio bytes are stored on the
      device keyed by stable track id (the resolved CDN links are
      signed and expiring). Replays start instantly — zero network
      — and still work offline (within the cap). Range requests
      are sliced from the stored full response.

   2) OFFLINE NAVIGATION CACHE (lenzo-nav-v1)
      Navigations + Next RSC payloads + immutable /_next/static
      assets are network-first with cache fallback, so routes you
      visited while online still open offline.
      API reads are NOT cached here — the page layer (localStorage
      useApi cache) handles its own offline repaint.

   ============================================================ */

const AUDIO_CACHE = "audio-cache-v1";
const AUDIO_KEY_PREFIX = "/__audio__/";
const AUDIO_MAX_ENTRIES = 250;

const NAV_CACHE = "lenzo-nav-v1";
const NAV_MAX_ENTRIES = 300;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== AUDIO_CACHE && name !== NAV_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

/* ---------------- helpers: audio cache ---------------- */

function isStreamRequest(url) {
  return (
    url.pathname === "/api/music/stream" &&
    new URLSearchParams(url.search).get("tid")
  );
}

function audioKey(url) {
  const tid = new URLSearchParams(url.search).get("tid");
  return new URL(AUDIO_KEY_PREFIX + encodeURIComponent(tid), self.location.origin).toString();
}

async function evictAudioIfNeeded() {
  const cache = await caches.open(AUDIO_CACHE);
  const keys = await cache.keys();
  let extra = keys.length - AUDIO_MAX_ENTRIES;
  for (const key of keys) {
    if (extra <= 0) break;
    await cache.delete(key);
    extra -= 1;
  }
}

/** Slice a cached full response to answer a Range request. */
async function sliceCached(cache, key, request) {
  const hit = await cache.match(key);
  if (!hit) return null;
  const range = request.headers.get("range");
  if (!range) return hit;

  const buffer = await hit.arrayBuffer();
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), buffer.byteLength - 1) : buffer.byteLength - 1;
  if (start >= buffer.byteLength || end < start) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${buffer.byteLength}` } });
  }
  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": hit.headers.get("Content-Type") ?? "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${buffer.byteLength}`,
      "Content-Length": String(end - start + 1),
      "X-Lenzo-Cache": "hit",
    },
  });
}

/* ---------------- helpers: navigation cache ---------------- */

async function trimCache(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const excess = keys.length - max;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch {
    /* best-effort */
  }
}

async function networkFirst(req, isNavigation) {
  const cache = await caches.open(NAV_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") {
      void cache.put(req, res.clone()).then(() => trimCache(NAV_CACHE, NAV_MAX_ENTRIES));
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (isNavigation) {
      // Unknown route offline: serve the cached app shell — the client
      // router renders the page from it.
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(NAV_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) {
    void cache.put(req, res.clone()).then(() => trimCache(NAV_CACHE, NAV_MAX_ENTRIES));
  }
  return res;
}

/* ---------------- fetch routing ---------------- */

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) Audio streams: device audio cache (network pass-through + store).
  if (isStreamRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(AUDIO_CACHE);
        const key = audioKey(url);
        const cached = await sliceCached(cache, key, req);
        if (cached) return cached;

        // Live pass-through for the player, plus a background store
        // of the full file (the player's request may be ranged).
        const storeFull = fetch(url.toString(), { cache: "no-store" })
          .then(async (full) => {
            if (!full.ok) return;
            await cache.put(key, full.clone());
            await evictAudioIfNeeded();
          })
          .catch(() => {});

        const live = fetch(req).catch(() => fetch(url.toString()));
        return Promise.all([live, storeFull]).then(([res]) => res);
      })()
    );
    return;
  }

  // 2) Same-origin navigation/static caching (offline route access).
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  const isNavigation = req.mode === "navigate";
  const isRsc = url.searchParams.has("_rsc") || req.headers.get("RSC") === "1";
  if (isNavigation || isRsc) {
    event.respondWith(networkFirst(req, isNavigation));
  }
});
