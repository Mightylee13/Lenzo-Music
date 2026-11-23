import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ApiConfig, ApiStatus, PublicApiConfig } from "@/types";

/* ============================================================
   API CONFIGURATION (server-only)
   ------------------------------------------------------------
  Your customization centre values live here as DEFAULTS. They
   can be overridden at runtime by the admin API screen, which
   persists to .data/config.json, or by environment variables
   (recommended for the secret key in production).

   The API key NEVER leaves this module:
     - it is not exported to client components
     - it is not returned by any public endpoint
     - it is not written to logs
   ============================================================ */

/** SECTION 00 → [01 — API CONFIGURATION] defaults. */
export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: "https://api.theresav.eu",
  apiKey: "Lenzorah",
  authHeader: "x-apikey",
  authPrefix: "",
  docsUrl: "https://api.theresav.eu/docs",
  timeoutMs: 20000,
  endpoints: [
    { key: "search.soundcloud", path: "/api/search/soundcloud", method: "GET", description: "SoundCloud catalogue search (primary search source)" },
    { key: "search.spotify", path: "/api/search/spotify", method: "GET", description: "Spotify catalogue search (rich metadata + 30s previews)" },
    { key: "search.youtube", path: "/api/search/youtube", method: "GET", description: "YouTube search (used to locate streamable audio)" },
    { key: "download.soundcloud", path: "/api/download/soundcloud", method: "GET", description: "Resolve a SoundCloud track to a direct MP3" },
    { key: "download.spotify", path: "/api/download/spotify", method: "GET", description: "Resolve a Spotify track to a direct MP3" },
    { key: "download.spotifyV2", path: "/api/download/spotify/v2", method: "GET", description: "Resolve a Spotify track to a direct MP3 (v2, preferred)" },
    { key: "download.ytmp3", path: "/api/download/ytmp3", method: "GET", description: "Resolve a YouTube video to MP3 + plain-text lyrics" },
    { key: "download.applemusic", path: "/api/download/applemusic", method: "GET", description: "Resolve an Apple Music track to a direct MP3" },
  ],
  responseMappings: {
    "search.soundcloud": "result[]: Track {title, artist, thumbnail, url}",
    "search.spotify": "result[]: Track {name, artists, album, duration, cover, previewUrl, spotifyUrl}",
    "search.youtube": "data[]: Track {title, channel, duration, thumbnail, url, videoId}",
    "download.soundcloud": "result: ResolvedAudio {download_url, thumbnail, title, artist, duration}",
    "download.spotifyV2": "result.downloads.mp3: ResolvedAudio.audioUrl",
    "download.ytmp3": "download_url: ResolvedAudio.audioUrl",
    "download.applemusic": "result.download.url: ResolvedAudio.audioUrl",
  },
  requestHeaders: {},
};

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

/* ---------- Primary-API kill switch (test / failover) ---------- */
/** Flag file: when present, every upstream call fails instantly and the
 *  app runs entirely on the backup engine. Create/remove to switch —
 *  takes effect on the next request, no server restart needed. */
const PRIMARY_OFF_FILE = path.join(DATA_DIR, "primary-off");

export function isPrimaryDisabled(): boolean {
  try {
    return fs.existsSync(PRIMARY_OFF_FILE);
  } catch {
    return false;
  }
}

export function setPrimaryDisabled(off: boolean): void {
  try {
    if (off) {
      ensureDir();
      fs.writeFileSync(PRIMARY_OFF_FILE, new Date().toISOString(), "utf8");
    } else if (fs.existsSync(PRIMARY_OFF_FILE)) {
      fs.unlinkSync(PRIMARY_OFF_FILE);
    }
  } catch {
    /* flag is best-effort */
  }
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const current = out[k];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[k] = deepMerge(current, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Effective config: defaults → .data/config.json → environment variables.
 * Environment wins so production secrets never need to touch disk.
 */
export function getApiConfig(): ApiConfig {
  let stored: Partial<ApiConfig> = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      stored = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<ApiConfig>;
    }
  } catch {
    stored = {};
  }

  const merged = deepMerge(DEFAULT_API_CONFIG, stored);

  const envBase = process.env.MUSIC_API_BASE_URL;
  const envKey = process.env.MUSIC_API_KEY;
  const envHeader = process.env.MUSIC_API_AUTH_HEADER;
  const envDocs = process.env.MUSIC_API_DOCS_URL;
  const envTimeout = process.env.MUSIC_API_TIMEOUT_MS;

  if (envBase) merged.baseUrl = envBase.replace(/\/+$/, "");
  if (envKey) merged.apiKey = envKey;
  if (envHeader) merged.authHeader = envHeader;
  if (envDocs) merged.docsUrl = envDocs;
  if (envTimeout) merged.timeoutMs = Number(envTimeout) || merged.timeoutMs;

  return merged;
}

export function saveApiConfig(patch: Partial<ApiConfig>): ApiConfig {
  ensureDir();
  const next = deepMerge(getApiConfig(), patch);
  // Persist everything except values supplied by the environment — those are
  // re-applied on read and must not be duplicated onto disk.
  const toDisk: Partial<ApiConfig> = { ...next };
  if (process.env.MUSIC_API_KEY) delete toDisk.apiKey;
  if (process.env.MUSIC_API_BASE_URL) delete toDisk.baseUrl;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toDisk, null, 2), "utf8");
  return next;
}

export function resetApiConfig(): ApiConfig {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  return getApiConfig();
}

/** Safe-to-expose projection used by the admin + settings screens. */
export function getPublicApiConfig(status?: ApiStatus): PublicApiConfig {
  const { apiKey, ...rest } = getApiConfig();
  return {
    ...rest,
    apiKey: undefined as unknown as never,
    hasKey: Boolean(apiKey),
    status: status ?? { ok: false, message: "Not tested yet" },
  } as PublicApiConfig;
}

export function endpointPath(key: string): string {
  const found = getApiConfig().endpoints.find((e) => e.key === key);
  if (!found) throw new Error(`Unknown endpoint mapping: ${key}`);
  return found.path;
}
