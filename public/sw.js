/* ============================================================
   LENZO MUSIC — DEVICE AUDIO CACHE (service worker)
   ------------------------------------------------------------
   Once a song has played, its audio bytes are stored on the
   device (Cache Storage), so replaying it starts instantly —
   zero network — and still works offline (within the cap).

   Strategy per /api/music/stream?...&tid=<trackId> request:
     1. Serve from cache when present (range requests are
        sliced from the stored full response).
     2. On a miss, pass the live response through AND fetch the
        full file once in the background to store it.

   Keyed by stable track id, because the resolved CDN links are
   signed and expiring — the cache must outlive each link.

   Storage cap: FIFO eviction at MAX_ENTRIES (~250 songs ≈ 1 GB
   at 128 kbps), the same budget a music app asks the browser
   for on install.
   ============================================================ */

const CACHE_NAME = "audio-cache-v1";
const KEY_PREFIX = "/__audio__/";
const MAX_ENTRIES = 250;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE_NAME) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

function isStreamRequest(url) {
  return (
    url.pathname === "/api/music/stream" &&
    new URLSearchParams(url.search).get("tid")
  );
}

function cacheKey(url) {
  const tid = new URLSearchParams(url.search).get("tid");
  return new URL(KEY_PREFIX + encodeURIComponent(tid), self.location.origin).toString();
}

async function evictIfNeeded() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  let extra = keys.length - MAX_ENTRIES;
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !isStreamRequest(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const key = cacheKey(url);
      const cached = await sliceCached(cache, key, event.request);
      if (cached) return cached;

      // Live pass-through for the player, plus a background store
      // of the full file (the player's request may be ranged).
      const storeFull = fetch(url.toString(), { cache: "no-store" })
        .then(async (full) => {
          if (!full.ok) return;
          await cache.put(key, full.clone());
          await evictIfNeeded();
        })
        .catch(() => {});

      const live = fetch(event.request).catch(() => fetch(url.toString()));
      return Promise.all([live, storeFull]).then(([res]) => res);
    })()
  );
});
