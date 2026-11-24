import crypto from "node:crypto";
import type { Album, Artist, Track } from "@/types";
import { slug } from "@/lib/api/normalizers";

/* ============================================================
   SPOTIFY ENGINE — the app's primary music engine.

   Anonymous web-player session (TOTP, same as open.spotify.com
   uses before login) powers catalogue search: tracks with real
   album names, release YEARS and release TYPES (album/EP/single),
   plus real artist cards — none of which the mirror API provides.

   Full-length playback is resolved through YouTube's own player
   API with a strict identity judge (title-token coverage is
   mandatory, remix/sped-up/cover variants rejected), so the audio
   that reaches the player is the song that was listed.

   ALL fixes verified live during the race tests:
   - every fetch carries an AbortSignal timeout,
   - the search persisted-query hash auto-discovers from the web
     player bundle when the persisted fallback hashes stop working,
   - YouTube search filter param single-encoded,
   - no spclient/Widevine dead path (anonymous sessions get no
     file entries — verified),
   - no fabricated zeros for followers/listeners.

   THE IP RULE (critical): googlevideo stream URLs are locked to
   the IP that requested them. A url fetched by this module can
   ONLY be piped by THIS instance/engineYtAudio(). That is why
   resolution hands off a `videoId`, never a googlevideo URL, and
   /api/music/stream?yt=<videoId> resolves INSIDE the streaming
   route (same function instance → same egress IP → always 206).
   ============================================================ */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0";
const SECRET = "376136387538459893883312310911992847112448894410210511297108";
const TOTP_VERSION = 61;
const APP_VERSION = "1.2.92.50.g97692e81";
const FALLBACK_HASHES = [
  "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0",
  "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
];

const BASE = { referer: "https://open.spotify.com/", origin: "https://open.spotify.com", "user-agent": UA, "accept-language": "en" };

/* ---------- module state anchored on globalThis (dev reloads and
   multi-bundle servers share one session/cache — mirrors
   server/trackRegistry.ts) ---------- */

interface EngineState {
  session: { token: string; clientToken: string; expires: number };
  discoveredHash: string | null;
  /** search query → results (found) or "miss" (negative cache) */
  searchCache: Map<string, { ts: number; ok: boolean; value: EngineSearchResult; error?: string }>;
  /** canonical-track resolve cache: spotify id → yt pick */
  resolveCache: Map<string, { ts: number; ok: boolean; value: EngineYtPick | null }>;
  /** videoId → googlevideo url (SAME-INSTANCE ONLY — never cross IP) */
  streamCache: Map<string, { ts: number; url: string; mimeType: string | null; contentLength: number | null; lengthSeconds: number | null }>;
  /**
   * Datacenter bot-block detection: Google's player API answers
   * LOGIN_REQUIRED ("Sign in to confirm you're not a bot") for every
   * client when the caller IP is a cloud/datacenter IP — verified live on
   * Vercel. The caller should then hand judged video ids to a converter
   * instead of burning time on the player. 0 = player believed fine.
   */
  playerBlockedUntil: number;
}

const STATE_KEY = "__lenzo_spotify_engine__" as const;

function state(): EngineState {
  const g = globalThis as unknown as Record<string, EngineState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = {
      session: { token: "", clientToken: "", expires: 0 },
      discoveredHash: null,
      searchCache: new Map(),
      resolveCache: new Map(),
      streamCache: new Map(),
      playerBlockedUntil: 0,
    };
    g[STATE_KEY] = s;
  }
  return s;
}

const SEARCH_TTL_OK = 5 * 60 * 1000;
const SEARCH_TTL_FAIL = 30 * 1000;
const RESOLVE_TTL_OK = 15 * 60 * 1000;
const RESOLVE_TTL_FAIL = 45 * 1000;
const STREAM_TTL = 25 * 60 * 1000; // googlevideo urls live ~6h; we refresh well before
const CACHE_MAX = 500;

function evictIfNeeded(map: Map<unknown, unknown>): void {
  if (map.size < CACHE_MAX) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

/* ---------- tiny helpers ---------- */

async function tf(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${String(url).slice(0, 80)}`);
  return res;
}

/* ---------- anonymous web-player session ---------- */

function totp(tsms: number): string {
  const counter = Math.floor(tsms / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", Buffer.from(SECRET, "utf8")).update(buf).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

async function getAuth(force = false): Promise<{ token: string; clientToken: string; expires: number }> {
  const s = state();
  if (!force && s.session.token && Date.now() < s.session.expires - 60000) return s.session;
  const now = Date.now();
  const params = new URLSearchParams({ reason: "init", productType: "web-player", totp: totp(now), totpServer: totp(now), totpVer: String(TOTP_VERSION) });
  const token = (await (await tf(`https://open.spotify.com/api/token?${params}`, { headers: BASE }, 10000)).json()) as {
    accessToken?: string;
    clientId?: string;
    accessTokenExpirationTimestampMs?: number;
  };
  if (!token?.accessToken) throw new Error("Spotify token request failed");
  const client = (await (
    await tf(
      "https://clienttoken.spotify.com/v1/clienttoken",
      {
        method: "POST",
        headers: { ...BASE, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_data: {
            client_version: APP_VERSION,
            client_id: token.clientId,
            js_sdk_data: { device_brand: "unknown", device_model: "unknown", os: "windows", os_version: "NT 10.0", device_id: crypto.randomUUID(), device_type: "computer" },
          },
        }),
      },
      10000,
    )
  ).json()) as { granted_token?: { token?: string } };
  if (!client?.granted_token?.token) throw new Error("Spotify client token failed");
  s.session = {
    token: token.accessToken,
    clientToken: client.granted_token.token,
    expires: token.accessTokenExpirationTimestampMs || Date.now() + 3000000,
  };
  return s.session;
}

async function discoverHash(): Promise<string | null> {
  const s = state();
  if (s.discoveredHash !== null) return s.discoveredHash || null;
  s.discoveredHash = "";
  try {
    const html = await (await tf("https://open.spotify.com/", { headers: { "user-agent": UA } }, 12000)).text();
    const mainUrl = (html.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[0-9a-f]+\.js/) || [])[0];
    if (!mainUrl) return null;
    const mainJs = await (await tf(mainUrl, { headers: { "user-agent": UA, referer: "https://open.spotify.com/" } }, 12000)).text();
    const candidates = [...new Set([...mainJs.matchAll(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/[\w.\-]*search[\w.\-]*\.js/g)].map((x) => x[0]))];
    for (const url of candidates) {
      const chunkJs = await (await tf(url, { headers: { "user-agent": UA, referer: "https://open.spotify.com/" } }, 12000)).text();
      const hash = (chunkJs.match(/"searchDesktop","query","([a-f0-9]{64})"/) || [])[1];
      if (hash) {
        s.discoveredHash = hash;
        break;
      }
    }
  } catch {
    s.discoveredHash = "";
  }
  return s.discoveredHash || null;
}

/* ---------- search payload parsing ---------- */

export interface EngineTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  explicit: boolean;
  thumb: string | null;
  url: string;
  /** Spotify release shape of the track's album when the payload carries it. */
  albumType: "album" | "single" | "ep" | null;
  /** Release year when the payload carries it. */
  year: number | null;
}

export interface EngineArtist {
  id: string;
  name: string;
  verified: boolean;
  image: string | null;
  url: string;
}

export interface EngineAlbum {
  id: string;
  name: string;
  type: "album" | "single" | "ep" | "compilation" | null;
  year: number | null;
  image: string | null;
  mainArtist: string;
  artistId: string;
  url: string;
}

export interface EngineSearchResult {
  tracks: EngineTrack[];
  artists: EngineArtist[];
  albums: EngineAlbum[];
}

type Unknown = Record<string, unknown>;

function asRecord(v: unknown): Unknown | undefined {
  return v && typeof v === "object" ? (v as Unknown) : undefined;
}

function firstUrlFromNode(node: unknown): string | null {
  const n = asRecord(node);
  if (!n) return null;
  const list = n.sources ?? n.source;
  if (!Array.isArray(list)) return null;
  const usable = list.filter((s): s is { url: string; width?: number } => {
    const r = asRecord(s);
    return typeof r?.url === "string";
  });
  if (!usable.length) return null;
  return usable.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a), usable[0]).url;
}

/**
 * The searchDesktop payload usually nests artists as
 * `{ items: [{ uri, profile: { name } }] }`, but some leaves provide a bare
 * array or `{ name }` directly — accept every observed shape.
 */
function artistNamesOf(node: unknown): string[] {
  const names: string[] = [];
  const push = (entry: unknown): void => {
    const r = asRecord(entry);
    const profile = asRecord(r?.profile);
    if (typeof profile?.name === "string") names.push(profile.name);
    else if (typeof r?.name === "string") names.push(r.name);
  };
  if (Array.isArray(node)) {
    // Either [{ profile:{name} }] or [{ items:[…] }]
    for (const entry of node) {
      const items = asRecord(entry)?.items;
      if (Array.isArray(items)) items.forEach(push);
      else push(entry);
    }
  } else if (node) {
    const items = asRecord(node)?.items;
    if (Array.isArray(items)) items.forEach(push);
  }
  return names.filter(Boolean);
}

function parseTrack(d: unknown): EngineTrack | null {
  const n = asRecord(d);
  if (!n || n.__typename === "NotFound") return null;
  const id = String(n.uri ?? "").split(":")[2] || null;
  const title = typeof n.name === "string" ? n.name : null;
  if (!id || !title) return null;
  const thumb = firstUrlFromNode(asRecord(n.albumOfTrack)?.coverArt);
  const artistNames = artistNamesOf(n.artists);
  const artist = artistNames.length ? artistNames.join(", ") : "Unknown artist";
  // albumOfTrack may carry real release info on some payloads.
  const albumRec = asRecord(n.albumOfTrack);
  const rawType = String(albumRec?.type ?? "").toLowerCase();
  const albumType = rawType === "album" || rawType === "single" || rawType === "ep" ? (rawType as EngineTrack["albumType"]) : null;
  const yearRaw = asRecord(albumRec?.date)?.year;
  return {
    id,
    title,
    artist,
    album: typeof albumRec?.name === "string" ? (albumRec.name as string) : null,
    durationMs: Number(asRecord(n.duration)?.totalMilliseconds ?? 0),
    explicit: asRecord(n.contentRating)?.label === "EXPLICIT",
    thumb,
    url: `https://open.spotify.com/track/${id}`,
    albumType,
    year: typeof yearRaw === "number" ? yearRaw : null,
  };
}

function parseArtist(d: unknown): EngineArtist | null {
  const n = asRecord(d);
  if (!n || n.__typename === "NotFound") return null;
  const id = String(n.uri ?? "").split(":")[2] || null;
  const name = asRecord(n.profile)?.name;
  if (!id || typeof name !== "string") return null;
  const image = firstUrlFromNode(asRecord(n.visuals)?.avatarImage) ?? firstUrlFromNode(asRecord(n.visualIdentity)?.squareCoverImage);
  return {
    id,
    name,
    verified: asRecord(asRecord(n.onPlatformReputationTrait)?.verification)?.isVerified === true,
    image,
    url: `https://open.spotify.com/artist/${id}`,
  };
}

function parseAlbum(d: unknown): EngineAlbum | null {
  const n = asRecord(d);
  if (!n || n.__typename === "NotFound") return null;
  const id = String(n.uri ?? "").split(":")[2] || null;
  const name = typeof n.name === "string" ? n.name : null;
  if (!id || !name) return null;
  const image = firstUrlFromNode(n.coverArt);
  const rawType = String(n.type ?? n.__typename ?? "").toLowerCase();
  const type: EngineAlbum["type"] =
    rawType === "album" || rawType === "single" || rawType === "ep" || rawType === "compilation" ? (rawType as EngineAlbum["type"]) : null;
  const artistNames = artistNamesOf(n.artists);
  const mainArtist = artistNames[0] ?? "Unknown artist";
  const yearRaw = asRecord(n.date)?.year;
  return {
    id,
    name,
    type,
    year: typeof yearRaw === "number" ? yearRaw : null,
    image,
    mainArtist,
    artistId: `ar_${slug(mainArtist)}`,
    url: `https://open.spotify.com/album/${id}`,
  };
}

/** Anonymous searchDesktop cannot search playlists (NotFound — verified live). */

/* ---------- search ---------- */

async function runSearchQuery(term: string, hash: string, limit: number, auth: { token: string; clientToken: string }): Promise<Response> {
  const variables = { searchTerm: term, offset: 0, limit, numberOfTopResults: 3, includeAudiobooks: false };
  const params = new URLSearchParams({
    operationName: "searchDesktop",
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
  });
  return fetch(`https://api-partner.spotify.com/pathfinder/v1/query?${params}`, {
    headers: { ...BASE, accept: "application/json", "app-platform": "WebPlayer", authorization: `Bearer ${auth.token}`, "client-token": auth.clientToken, "spotify-app-version": APP_VERSION },
    signal: AbortSignal.timeout(12000),
  });
}

function emptyResult(): EngineSearchResult {
  return { tracks: [], artists: [], albums: [] };
}

export interface EngineSearchOutcome extends EngineSearchResult {
  ok: boolean;
}

/**
 * Search the live anonymous web-player catalogue. Throws when the engine
 * itself is down (callers fall back to the mirror API); returns .ok=false
 * (empty lists) when the engine answered but the catalogue has nothing.
 */
export async function engineSearchRaw(query: string, limit = 24): Promise<EngineSearchOutcome> {
  const term = query.trim();
  if (!term) return { ...emptyResult(), ok: true };
  const s = state();
  const key = `${term.toLowerCase()}::${limit}`;
  const hit = s.searchCache.get(key);
  if (hit) {
    if (Date.now() - hit.ts < (hit.ok ? SEARCH_TTL_OK : SEARCH_TTL_FAIL)) {
      // A cached engine outage re-throws so the caller falls back without
      // hammering the (down) engine on every request.
      if (!hit.ok) throw new Error(hit.error ?? "engine search failed");
      return { ...hit.value, ok: true };
    }
    s.searchCache.delete(key);
  }
  try {
    let auth = await getAuth(false);
    const tryHashes = async (hashes: string[]): Promise<unknown | null> => {
      for (const hash of hashes) {
        if (!hash) continue;
        let res = await runSearchQuery(term, hash, limit, auth);
        if (res.status === 401) {
          auth = await getAuth(true);
          res = await runSearchQuery(term, hash, limit, auth);
        }
        const json = (await res.json().catch(() => null)) as Unknown | null;
        const v2 = asRecord(asRecord(json)?.data)?.searchV2;
        if (v2) return v2;
      }
      return null;
    };
    const primary = s.discoveredHash ? [s.discoveredHash, ...FALLBACK_HASHES] : [...FALLBACK_HASHES];
    let data = (await tryHashes(primary)) as Unknown | null;
    if (!data) {
      const fresh = await discoverHash();
      if (fresh && !primary.includes(fresh)) data = (await tryHashes([fresh])) as Unknown | null;
    }
    if (!data) throw new Error("Spotify search returned no data");

    const itemsOf = (node: unknown): Unknown[] => {
      const items = asRecord(node)?.items;
      return Array.isArray(items) ? (items as Unknown[]) : [];
    };
    const value: EngineSearchResult = {
      tracks: itemsOf(data.tracksV2)
        .map((i) => parseTrack(asRecord(asRecord(i)?.item)?.data))
        .filter((t): t is EngineTrack => t !== null)
        .slice(0, limit),
      artists: itemsOf(data.artists)
        .map((i) => parseArtist(asRecord(i)?.data))
        .filter((a): a is EngineArtist => a !== null)
        .slice(0, limit),
      albums: itemsOf(data.albumsV2)
        .map((i) => parseAlbum(asRecord(i)?.data))
        .filter((a): a is EngineAlbum => a !== null)
        .slice(0, limit),
    };
    evictIfNeeded(s.searchCache);
    s.searchCache.set(key, { ts: Date.now(), ok: true, value });
    return { ...value, ok: true };
  } catch (err) {
    // Negative cache so a down engine does not trigger hammering.
    evictIfNeeded(s.searchCache);
    s.searchCache.set(key, { ts: Date.now(), ok: false, value: emptyResult(), error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/* ---------- app-model mapping (ids match the normalizer schemes so the
   artist/album detail routes resolve engine results without changes) ---------- */

export function engineTrackToTrack(t: EngineTrack): Track {
  return {
    id: `tr_sp_${t.id}`,
    title: t.title,
    artist: t.artist,
    artistId: `ar_${slug(t.artist.split(",")[0])}`,
    album: t.album ?? undefined,
    albumId: t.album ? `al_${slug(`${t.album}-${t.artist.split(",")[0]}`)}` : undefined,
    duration: Math.round(t.durationMs / 1000),
    artwork: t.thumb ?? "",
    source: "spotify",
    url: t.url,
    providerId: t.id,
    explicit: t.explicit || undefined,
    albumType: t.albumType ?? undefined,
    releaseDate: t.year ? `${t.year}` : undefined,
  };
}

const ALBUM_TYPE_OF: Record<string, Album["type"]> = { album: "album", single: "single", ep: "ep", compilation: "compilation" };

export function engineAlbumToAlbum(a: EngineAlbum): Album {
  return {
    // Same id scheme as albumsFromTracks so the album detail route and
    // likes/library logic treat engine albums exactly like grouped ones.
    id: `al_${slug(`${a.name}-${a.mainArtist}`)}`,
    title: a.name,
    artist: a.mainArtist,
    artistId: a.artistId,
    artwork: a.image ?? "",
    year: a.year ?? undefined,
    type: (a.type && ALBUM_TYPE_OF[a.type]) || "album",
    trackCount: 0,
    duration: 0,
    source: "spotify",
    url: a.url,
    tracks: [],
  };
}

export function engineArtistToArtist(a: EngineArtist): Artist {
  return {
    id: `ar_${slug(a.name)}`,
    name: a.name,
    image: a.image ?? "",
    source: "spotify",
    verified: a.verified || undefined,
    url: a.url,
  };
}

/* ---------- YouTube: multi-client player + identity judge ---------- */

function pickAudio(formats: unknown): { url: string; bitrate: number | null; mimeType: string | null; contentLength: number | null } | null {
  if (!Array.isArray(formats)) return null;
  const audio = (formats as Unknown[]).filter(
    (f) => typeof f?.url === "string" && String(asRecord(f)?.mimeType ?? "").startsWith("audio/"),
  );
  if (!audio.length) return null;
  // Prefer AAC (audio/mp4) over Opus (audio/webm) — every phone plays it,
  // including older iOS Safari builds where WebM container support is shaky;
  // within the same container, highest bitrate wins.
  audio.sort((a, b) => {
    const aMp4 = String(asRecord(a)?.mimeType ?? "").startsWith("audio/mp4") ? 1 : 0;
    const bMp4 = String(asRecord(b)?.mimeType ?? "").startsWith("audio/mp4") ? 1 : 0;
    if (aMp4 !== bMp4) return bMp4 - aMp4;
    return (Number(asRecord(b)?.bitrate ?? 0) || 0) - (Number(asRecord(a)?.bitrate ?? 0) || 0);
  });
  const best = audio[0];
  return {
    url: best.url as string,
    bitrate: Number(best.bitrate) || null,
    mimeType: (best.mimeType as string) ?? null,
    contentLength: Number(best.contentLength) || null,
  };
}

const YT_CLIENTS: Array<{ clientName: string; clientVersion: string; ua?: string }> = [
  { clientName: "ANDROID", clientVersion: "20.10.38" },
  { clientName: "ANDROID_MUSIC", clientVersion: "7.27.52" },
  { clientName: "IOS", clientVersion: "20.10.4" },
  { clientName: "TVHTML5", clientVersion: "7.20250312.16.00" },
];

interface YtAudio {
  url: string;
  bitrate: number | null;
  mimeType: string | null;
  contentLength: number | null;
  client: string;
  lengthSeconds: number | null;
}

/** How long a detected datacenter bot-block stops playback attempts. */
const PLAYER_BLOCK_TTL = 30 * 60 * 1000;

/** True when Google's player API bot-blocks this IP (e.g. on Vercel). */
export function enginePlayerBlocked(): boolean {
  return state().playerBlockedUntil > Date.now();
}

function markPlayerBlocked(): void {
  state().playerBlockedUntil = Date.now() + PLAYER_BLOCK_TTL;
  console.log("[engine] youtube player bot-blocked on this IP — playback attempts disabled for 30min");
}

/**
 * Resolve a videoId into a DIRECT googlevideo audio URL.
 * Same-instance only — see the IP rule at the top of this file.
 */
export async function engineYtAudio(videoId: string, force = false): Promise<{ url: string; mimeType: string | null; contentLength: number | null; lengthSeconds: number | null } | null> {
  if (!/^[A-Za-z0-9_-]{8,16}$/.test(videoId)) return null;
  const s = state();
  // A freshly detected bot-block short-circuits every further player call
  // on this instance — proof loops must not re-run all 4 blocked clients
  // per candidate.
  if (!force && s.playerBlockedUntil > Date.now()) return null;
  const hit = s.streamCache.get(videoId);
  if (hit && !force && Date.now() - hit.ts < STREAM_TTL) {
    return { url: hit.url, mimeType: hit.mimeType, contentLength: hit.contentLength, lengthSeconds: hit.lengthSeconds };
  }
  let last: YtAudio | null = null;
  let botBlocked = false;
  for (const client of YT_CLIENTS) {
    try {
      const pRes = await tf(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": UA },
          body: JSON.stringify({
            context: { client: { ...client, hl: "en", gl: "US" } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
        8000,
      );
      const pJson = (await pRes.json()) as Unknown;
      const status = String(asRecord(pJson?.playabilityStatus)?.status);
      if (status === "LOGIN_REQUIRED") {
        // One LOGIN_REQUIRED is enough — the block is IP-wide (verified
        // live: all clients answer identically on datacenter IPs), so
        // don't burn 4×2.5s probing the other clients.
        botBlocked = true;
        break;
      }
      const streaming = asRecord(pJson?.streamingData);
      const picked = pickAudio([...(Array.isArray(streaming?.adaptiveFormats) ? streaming.adaptiveFormats : []), ...(Array.isArray(streaming?.formats) ? streaming.formats : [])]);
      if (picked) {
        s.playerBlockedUntil = 0;
        last = { ...picked, client: client.clientName, lengthSeconds: Number(asRecord(pJson?.videoDetails)?.lengthSeconds) || null };
        break;
      }
    } catch {
      /* next client */
    }
  }
  if (!last?.url) {
    if (botBlocked) markPlayerBlocked();
    if (hit) s.streamCache.delete(videoId); // stale cached url stopped working
    return null;
  }
  evictIfNeeded(s.streamCache);
  s.streamCache.set(videoId, { ts: Date.now(), url: last.url, mimeType: last.mimeType, contentLength: last.contentLength, lengthSeconds: last.lengthSeconds });
  return { url: last.url, mimeType: last.mimeType, contentLength: last.contentLength, lengthSeconds: last.lengthSeconds };
}

export interface EngineYtPick {
  videoId: string;
  youtubeTitle: string;
  watchUrl: string;
  durationSec: number | null;
  bitrate: number | null;
  client: string;
}

function scoreCandidate(hit: { titleTxt: string; channel: string; idx: number }, want: { title: string; artist: string }): number {
  const t = slug(hit.titleTxt);
  const channel = slug(hit.channel || "");
  const wantTitle = slug(want.title);
  const wantFirstArtist = slug((want.artist || "").split(",")[0]);
  const titleTokens = wantTitle.split("-").filter((x) => x.length > 2);
  if (!t) return -99;

  // Title coverage is MANDATORY — an artist-name match alone once let
  // "asake lifestyle" pick "Asake - Great Guy" (verified live).
  if (titleTokens.length) {
    const coverage = titleTokens.filter((tk) => t.includes(tk)).length / titleTokens.length;
    if (coverage < 0.5) return -99;
  } else if (!channel.includes(wantFirstArtist)) {
    return -99;
  }

  let score = 0;
  if (titleTokens.length) {
    score += (titleTokens.filter((tk) => t.includes(tk)).length / titleTokens.length) * 1.0;
  }
  if (wantFirstArtist && (channel.includes(wantFirstArtist) || t.includes(wantFirstArtist))) score += 0.5;
  const JUNK = ["interview", "reaction", "instrumental", "karaoke", "type beat", "full album", "megamix", "performance", "cover", "1 hour", "mix", "visualizer", "snippet"];
  if (JUNK.some((w) => t.includes(w))) score -= 0.6;
  const VARIANT = ["remix", "sped up", "slowed", "nightcore", "8d audio", "live"];
  const variantHit = VARIANT.find((w) => t.includes(w));
  if (variantHit && !wantTitle.includes(variantHit)) score -= 0.5;
  score -= hit.idx * 0.05;
  return score;
}

/**
 * Full-length playback pick for a wanted song: search YouTube (music-biased
 * query), judge every candidate for identity, then — when `prove` — resolve
 * the best one on the spot (turning the pick into a REAL playability check;
 * a candidate with no clear audio is skipped, not returned). With prove off
 * (converter-hand-off mode, e.g. when this IP is bot-blocked) the judge is
 * the gatekeeper and the converter's own probe checks playability.
 */
async function engineYtPick(want: { title: string; artist: string }, opts: { prove?: boolean } = {}): Promise<{ kind: "ok"; pick: EngineYtPick } | { kind: "unprovable" } | null> {
  const prove = opts.prove !== false;
  if (!want.title) return null;
  const q = [want.title, want.artist, "official audio"].filter(Boolean).join(" ");
  try {
    const sRes = await tf(
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": UA },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion: "2.20241126.01.00", hl: "en", gl: "US" } },
          query: q,
          params: "EgIQAQ==", // filter: video
        }),
      },
      12000,
    );
    const sJson = (await sRes.json()) as Unknown;
    const primaryContents = asRecord(asRecord(asRecord(sJson)?.contents)?.twoColumnSearchResultsRenderer)?.primaryContents;
    const sections = asRecord(asRecord(primaryContents)?.sectionListRenderer)?.contents;
    const flat: Unknown[] = Array.isArray(sections)
      ? sections.flatMap((c) => {
          const inner = asRecord(asRecord(c)?.itemSectionRenderer)?.contents;
          return Array.isArray(inner) ? (inner as Unknown[]) : [];
        })
      : [];

    const runsText = (node: unknown): string => {
      const runs = asRecord(node)?.runs;
      return Array.isArray(runs) ? runs.map((r) => String(asRecord(r)?.text ?? "")).join("") : "";
    };

    const candidates = flat
      .map((i) => asRecord(i)?.videoRenderer)
      .filter((v): v is Unknown => v !== undefined && typeof (v as Unknown).videoId === "string")
      .slice(0, 5)
      .map((v, idx) => ({
        idx,
        videoId: v.videoId as string,
        titleTxt: runsText(v.title) || (typeof v.title === "string" ? (v.title as string) : ""),
        channel: runsText(v.ownerText) || runsText(v.longBylineText),
      }));

    candidates.sort((a, b) => scoreCandidate(b, want) - scoreCandidate(a, want));
    const judged = candidates.map((c) => ({ c, score: scoreCandidate(c, want) }));
    for (const { c: video, score } of judged) {
      if (score < 0.4) break; // nothing looks like the song
      if (!prove) {
        // Judged but unproven — the caller (converter hand-off) verifies
        // actual playability itself.
        return {
          kind: "ok",
          pick: {
            videoId: video.videoId,
            youtubeTitle: video.titleTxt,
            watchUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
            durationSec: null,
            bitrate: null,
            client: "engine",
          },
        };
      }
      const audio = await engineYtAudio(video.videoId);
      if (audio?.url) {
        return {
          kind: "ok",
          pick: {
            videoId: video.videoId,
            youtubeTitle: video.titleTxt,
            watchUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
            durationSec: audio.lengthSeconds,
            bitrate: null,
            client: "engine",
          },
        };
      }
    }
    // Judge PASSED on at least one candidate but none proved playable —
    // this is NOT "no match" and must not poison the negative cache.
    return judged.length > 0 && Math.max(...judged.map((j) => j.score)) >= 0.4 ? { kind: "unprovable" } : null;
  } catch {
    return null;
  }
}

/* ---------- full resolution for a track ---------- */

export interface EngineResolution {
  videoId: string;
  youtubeTitle: string;
  watchUrl: string;
  durationSec: number | null;
}

/**
 * The playback path's engine attempt: canonicalise the song against the
 * Spotify catalogue (fixes noisy SoundCloud titles), then pick + prove a
 * full-length YouTube source. Cached per canonical query — unless forced
 * (a stale pick is being retried after its audio failed mid-stream).
 */
export async function engineResolve(want: { title: string; artist: string }, force = false, opts: { prove?: boolean } = {}): Promise<EngineResolution | null> {
  const title = want.title.trim();
  const artist = want.artist.trim();
  if (!title) return null;
  const prove = opts.prove !== false;
  const s = state();
  const key = `r:${slug(title)}::${slug(artist.split(",")[0])}`;
  const hit = force ? undefined : s.resolveCache.get(key);
  if (hit && Date.now() - hit.ts < (hit.ok ? RESOLVE_TTL_OK : RESOLVE_TTL_FAIL)) return hit.value ? { ...hit.value } : null;

  const pick = async (): Promise<{ kind: "ok"; pick: EngineYtPick } | { kind: "unprovable" } | null> => {
    // 1. Canonical title/artist from the catalogue — but ONLY when the
    // catalogue's title actually resembles what was asked. Spotify's own
    // ranking can surface a DIFFERENT song first for a query ("lifestyle
    // asake" once ranked "Great Guy" on top — verified live); trusting it
    // blindly made the judge score the wrong song and waste the window.
    let canonical: EngineTrack | null = null;
    try {
      const search = await engineSearchRaw(`${title} ${artist}`.trim(), 5);
      const wantTokens = slug(title).split("-").filter((t) => t.length > 2);
      canonical =
        search.tracks.find((t) => {
          const ts = slug(t.title);
          if (!ts) return false;
          const covered = wantTokens.length
            ? wantTokens.filter((w) => ts.includes(w)).length / wantTokens.length
            : ts.includes(slug(title))
              ? 1
              : 0;
          return covered >= 0.5;
        }) ?? null;
      if (canonical) {
        const p = await engineYtPick({ title: canonical.title, artist: canonical.artist }, { prove });
        if (p?.kind === "ok") return p;
        if (p?.kind === "unprovable") return p;
      }
    } catch {
      /* catalogue down — try the raw title below */
    }
    // 2. Raw title/artist with the judge as the gatekeeper.
    return await engineYtPick({ title, artist }, { prove });
  };

  try {
    const best = await pick();
    if (best?.kind === "ok") {
      evictIfNeeded(s.resolveCache);
      s.resolveCache.set(key, { ts: Date.now(), ok: true, value: best.pick });
      return { videoId: best.pick.videoId, youtubeTitle: best.pick.youtubeTitle, watchUrl: best.pick.watchUrl, durationSec: best.pick.durationSec };
    }
    if (best?.kind === "unprovable") {
      // The judge found the right video (proof failed: bot-block, region or
      // dead candidate). NO negative cache — the judged hand-off must be
      // able to run right after this.
      return null;
    }
    // Genuine "no match" — negative cache so repeat queries fail fast.
    evictIfNeeded(s.resolveCache);
    s.resolveCache.set(key, { ts: Date.now(), ok: false, value: null });
    return null;
  } catch (err) {
    evictIfNeeded(s.resolveCache);
    s.resolveCache.set(key, { ts: Date.now(), ok: false, value: null });
    throw err;
  }
}
