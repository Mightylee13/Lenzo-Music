/* ============================================================
   LENZO ENGINE — standalone Spotify + YouTube playback engine.

   Same internals as the app's src/lib/server/spotifyEngine.ts
   (anonymous Spotify web-player session for search/canonicalise,
   judged YouTube picks for full-length audio), wrapped in a tiny
   zero-dependency HTTP service for Railway.

   THE IP RULE (critical, verified live):
   googlevideo URLs are locked to the IP that fetched them. This
   service resolves AND pipes the bytes, so the rule is always
   satisfied. Never hand a googlevideo URL to another host.
   ============================================================ */

const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const pathModule = path; // handler-local route var shadows this name
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { Readable } = require("node:stream");

const PORT = Number(process.env.PORT) || 8799;
const TOKEN = process.env.ENGINE_TOKEN || "";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0";
const SECRET = "376136387538459893883312310911992847112448894410210511297108";
const TOTP_VERSION = 61;
const APP_VERSION = "1.2.92.50.g97692e81";
const FALLBACK_HASHES = [
  "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0",
  "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
];

const BASE = { referer: "https://open.spotify.com/", origin: "https://open.spotify.com", "user-agent": UA, "accept-language": "en" };
const YT_CLIENTS = [
  // Each client needs its OWN user-agent: with the desktop Chrome UA on all of
  // them YouTube answers LOGIN_REQUIRED everywhere (verified live — IOS and
  // ANDROID return full audio when matched to their app user-agents).
  { clientName: "IOS", clientVersion: "20.10.4", userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)" },
  { clientName: "ANDROID", clientVersion: "20.10.38", userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip" },
  { clientName: "ANDROID_MUSIC", clientVersion: "7.27.52", userAgent: "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 15) gzip" },
  { clientName: "TVHTML5", clientVersion: "7.20250312.16.00", userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version" },
];

/* ---------- tiny state + caches ---------- */
const S = {
  token: null, clientToken: null, expires: 0,
  discoveredHash: null,
  playerBlockedUntil: 0,
  instanceProxyDownUntil: 0,
  mirrorDownUntil: 0,
  searchCache: new Map(),
  resolveCache: new Map(),
  streamCache: new Map(),
  nullStream: new Map(), // videoId → ts of a recent total-audio failure
  alternates: new Map(), // videoId → other uploads of the same song (judge's ranked runners-up)
};
const SEARCH_TTL_OK = 10 * 60 * 1000, SEARCH_TTL_FAIL = 60 * 1000;
const RESOLVE_TTL_OK = 30 * 60 * 1000;
const STREAM_TTL = 25 * 60 * 1000;
const PLAYER_BLOCK_TTL = 2 * 60 * 1000; // short cooldown — a stale 30min block made every resolve fail even after the block cleared (seen live on Railway)
const INSTANCE_DOWN_TTL = 10 * 60 * 1000;
const INSTANCE_TARGETS = ["https://inv.nadeko.net", "https://invidious.nerdvpn.de", "https://yewtu.be", "https://invidious.f5.si", "https://iv.melmac.space"];
const MIRROR_DOWN_TTL = 5 * 60 * 1000;
const MIRROR_BASE = (process.env.MIRROR_BASE_URL || "https://api.theresav.eu").replace(/\/+$/, "");
const MIRROR_KEY = process.env.MIRROR_API_KEY || "Lenzorah"; // env override on Railway; fallback = app's mirror key

const NULL_STREAM_TTL = 60 * 1000; // remember a video that failed ALL audio legs for 60s — repeat /stream hits 404 fast instead of re-running the whole chain
const IN_FLIGHT = new Map(); // dedup: videoId → running ytAudio promise (concurrent player retries share one chain)

/** One ytAudio for a videoId runs at a time; concurrent callers await the same promise. */
function ytAudioShared(videoId, force) {
  const k = `${videoId}:${force ? 1 : 0}`;
  if (IN_FLIGHT.has(k)) return IN_FLIGHT.get(k);
  const p = (async () => {
    try { return await ytAudio(videoId, force); }
    finally { IN_FLIGHT.delete(k); }
  })();
  IN_FLIGHT.set(k, p);
  return p;
}

/* ---------- disk cache: full songs, served with real byte-ranges ---------- */
// Mirror MP3 links accept no Range header and can expire under the player:
// every buffer refill or seek made the browser re-fetch a whole 200 body —
// that mismatch is what crackled and cut songs short. The engine now keeps
// each fully downloaded song on disk and serves clean 206 ranges from it.
const AUDIO_DIR = process.env.AUDIO_CACHE_DIR || path.join(os.tmpdir(), "engine-audio");
const MAX_DISK_CACHE_BYTES = Number(process.env.AUDIO_CACHE_MAX_BYTES) || 400 * 1024 * 1024;
const DOWNLOADING = new Map(); // videoId → download promise
const TOTALS = new Map(); // videoId → expected total bytes (upstream content-length)

function audioPath(videoId) { return path.join(AUDIO_DIR, `${videoId}.audio`); }

async function evictDisk() {
  try {
    const entries = await fsp.readdir(AUDIO_DIR);
    const files = [];
    let total = 0;
    for (const name of entries) {
      try { const st = await fsp.stat(path.join(AUDIO_DIR, name)); files.push({ name, size: st.size, mtime: st.mtimeMs }); total += st.size; } catch { /* raced */ }
    }
    if (total <= MAX_DISK_CACHE_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= MAX_DISK_CACHE_BYTES * 0.8) break;
      await fsp.unlink(path.join(AUDIO_DIR, f.name)).catch(() => {});
      total -= f.size;
    }
  } catch { /* best effort */ }
}

/** Fetch the complete song once with the engine's OWN fetch (independent of
 * what the player reads), verify integrity, then rename into the cache.
 * `minBytes` guards against converters that claim a full filesize but serve
 * a truncated file (observed: mirror claimed 4.4MB, delivered 353KB) — a
 * short read must never become a "cached complete" song that stops early. */
async function downloadToDisk(videoId, url, minBytes = 0) {
  const existing = DOWNLOADING.get(videoId);
  if (existing) return existing;
  const pr = (async () => {
    const p = audioPath(videoId);
    try {
      const st = await fsp.stat(p);
      if (st.size > 0) return st.size;
    } catch { /* not cached yet */ }
    const part = `${p}.part`;
    // a stale part from a killed run must never leak into a fresh download
    await fsp.unlink(part).catch(() => {});
    const r = await tf(url, { headers: { "user-agent": UA } }, 60000); // no Range: whole file; a stalled mirror must abort, not hang the serve loop
    if (!r.ok || !r.body) throw new Error(`download upstream ${r.status}`);
    const expected = Number(r.headers.get("content-length")) || 0;
    if (expected) TOTALS.set(videoId, expected);
    const ws = fs.createWriteStream(part);
    const rs = Readable.fromWeb(r.body);
    let written = 0;
    rs.on("data", (c) => { written += c.length; });
    await new Promise((resolve, reject) => {
      rs.on("error", reject);
      ws.on("error", reject);
      rs.pipe(ws).on("finish", resolve).on("error", reject);
    });
    // integrity: a truncated or client-cancelled download must never
    // become the cache — partial songs are exactly the bug being fixed.
    // No tolerance: the observed fake was within 6% of a 32kbps floor.
    const floor = Math.max(expected, minBytes);
    if (floor && written < floor) {
      await fsp.unlink(part).catch(() => {});
      TOTALS.delete(videoId);
      throw new Error(`download truncated ${written}/${floor}`);
    }
    if (expected && written !== expected) {
      await fsp.unlink(part).catch(() => {});
      TOTALS.delete(videoId);
      throw new Error(`download truncated ${written}/${expected}`);
    }
    // content check: converters sometimes serve HTML error pages, "Forbidden"
    // text or even APK files in place of audio (observed live) — only real
    // audio may enter the cache.
    const head = Buffer.alloc(16);
    const fd = await fsp.open(part, "r").catch(() => null);
    if (fd) {
      await fd.read(head, 0, 16, 0).catch(() => {});
      await fd.close().catch(() => {});
      const b4 = head.subarray(0, 4).toString("latin1");
      const isAudio =
        head.subarray(0, 3).toString("latin1") === "ID3" ||
        (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ||
        b4 === "OggS" || b4 === "fLaC" || b4 === "RIFF" ||
        head.subarray(4, 8).toString("latin1") === "ftyp";
      if (!isAudio) {
        await fsp.unlink(part).catch(() => {});
        TOTALS.delete(videoId);
        throw new Error("download is not audio");
      }
    }
    await fsp.rename(part, p);
    evictDisk();
    return written;
  })().catch((e) => { TOTALS.delete(videoId); throw e; }).finally(() => DOWNLOADING.delete(videoId));
  DOWNLOADING.set(videoId, pr);
  return pr;
}

async function isCachedComplete(videoId) {
  try { return (await fsp.stat(audioPath(videoId))).size > 0; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimum believable byte size for a song of a given audio object: the
 * mirror's claimed filesize AND a duration floor (96kbps — converters emit
 * 128kbps+; the observed fake was 30.8kbps for a 222s song) — the mirror has
 * been observed claiming a full filesize while serving a 47s slice of a
 * 3:42 song, so the duration floor must always apply too. */
function minBytesFor(audio) {
  if (!audio) return 0;
  const byDuration = audio.lengthSeconds ? audio.lengthSeconds * 12000 : 0;
  return Math.max(audio.contentLength || 0, byDuration);
}

async function serveFromDisk(req, res, videoId, contentType) {
  const p = audioPath(videoId);
  const st = await fsp.stat(p).catch(() => null);
  if (!st || st.size === 0) return false;
  const headers = {
    "content-type": contentType || "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    "access-control-allow-origin": "*",
  };
  const range = req.headers.range;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = Math.min(m[2] ? parseInt(m[2], 10) : st.size - 1, st.size - 1);
    if (start >= st.size) { res.writeHead(416, { "content-range": `bytes */${st.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") { res.end(); return true; }
    fs.createReadStream(p, { start, end })
      .on("error", () => { try { res.destroy(); } catch { /* gone */ } })
      .pipe(res);
    res.on("close", () => { /* node stream cleans itself up */ });
    return true;
  }
  res.writeHead(200, { ...headers, "content-length": st.size });
  if (req.method === "HEAD") { res.end(); return true; }
  fs.createReadStream(p).on("error", () => { try { res.destroy(); } catch { /* gone */ } }).pipe(res);
  return true;
}

function slug(t) {
  return (t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function evict(m) {
  if (m.size < 512) return;
  const ks = [...m.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 128);
  for (const [k] of ks) m.delete(k);
}
async function tf(url, init = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

/* ---------- spotify anonymous session ---------- */
function totp(tsms) {
  const counter = Math.floor(tsms / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", Buffer.from(SECRET, "utf8")).update(buf).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
async function getAuth(force = false) {
  if (!force && S.token && Date.now() < S.expires - 60000) return S;
  const now = Date.now();
  const params = new URLSearchParams({ reason: "init", productType: "web-player", totp: totp(now), totpServer: totp(now), totpVer: String(TOTP_VERSION) });
  const token = await (await tf(`https://open.spotify.com/api/token?${params}`, { headers: BASE }, 10000)).json();
  if (!token?.accessToken) throw new Error("Spotify token request failed");
  const client = await (await tf("https://clienttoken.spotify.com/v1/clienttoken", {
    method: "POST",
    headers: { ...BASE, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_data: { client_version: APP_VERSION, client_id: token.clientId, js_sdk_data: { device_brand: "unknown", device_model: "unknown", os: "windows", os_version: "NT 10.0", device_id: crypto.randomUUID(), device_type: "computer" } } }),
  }, 10000)).json();
  if (!client?.granted_token?.token) throw new Error("Spotify client token failed");
  S.token = token.accessToken;
  S.clientToken = client.granted_token.token;
  S.expires = token.accessTokenExpirationTimestampMs || now + 3000000;
  return S;
}
async function discoverHash() {
  if (S.discoveredHash !== null) return S.discoveredHash || null;
  S.discoveredHash = "";
  try {
    const html = await (await tf("https://open.spotify.com/", { headers: { "user-agent": UA } }, 10000)).text();
    const mainUrl = (html.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[0-9a-f]+\.js/) || [])[0];
    if (!mainUrl) return null;
    const mainJs = await (await tf(mainUrl, { headers: { "user-agent": UA, referer: "https://open.spotify.com/" } }, 10000)).text();
    const candidates = [...new Set([...mainJs.matchAll(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/[\w.\-]*search[\w.\-]*\.js/g)].map((x) => x[0]))];
    for (const url of candidates) {
      const chunk = await (await tf(url, { headers: { "user-agent": UA, referer: "https://open.spotify.com/" } }, 10000)).text();
      const hash = (chunk.match(/"searchDesktop","query","([a-f0-9]{64})"/) || [])[1];
      if (hash) { S.discoveredHash = hash; break; }
    }
  } catch { S.discoveredHash = ""; }
  return S.discoveredHash || null;
}

/* ---------- spotify catalogue search ---------- */
async function searchRaw(term, limit) {
  term = (term || "").trim();
  if (!term) return { tracks: [], albums: [], artists: [] };
  const key = `${term.toLowerCase()}::${limit}`;
  const hit = S.searchCache.get(key);
  if (hit) {
    if (Date.now() - hit.ts < (hit.ok ? SEARCH_TTL_OK : SEARCH_TTL_FAIL)) {
      if (!hit.ok) throw new Error(hit.error || "engine search failed");
      return hit.value;
    }
    S.searchCache.delete(key);
  }
  try {
    let auth = await getAuth(false);
    const runQuery = async (hash) => {
      const variables = { searchTerm: term, offset: 0, limit, numberOfTopResults: 3, includeAudiobooks: false };
      const params = new URLSearchParams({
        operationName: "searchDesktop",
        variables: JSON.stringify(variables),
        extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
      });
      return fetch(`https://api-partner.spotify.com/pathfinder/v1/query?${params}`, {
        headers: { ...BASE, accept: "application/json", "app-platform": "WebPlayer", authorization: `Bearer ${auth.token}`, "client-token": auth.clientToken, "spotify-app-version": APP_VERSION },
      });
    };
    const tryHashes = async (hashes) => {
      for (const hash of hashes) {
        if (!hash) continue;
        let res = await runQuery(hash);
        if (res.status === 401) { auth = await getAuth(true); res = await runQuery(hash); }
        const json = await res.json().catch(() => null);
        if (json?.data?.searchV2) return json.data.searchV2;
      }
      return null;
    };
    const primary = S.discoveredHash ? [S.discoveredHash, ...FALLBACK_HASHES] : [...FALLBACK_HASHES];
    let data = await tryHashes(primary);
    if (!data) {
      const fresh = await discoverHash();
      if (fresh && !primary.includes(fresh)) data = await tryHashes([fresh]);
    }
    if (!data) throw new Error("Spotify search returned no data");
    const itemsOf = (n) => (Array.isArray(n?.items) ? n.items : []);
    const bigThumb = (s) => { if (!Array.isArray(s) || !s.length) return null; return s.reduce((a, b) => (((b.width || 0) > (a.width || 0)) ? b : a), s[0])?.url || null; };
    const value = {
      tracks: itemsOf(data.tracksV2).map((i) => {
        const d = i?.item?.data; if (!d) return null;
        const id = (d.uri || "").split(":")[2] || null;
        return {
          id, title: d.name || null,
          artist: (d.artists?.items || []).map((a) => a.profile?.name).filter(Boolean).join(", "),
          album: d.albumOfTrack?.name || null,
          year: d.albumOfTrack?.date?.year || null,
          albumType: d.albumOfTrack?.type || null,
          durationMs: d.duration?.totalMilliseconds || 0,
          explicit: d.contentRating?.label === "EXPLICIT",
          thumb: bigThumb(d.albumOfTrack?.coverArt?.sources),
        };
      }).filter(Boolean).slice(0, limit),
      albums: itemsOf(data.albumsV2).map((i) => {
        const d = i?.data; if (!d) return null;
        const id = (d.uri || "").split(":")[2] || null;
        return {
          id, name: d.name || null, type: d.type || null, year: d.date?.year || null,
          image: bigThumb(d.coverArt?.sources),
          artists: (d.artists?.items || []).map((a) => ({ name: a.profile?.name, uri: a.uri })),
        };
      }).filter(Boolean).slice(0, limit),
      artists: itemsOf(data.artists).map((i) => {
        const d = i?.data; if (!d) return null;
        const id = (d.uri || "").split(":")[2] || null;
        return { id, name: d.profile?.name || null, image: bigThumb(d.visuals?.avatarImage?.sources), followers: d.stats?.followers || 0 };
      }).filter(Boolean).slice(0, limit),
    };
    evict(S.searchCache);
    S.searchCache.set(key, { ts: Date.now(), ok: true, value });
    return value;
  } catch (err) {
    evict(S.searchCache);
    S.searchCache.set(key, { ts: Date.now(), ok: false, value: { tracks: [], albums: [], artists: [] }, error: err.message });
    throw err;
  }
}

/* ---------- youtube: judge (search + score) ---------- */
function runsText(node) {
  if (node && Array.isArray(node.runs)) return node.runs.map((r) => r?.text ?? "").join("");
  return typeof node === "string" ? node : "";
}
function scoreCandidate(hit, want) {
  const t = slug(hit.titleTxt);
  const channel = slug(hit.channel || "");
  const wantTitle = slug(want.title);
  const wantFirstArtist = slug((want.artist || "").split(",")[0]);
  const titleTokens = wantTitle.split("-").filter((x) => x.length > 2);
  if (!t) return -99;
  // Title coverage is MANDATORY (verified live: artist-only match once
  // played a different song).
  if (titleTokens.length) {
    const coverage = titleTokens.filter((tk) => t.includes(tk)).length / titleTokens.length;
    if (coverage < 0.5) return -99;
  } else if (!channel.includes(wantFirstArtist)) {
    return -99;
  }
  let score = 0;
  if (t.includes(wantTitle)) score += 2;
  if (channel.includes(wantFirstArtist)) score += 1;
  if (/\b(remix(es)?|bootleg|sped\s*up|slowed|nightcore|8d\s*audio|performance|cover|karaoke)\b/.test(t) && !wantTitle.includes("remix")) score -= 4;
  if (/\b(lyric[s]?\s*video|instrumental|karaoke|8d)\b/.test(t) && titleTokens.length > 1) score -= 4;
  if (/\b(live|concert|tour)\b/.test(t) && !wantTitle.includes("live")) score -= 2;
  if (/\b(full album|mix|compilation|hour)\b/.test(t)) score -= 2;
  if (hit.idx === 0) score += 0.5;
  return score;
}
async function ytSearch(q) {
  const sRes = await tf("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20241126.01.00", hl: "en", gl: "US" } },
      query: q,
      params: "EgIQAQ==",
    }),
  }, 12000);
  const sJson = await sRes.json();
  const sections = sJson?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  const flat = Array.isArray(sections) ? sections.flatMap((c) => (Array.isArray(c?.itemSectionRenderer?.contents) ? c.itemSectionRenderer.contents : [])) : [];
  return flat
    .map((i) => i?.videoRenderer)
    .filter((v) => v && typeof v.videoId === "string")
    .slice(0, 8)
    .map((v, idx) => ({
      idx,
      videoId: v.videoId,
      titleTxt: runsText(v.title),
      channel: runsText(v.ownerText) || runsText(v.longBylineText),
    }));
}

/* ---------- youtube: player + audio url (SAME-IP rule) ---------- */
/** Invidious/Piped proxy leg for when the direct player is bot-blocked. */
async function ytViaInstanceProxy(videoId) {
  if (S.instanceProxyDownUntil > Date.now()) return null;
  try {
    const probes = await Promise.allSettled(INSTANCE_TARGETS.map(async (inst) => {
      const r = await tf(`${inst}/api/v1/videos/${videoId}`, { headers: { accept: "application/json" } }, 6000);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const audios = (Array.isArray(j?.adaptiveFormats) ? j.adaptiveFormats : [])
        .filter((f) => String(f?.type ?? "").startsWith("audio/") && f?.itag)
        .sort((a, b) => (Number(b?.bitrate) || 0) - (Number(a?.bitrate) || 0));
      if (!audios.length) throw new Error("no audio formats");
      const best = audios[0];
      return {
        url: `${inst}/latest_version?id=${videoId}&itag=${best.itag}&local=true`,
        mimeType: String(best.type ?? "").split(";")[0] || null,
        contentLength: null,
        lengthSeconds: Number(j?.lengthSeconds) || null,
        client: `invidious:${new URL(inst).hostname}`,
      };
    }));
    const ok = probes.find((p) => p.status === "fulfilled");
    if (ok) {
      S.instanceProxyDownUntil = 0;
      S.playerBlockedUntil = 0;
      console.log(`[engine] instance proxy serve via ${ok.value.client}`);
      return ok.value;
    }
  } catch { /* fallthrough */ }
  S.instanceProxyDownUntil = Date.now() + INSTANCE_DOWN_TTL;
  return null;
}

/**
 * Final fallback leg: the MP3 converter mirror. The mirror converts a
 * YouTube URL server-side, so its mp3 is NOT IP-locked and works from
 * anywhere — this keeps the engine productive even while YouTube
 * bot-blocks OR refreshes a googlevideo url mid-stream.
 */
async function mirrorAudio(videoId, force = false) {
  if (!MIRROR_KEY) return null;
  // A single failed conversion (25s timeout on a slow job) must NOT flag the
  // mirror down engine-wide for 5 minutes — with direct legs bot-blocked that
  // window is a total outage. Only sustained failures (3+) cool it down,
  // and `force` (last-resort after every other leg died) always tries.
  if (!force && S.mirrorDownUntil > Date.now()) return null;
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const r = await tf(`${MIRROR_BASE}/api/download/ytmp3?url=${encodeURIComponent(url)}`, { headers: { "x-apikey": MIRROR_KEY, accept: "application/json" } }, 25000);
    const j = await r.json();
    const dl = j?.download_url || j?.downloadUrl;
    if (!dl) {
      S.mirrorFails = (S.mirrorFails || 0) + 1;
      if (S.mirrorFails >= 3) S.mirrorDownUntil = Date.now() + MIRROR_DOWN_TTL;
      return null;
    }
    S.mirrorFails = 0;
    S.mirrorDownUntil = 0;
    return {
      url: dl,
      mimeType: "audio/mpeg",
      contentLength: Number(j?.filesize) || null, // claimed size — verified at download time
      lengthSeconds: Number(j?.duration_sec) || null,
      client: "mirror:ytmp3",
    };
  } catch {
    S.mirrorFails = (S.mirrorFails || 0) + 1;
    if (S.mirrorFails >= 3) S.mirrorDownUntil = Date.now() + MIRROR_DOWN_TTL;
    return null;
  }
}
async function ytAudio(videoId, force = false) {
  if (!/^[A-Za-z0-9_-]{8,16}$/.test(videoId)) return null;
  const hit = S.streamCache.get(videoId);
  if (hit && !force && Date.now() - hit.ts < STREAM_TTL) return hit;
  // Bot-block only skips the DIRECT player calls — proxies always try.
  const directBlocked = !force && S.playerBlockedUntil > Date.now();
  let last = null;
  let botBlocked = false;
  // Kick the mirror conversion EARLY (fire-and-forget): when the direct legs
  // fail — the common case on blocked datacenter IPs — its ~10-15s has
  // already been running during the player probes instead of starting after.
  const mirrorBg = mirrorAudio(videoId).catch(() => null);
  if (!directBlocked) {
    for (const client of YT_CLIENTS) {
      try {
        const pRes = await tf("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": client.userAgent || UA },
          body: JSON.stringify({
            context: { client: { clientName: client.clientName, clientVersion: client.clientVersion, hl: "en", gl: "US" } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        }, 8000);
        const pJson = await pRes.json();
        // LOGIN_REQUIRED on one client must NOT abort the rest — different
        // clients get bot-blocked independently (break here once made a single
        // IOS block kill ANDROID legs that would have succeeded).
        if (pJson?.playabilityStatus?.status === "LOGIN_REQUIRED") { botBlocked = true; continue; }
        const streaming = pJson?.streamingData || {};
        const formats = [...(Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : []), ...(Array.isArray(streaming.formats) ? streaming.formats : [])];
        const audio = formats.filter((f) => f?.url && String(f?.mimeType || "").startsWith("audio/")).sort((a, b) => (Number(b?.bitrate) || 0) - (Number(a?.bitrate) || 0))[0];
        if (audio) {
          // Deep-range gate: googlevideo URLs issued without a valid PoToken
          // serve only the first ~2MB — every Range past that 403s. The
          // browser then hits the wall mid-song, the element fires "ended",
          // and playback skips. Probe the TAIL once; if deep ranges are
          // refused this client is useless for full playback — keep looking.
          const clen = Number(audio.contentLength) || 0;
          const tailFrom = clen > 128000 ? clen - 65536 : 4000000;
          const tail = await tf(audio.url, { headers: { Range: `bytes=${tailFrom}-`, "user-agent": client.userAgent || UA } }, 4000).catch(() => null);
          const tailOk = tail && (tail.ok || tail.status === 206);
          if (tail) { try { await tail.arrayBuffer(); } catch { /* drain best-effort */ } }
          // A range-limited URL is URL-level, not client-level: if the tail
          // is refused, every other client will be too — go straight to the
          // (already-running) mirror race instead of probing the ladder.
          if (!tailOk) break;
          S.playerBlockedUntil = 0;
          last = { url: audio.url, mimeType: audio.mimeType, contentLength: clen || null, lengthSeconds: Number(pJson?.videoDetails?.lengthSeconds) || null, videoTitle: runsText(pJson?.videoDetails?.title) || null, client: client.clientName };
          break;
        }
      } catch { /* next client */ }
    }
  }
  if (!last?.url) {
    if (botBlocked) {
      S.playerBlockedUntil = Date.now() + PLAYER_BLOCK_TTL;
      console.log("[engine] youtube player bot-blocked — instance proxies take over");
    }
    // The mirror leg started in the background at the top — by the time we
    // reach here it has usually finished; instance probes still race it.
    const legs = [ytViaInstanceProxy(videoId), mirrorBg];
    for (const settled of await Promise.allSettled(legs)) {
      if (settled.status === "fulfilled" && settled.value?.url) { last = settled.value; break; }
    }
    if (!last?.url) {
      // Nothing worked — one forced mirror attempt ignoring any cooldown:
      // a stale flag must never turn a playable song into a 404.
      last = await mirrorAudio(videoId, true).catch(() => null) ?? last;
    }
    if (last?.client === "mirror:ytmp3") console.log("[engine] mirror fallback serves", videoId);
    if (!last?.url) {
      if (hit) S.streamCache.delete(videoId);
      S.nullStream.set(videoId, Date.now()); // repeat hits 404 fast for NULL_STREAM_TTL
      evict(S.nullStream);
      return null;
    }
  }
  evict(S.streamCache);
  S.streamCache.set(videoId, { ts: Date.now(), ...last });
  return last;
}

/* ---------- full resolution for a track ---------- */
let lastDiag = null; // attached to /resolve 404s for hop-level debugging
async function resolve(want, force = false) {
  const title = (want.title || "").trim();
  const artist = (want.artist || "").trim();
  if (!title && !want.videoId) return null;

  // Direct videoId hand-off: the app already knows the YouTube id for
  // youtube-sourced catalogue tracks (tr_yt_*). Their listings carry the
  // channel name in the title ("Alakori - Falz, Dice Ailes"), which the
  // judge can never re-find through search — resolve the id outright.
  if (want.videoId && /^[A-Za-z0-9_-]{8,16}$/.test(want.videoId)) {
    const key = `r:vid:${want.videoId}`;
    const cachedPick = force ? undefined : S.resolveCache.get(key);
    if (cachedPick && Date.now() - cachedPick.ts < RESOLVE_TTL_OK) return cachedPick.pick;
    const audio = await ytAudio(want.videoId, force);
    (lastDiag = { spotify: null, searches: [], candidates: 1, botBlocked: false, instanceDownUntil: null, videoIdDirect: true });
    if (!audio?.url) {
      S.nullStream.set(want.videoId, Date.now());
      return null;
    }
    const pick = { videoId: want.videoId, title: audio.videoTitle || title, durationSec: audio.lengthSeconds, score: 1, leg: audio.client || "youtube-direct" };
    evict(S.resolveCache);
    S.resolveCache.set(key, { ts: Date.now(), pick });
    S.playerBlockedUntil = 0;
    return pick;
  }

  if (!title) return null;
  const key = `r:${slug(title)}::${slug(artist.split(",")[0])}`;
  const hit = force ? undefined : S.resolveCache.get(key);
  if (hit && Date.now() - hit.ts < RESOLVE_TTL_OK) return hit.pick;

  // 1. Canonicalise against the catalogue — but only trust its first hit
  //    when the title actually resembles the ask (verified live: Spotify
  //    can rank a different song first for multi-word queries).
  const candidatesOf = async () => {
    const cands = [];
    try {
      const search = await searchRaw(`${title} ${artist}`.trim(), 5);
      const wantTokens = slug(title).split("-").filter((t) => t.length > 2);
      const canonical = search.tracks.find((t) => {
        const ts = slug(t.title);
        if (!ts) return false;
        const covered = wantTokens.length ? wantTokens.filter((w) => ts.includes(w)).length / wantTokens.length : ts.includes(slug(title)) ? 1 : 0;
        return covered >= 0.5;
      });
      if (canonical) cands.push({ title: canonical.title, artist: canonical.artist });
    } catch { /* catalogue down */ }
    cands.push({ title, artist });
    return cands;
  };

  const judged = [];
  const diag = (lastDiag = { spotify: null, searches: [], candidates: 0, botBlocked: false, instanceDownUntil: null });
  for (const want2 of await candidatesOf()) {
    const q = [want2.title, want2.artist, "official audio"].filter(Boolean).join(" ");
    let hits = [];
    try {
      hits = await ytSearch(q);
      // YouTube's search occasionally answers 0 to a good query (anti-bot
      // noise, verified live). One plain retry before declaring dead.
      if (!hits.length) {
        const plain = [want2.title, want2.artist].filter(Boolean).join(" ");
        hits = await ytSearch(plain);
      }
      diag.searches.push({ q, hits: hits.length });
    }
    catch (e) { diag.searches.push({ q, error: String(e && e.message || e).slice(0, 120) }); }
    for (const hit2 of hits) judged.push({ hit: hit2, score: scoreCandidate(hit2, want2) });
  }
  judged.sort((a, b) => b.score - a.score);
  diag.judged = judged.slice(0, 6).map((j) => ({ t: j.hit.titleTxt.slice(0, 40), s: Math.round(j.score * 100) / 100 }));
  const tryList = async (ignoreBlock) => {
    for (const { hit: video, score } of judged) {
      if (score < 0.4) break;
      // ignoreBlock: one retry pass that ignores the bot-block flag — a
      // stale flagged state must not kill the whole engine for the TTL.
      const audio = await ytAudio(video.videoId, ignoreBlock ? true : force);
      if (audio?.url) {
        const pick = { videoId: video.videoId, title: video.titleTxt, durationSec: audio.lengthSeconds, score, leg: audio.client || "youtube-direct" };
        evict(S.resolveCache);
        S.resolveCache.set(key, { ts: Date.now(), pick });
        // remember the runner-up uploads — when this video's conversion is
        // broken (truncated/non-audio), /stream can pull another upload of
        // the same song instead of failing or serving a fake 47s file
        const alts = judged
          .filter((j) => j.score >= 0.4 && j.hit.videoId !== video.videoId)
          .slice(0, 3)
          .map((j) => j.hit.videoId);
        if (alts.length) {
          if (S.alternates.size > 256) S.alternates.delete(S.alternates.keys().next().value);
          S.alternates.set(video.videoId, alts);
        }
        return pick;
      }
    }
    return null;
  };
  const pick = (await tryList(false)) ?? (S.playerBlockedUntil > Date.now() ? await tryList(true) : null);
  if (pick) { S.playerBlockedUntil = 0; diag.botBlocked = false; }
  return pick; // not "no match" vs "unprovable" distinction kept simple;
               // callers retry via force when audio dies mid-stream
}

/* ---------- identity guard (same rules as the app) ---------- */
function identityMatches(want, resolved) {
  const t = want.title || "";
  const r = resolved ?? "";
  const rs = slug(r);
  const ws = slug(t);
  const wTokens = ws.split("-").filter((x) => x.length > 1);
  if (!wTokens.length || !rs) return true;
  const covered = wTokens.filter((x) => rs.includes(x)).length / wTokens.length;
  if (covered < 0.6) return false;
  if (/\b(remix(es)?|bootleg|sped\s*up|slowed|nightcore|8d\s*audio|performance|cover|karaoke)\b/.test(rs) && !ws.includes("remix")) return false;
  return true;
}

/* ---------- range-aware byte piping ---------- */
function pipeResponse(upstream, req, res, contentType) {
  const headers = {
    "content-type": contentType || upstream.headers.get("content-type") || "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    "access-control-allow-origin": "*",
  };
  const len = upstream.headers.get("content-length");
  if (len) headers["content-length"] = len;
  const cr = upstream.headers.get("content-range");
  if (cr) headers["content-range"] = cr;
  res.writeHead(cr ? 206 : upstream.status === 206 ? 206 : 200, headers);
  if (req.method === "HEAD") { res.end(); return; }
  if (!upstream.body) { res.end(); return; }
  // upstream.body is a WHATWG ReadableStream — adapt it before piping,
  // and swallow errors on BOTH sides: an aborted range request (seek)
  // or a dropped client must never bubble up and kill the process.
  res.on("error", () => { try { res.destroy(); } catch { /* gone */ } });
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on("error", () => { try { res.destroy(); } catch { /* gone */ } });
  nodeStream.pipe(res);
  res.on("close", () => { try { nodeStream.destroy(); } catch { /* gone */ } });
}

/* ---------- http server ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 200000) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function authorized(req, url) {
  if (!TOKEN) return true;
  if (req.headers["x-engine-token"] === TOKEN) return true;
  // <audio> elements cannot set custom headers — allow the token in the
  // query string (k=) for stream requests fetched by the player.
  return url.searchParams.get("k") === TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  try {
    if (!authorized(req, url)) return json(res, 401, { error: "unauthorized" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-engine-token, range",
      });
      return res.end();
    }

    if (path === "/health") {
      let disk = { files: 0, bytes: 0 };
      try {
        const entries = await fsp.readdir(AUDIO_DIR);
        for (const name of entries) {
          if (!name.endsWith(".audio")) continue;
          const st = await fsp.stat(pathModule.join(AUDIO_DIR, name)).catch(() => null);
          if (st) { disk.files++; disk.bytes += st.size; }
        }
      } catch { /* dir not created yet */ }
      return json(res, 200, { ok: true, blocked: S.playerBlockedUntil > Date.now(), uptimeSec: Math.round(process.uptime()), disk });
    }

    if (path === "/resolve" && req.method === "POST") {
      const body = await readBody(req);
      if (!body?.title) return json(res, 400, { error: "title is required" });
      const t0 = Date.now();
      const pick = await resolve(body, body.force === true);
      if (!pick || !pick.videoId) {
        return json(res, 404, { error: "no full-length audio found", diag: lastDiag });
      }
      if (body.force === true) {
        // a forced resolve may be retrying a bad cached download (truncated
        // converter output) — purge it so the re-download can't be skipped
        await fsp.unlink(audioPath(pick.videoId)).catch(() => {});
        await fsp.unlink(`${audioPath(pick.videoId)}.part`).catch(() => {});
        TOTALS.delete(pick.videoId);
        S.streamCache.delete(pick.videoId);
      }
      // identity guard: the judge winner must still match the LISTED song
      if (!identityMatches(body.title, pick.title)) return json(res, 404, { error: "identity mismatch" });
      // PRE-WARM (fire-and-forget): the player always hits /stream right
      // after a resolve — fetch the audio url AND pull the full song into
      // the disk cache, so by the time the player's next range requests
      // arrive they are served locally and can never expire or crackle.
      void (async () => {
        try {
          const a = await ytAudioShared(pick.videoId, false);
          if (a?.url && !(await isCachedComplete(pick.videoId))) {
            try {
              await downloadToDisk(pick.videoId, a.url, minBytesFor(a));
              console.log(`[engine] disk cache seeded ${pick.videoId}`);
              return;
            } catch { /* broken conversion — try other uploads below */ }
            for (const alt of S.alternates.get(pick.videoId) || []) {
              const a2 = await ytAudioShared(alt, false).catch(() => null);
              if (!a2?.url) continue;
              try {
                const size = await downloadToDisk(alt, a2.url, minBytesFor(a2));
                await fsp.copyFile(audioPath(alt), audioPath(pick.videoId));
                TOTALS.set(pick.videoId, size);
                console.log(`[engine] disk cache seeded ${pick.videoId} via alternate ${alt}`);
                return;
              } catch { continue; }
            }
          }
        } catch { /* best effort */ }
      })();
      return json(res, 200, {
        videoId: pick.videoId,
        title: pick.title,
        durationSec: pick.durationSec,
        leg: pick.leg,
        streamUrl: `/stream/${pick.videoId}`,
        resolvedMs: Date.now() - t0,
      });
    }

    let m = path.match(/^\/stream\/([A-Za-z0-9_-]{8,16})$/);
    if (m) {
      const videoId = m[1];
      // FAST PATH — full song already downloaded: serve real 206 ranges from
      // disk. No mirror hit, no expiry, no re-downloads; seeks and Safari's
      // tail probes are instant and stable.
      if (await serveFromDisk(req, res, videoId).catch(() => false)) return;
      const failedRecentlyAt = S.nullStream.get(videoId);
      let audio = S.streamCache.get(videoId) && Date.now() - S.streamCache.get(videoId).ts < STREAM_TTL
        ? S.streamCache.get(videoId)
        : await ytAudioShared(videoId, false);
      const freshFailure = !audio?.url && S.nullStream.get(videoId) !== failedRecentlyAt; // first attempt just exhausted every leg
      if (!audio?.url && !freshFailure) audio = await ytAudioShared(videoId, true); // force re-resolve even when bot-block flagged
      if (!audio?.url) {
        if (S.nullStream.get(videoId) !== failedRecentlyAt || !failedRecentlyAt) S.nullStream.set(videoId, Date.now());
        return json(res, 404, { error: "no audio" });
      }
      S.nullStream.delete(videoId);
      // MIRROR PATH: the engine downloads the full song ONCE with its own
      // fetch and the download is VALIDATED (real audio magic bytes, size
      // vs claimed/duration) BEFORE any of it is served — progressive
      // streaming of an unvalidated file is how a fake 47s slice of a 3:42
      // song reached players. The download starts at /resolve (pre-warm),
      // so this wait is usually just the remaining seconds.
      if (audio.client === "mirror:ytmp3") {
        const dl = downloadToDisk(videoId, audio.url, minBytesFor(audio));
        const outcome = await dl.then(() => "ok").catch((e) => (e instanceof Error ? e.message : "failed"));
        if (outcome === "ok" && (await serveFromDisk(req, res, videoId).catch(() => false))) return;
        // Broken conversion for THIS video (truncated slice, non-audio
        // bytes): re-serving it would play a fake song or fail mid-way.
        // Rescue: pull another upload of the same song (the judge's
        // runners-up) and cache its bytes under this videoId, so the
        // player's stream url never changes.
        for (const alt of S.alternates.get(videoId) || []) {
          const a2 = await ytAudioShared(alt, false).catch(() => null);
          if (!a2?.url) continue;
          try {
            const size = await downloadToDisk(alt, a2.url, minBytesFor(a2));
            await fsp.copyFile(audioPath(alt), audioPath(videoId));
            TOTALS.set(videoId, size);
            evict(S.streamCache);
            S.streamCache.set(videoId, { ts: Date.now(), ...a2 });
            console.log(`[engine] broken download rescued via alternate upload ${alt}`);
            if (await serveFromDisk(req, res, videoId).catch(() => false)) return;
          } catch { continue; }
        }
        if (outcome !== "ok") return json(res, 502, { error: "audio failed validation" });
      }
      // DIRECT LEG (googlevideo): forward ranges — googlevideo honors them.
      const range = req.headers.range;
      const fetchUp = (r) => fetch(audio.url, { headers: r ? { Range: r, "user-agent": UA } : { "user-agent": UA } });
      // googlevideo rejects full-body fetches on some connections — a no-Range
      // request is retried as "everything from byte 0" (semantically identical).
      let up = await fetchUp(range);
      if ((!up.ok || up.status === 403) && !range) up = await fetchUp("bytes=0-");
      if (up.status === 403 || up.status === 410) {
        // cached url expired/binded — force one same-IP re-resolve
        audio = await ytAudioShared(videoId, true);
        if (!audio?.url) return json(res, 404, { error: "no audio" });
        up = await fetchUp(range || "bytes=0-");
      }
      if (!up.ok && up.status !== 206) return json(res, 502, { error: `upstream ${up.status}` });
      return pipeResponse(up, req, res, audio.mimeType);
    }

    if (path === "/search") {
      const q = url.searchParams.get("q") || "";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 40);
      const value = await searchRaw(q, limit);
      return json(res, 200, value);
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(`[http] ${req.method} ${path} -> ${err.message}`, err.stack?.split("\n").slice(1, 4).join(" | "));
    // Headers may already be on the wire (mid-stream failure) — in that
    // case we can only disconnect, never send a JSON error over it.
    if (res.headersSent) { try { res.destroy(); } catch { /* gone */ } return; }
    return json(res, 500, { error: err.message || "engine error" });
  }
});

// Last-resort guards: a single socket error must never take the engine
// down (verified live — an unhandled header race killed the process).
process.on("uncaughtException", (err) => console.error("[engine] uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("[engine] unhandled rejection:", err instanceof Error ? err.message : err));

server.listen(PORT, "0.0.0.0", () => {
  fsp.mkdir(AUDIO_DIR, { recursive: true }).catch(() => {});
  console.log(`[engine] listening on :${PORT}${TOKEN ? " (token required)" : ""}`);
  // Warm the Spotify session + persisted-query hash NOW so the first
  // search after a restart answers in ~1s instead of ~15-20s.
  getAuth(true)
    .then(() => discoverHash())
    .then(() => console.log("[engine] spotify session warmed"))
    .catch((err) => console.error(`[engine] warmup failed: ${err instanceof Error ? err.message : err} — will retry lazily`));
});
