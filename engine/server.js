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
  { clientName: "IOS", clientVersion: "20.10.4" },
  { clientName: "ANDROID_MUSIC", clientVersion: "7.27.52" },
  { clientName: "ANDROID", clientVersion: "20.10.38" },
  { clientName: "TVHTML5", clientVersion: "7.20250312.16.00" },
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
async function mirrorAudio(videoId) {
  if (!MIRROR_KEY) return null;
  if (S.mirrorDownUntil > Date.now()) return null;
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const r = await tf(`${MIRROR_BASE}/api/download/ytmp3?url=${encodeURIComponent(url)}`, { headers: { "x-apikey": MIRROR_KEY, accept: "application/json" } }, 25000);
    const j = await r.json();
    const dl = j?.download_url || j?.downloadUrl;
    if (!dl) return null;
    return {
      url: dl,
      mimeType: "audio/mpeg",
      contentLength: null,
      lengthSeconds: Number(j?.duration_sec) || null,
      client: "mirror:ytmp3",
    };
  } catch {
    S.mirrorDownUntil = Date.now() + MIRROR_DOWN_TTL;
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
  if (!directBlocked) {
    for (const client of YT_CLIENTS) {
      try {
        const pRes = await tf("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": UA },
          body: JSON.stringify({
            context: { client: { ...client, hl: "en", gl: "US" } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        }, 8000);
        const pJson = await pRes.json();
        if (pJson?.playabilityStatus?.status === "LOGIN_REQUIRED") { botBlocked = true; break; }
        const streaming = pJson?.streamingData || {};
        const formats = [...(Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : []), ...(Array.isArray(streaming.formats) ? streaming.formats : [])];
        const audio = formats.filter((f) => f?.url && String(f?.mimeType || "").startsWith("audio/")).sort((a, b) => (Number(b?.bitrate) || 0) - (Number(a?.bitrate) || 0))[0];
        if (audio) {
          S.playerBlockedUntil = 0;
          last = { url: audio.url, mimeType: audio.mimeType, contentLength: audio.contentLength ? Number(audio.contentLength) : null, lengthSeconds: Number(pJson?.videoDetails?.lengthSeconds) || null };
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
    const viaInstance = await ytViaInstanceProxy(videoId);
    if (viaInstance) last = viaInstance;
    if (!last?.url) {
      const viaMirror = await mirrorAudio(videoId);
      if (viaMirror) {
        console.log("[engine] mirror fallback serves", videoId);
        last = viaMirror;
      }
    }
    if (!last?.url) {
      if (hit) S.streamCache.delete(videoId);
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
    try { hits = await ytSearch(q); diag.searches.push({ q, hits: hits.length }); }
    catch (e) { diag.searches.push({ q, error: String(e && e.message || e).slice(0, 120) }); }
    for (const hit2 of hits) judged.push({ hit: hit2, score: scoreCandidate(hit2, want2) });
  }
  judged.sort((a, b) => b.score - a.score);
  const tryList = async (ignoreBlock) => {
    for (const { hit: video, score } of judged) {
      if (score < 0.4) break;
      // ignoreBlock: one retry pass that ignores the bot-block flag — a
      // stale flagged state must not kill the whole engine for the TTL.
      const audio = await ytAudio(video.videoId, ignoreBlock ? true : force);
      if (audio?.url) {
        const pick = { videoId: video.videoId, title: video.titleTxt, durationSec: audio.lengthSeconds, score };
        evict(S.resolveCache);
        S.resolveCache.set(key, { ts: Date.now(), pick });
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
      return json(res, 200, { ok: true, blocked: S.playerBlockedUntil > Date.now(), uptimeSec: Math.round(process.uptime()) });
    }

    if (path === "/resolve" && req.method === "POST") {
      const body = await readBody(req);
      if (!body?.title) return json(res, 400, { error: "title is required" });
      const t0 = Date.now();
      const pick = await resolve(body, body.force === true);
      if (!pick || !pick.videoId) {
        diag.candidates = judged.length;
        diag.botBlocked = S.playerBlockedUntil > Date.now();
        diag.instanceDownUntil = S.instanceProxyDownUntil > Date.now() ? S.instanceProxyDownUntil : null;
        return json(res, 404, { error: "no full-length audio found", diag: lastDiag });
      }
      // identity guard: the judge winner must still match the LISTED song
      if (!identityMatches(body.title, pick.title)) return json(res, 404, { error: "identity mismatch" });
      return json(res, 200, {
        videoId: pick.videoId,
        title: pick.title,
        durationSec: pick.durationSec,
        streamUrl: `/stream/${pick.videoId}`,
        resolvedMs: Date.now() - t0,
      });
    }

    let m = path.match(/^\/stream\/([A-Za-z0-9_-]{8,16})$/);
    if (m) {
      const videoId = m[1];
      let audio = S.streamCache.get(videoId) && Date.now() - S.streamCache.get(videoId).ts < STREAM_TTL
        ? S.streamCache.get(videoId)
        : await ytAudio(videoId, false);
      if (!audio?.url) audio = await ytAudio(videoId, true); // force re-resolve even when bot-block flagged
      if (!audio?.url) return json(res, 404, { error: "no audio" });
      const range = req.headers.range;
      const fetchUp = (r) => fetch(audio.url, { headers: r ? { Range: r, "user-agent": UA } : { "user-agent": UA } });
      // googlevideo rejects full-body fetches on some connections — a no-Range
      // request is retried as "everything from byte 0" (semantically identical).
      let up = await fetchUp(range);
      if ((!up.ok || up.status === 403) && !range) up = await fetchUp("bytes=0-");
      if (up.status === 403 || up.status === 410) {
        // cached url expired/binded — force one same-IP re-resolve
        audio = await ytAudio(videoId, true);
        if (!audio?.url) return json(res, 404, { error: "no audio" });
        up = await fetchUp(range || "bytes=0-");
      }
      if (!up.ok && up.status !== 206) return json(res, 502, { error: `upstream ${up.status}` });
      return pipeResponse(up, req, res);
    }

    if (path === "/search") {
      const q = url.searchParams.get("q") || "";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 40);
      const value = await searchRaw(q, limit);
      return json(res, 200, value);
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(`[http] ${req.method} ${path} -> ${err.message}`);
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
  console.log(`[engine] listening on :${PORT}${TOKEN ? " (token required)" : ""}`);
});
