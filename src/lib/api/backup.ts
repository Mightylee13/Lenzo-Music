import "server-only";
import type { ResolvedAudio, Track } from "@/types";
import { probeAudioUrl } from "@/lib/api/probe";

/* ============================================================
   BACKUP ENGINE CLIENT (server-only)
   Talks to the standalone yt-dlp fallback backend (backend/
   folder, started with run.bat — port 8765) when the primary
   upstream API is down or switched off for testing.

   The backend returns full-track audio URLs directly (YouTube
   googlevideo / SoundCloud CDN), so playback starts fast and
   Range-safe seeking works without a converter hop.
   ============================================================ */

const BACKUP_BASE = (process.env.LENZO_BACKUP_URL ?? "http://127.0.0.1:8765").replace(/\/+$/, "");

/* ---------- availability (cached, with failure cooldown) ---------- */

let health: { ok: boolean; checkedAt: number } = { ok: false, checkedAt: 0 };
const HEALTH_TTL_OK = 60_000;
const HEALTH_TTL_FAIL = 15_000;

/** True when the backup backend is reachable. Cached to avoid hammering it. */
export async function backupAvailable(): Promise<boolean> {
  const ttl = health.ok ? HEALTH_TTL_OK : HEALTH_TTL_FAIL;
  if (Date.now() - health.checkedAt < ttl) return health.ok;
  try {
    const res = await fetch(`${BACKUP_BASE}/api/health`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    health = { ok: res.ok && body?.status === "ok", checkedAt: Date.now() };
  } catch {
    health = { ok: false, checkedAt: Date.now() };
  }
  return health.ok;
}

/* ---------- raw calls ---------- */

interface BackupTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  artwork?: string;
  source: "youtube" | "soundcloud";
  url?: string;
  view_count?: number;
  _score?: number;
}

async function backupJson<T>(path: string, timeoutMs = 30000): Promise<T> {
  const res = await fetch(`${BACKUP_BASE}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`backup ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/* ---------- search ---------- */

function toTrack(raw: BackupTrack): Track {
  const prefix = raw.source === "soundcloud" ? "bksc" : "bkyt";
  return {
    id: `${prefix}-${raw.id}`,
    title: raw.title,
    artist: raw.artist,
    album: raw.album || undefined,
    duration: raw.duration || 0,
    artwork: raw.artwork ?? "",
    source: raw.source === "soundcloud" ? "soundcloud" : "youtube",
    url: raw.url,
    plays: raw.view_count,
  };
}

/**
 * Search the backup engine. Results come relevance-ranked from the
 * backend (the same junk filtering as the primary search). When the
 * caller wants Spotify-ish metadata (album/EP/single, release dates)
 * we decorate with the backend's iTunes song lookup, best-effort.
 */
export async function backupSearchTracks(query: string, decorate = false): Promise<Track[]> {
  if (!(await backupAvailable())) throw new Error("Backup engine is not running (backend/run.bat, port 8765)");

  const raw = await backupJson<{ tracks: BackupTrack[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=20`);
  const tracks = (raw.tracks ?? []).map(toTrack);

  if (decorate && tracks.length) {
    try {
      const songs = await backupJson<{ songs: Array<{ title: string; artist: string; album?: string; releaseDate?: string }> }>(
        `/api/song?q=${encodeURIComponent(query)}&limit=10`,
        15000,
      );
      const byTitle = new Map(songs.songs?.map((s) => [s.title.toLowerCase(), s]) ?? []);
      for (const t of tracks) {
        const hit = byTitle.get(t.title.toLowerCase());
        if (!hit) continue;
        t.album = t.album || hit.album;
        t.releaseDate = hit.releaseDate;
      }
    } catch {
      /* decoration is best-effort */
    }
  }
  return tracks;
}

/* ---------- audio resolution ---------- */

function youtubeIdFromUrl(url: string): string | null {
  const v = /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(url);
  return v ? v[1] : null;
}

/**
 * Resolve a track into a full-track audio URL using the backup engine:
 *   YouTube link  → stream the video's best audio directly.
 *   Other link    → find the song on the backup engine by title+artist,
 *                   then stream the best-ranked hit.
 * Returns a probe-verified audioUrl (proxied when the host ignores Range).
 */
export async function backupResolve(track: Track): Promise<ResolvedAudio> {
  if (!(await backupAvailable())) throw new Error("Backup engine is not running (backend/run.bat, port 8765)");

  let stream: { stream_url: string; duration?: number; title?: string; artist?: string };
  let provider: ResolvedAudio["provider"] = "ytmp3";

  const ytId = track.url ? youtubeIdFromUrl(track.url) : null;
  if (track.source === "youtube" && ytId) {
    stream = await backupJson(`/api/stream/${ytId}?source=youtube`, 35000);
  } else {
    // Find the same song on the backup engine (works for spotify-v2 and
    // soundcloud tracks — the backend ranks and caches id→url itself).
    const query = `${track.title} ${track.artist.split(",")[0] ?? ""}`.trim();
    const results = await backupSearchTracks(query);
    if (!results.length) throw new Error(`Backup engine found nothing for "${query}"`);
    // Play the LISTED song, not a lookalike: scan the ranked hits and take
    // the first that is verifiably the same song (title covers the request,
    // no variant/re-upload markers the request did not carry).
    const want = track.title.toLowerCase();
    const wantTokens = want.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    const sameSong = (title: string): boolean => {
      const s = title.toLowerCase();
      if (!s) return false;
      if (wantTokens.length && wantTokens.filter((t) => s.includes(t)).length / wantTokens.length < 0.6) {
        return false;
      }
      if (/(performance|remix|sped\s*up|slowed|nightcore|lyric\s*video|cover|karaoke)/.test(s)) {
        const asked = /(remix|sped\s*up|slowed|nightcore|cover)/.test(want);
        if (!asked) return false;
      }
      return true;
    };
    const hit = results.find((r) => sameSong(r.title));
    if (!hit) throw new Error(`Backup engine only found re-uploads/variants of "${query}"`);
    const id = hit.id.replace(/^bk(sc|yt)-/, "");
    const source = hit.source === "soundcloud" ? "soundcloud" : "youtube";
    if (source === "soundcloud") provider = "soundcloud";
    const urlParam = hit.url ? `&url=${encodeURIComponent(hit.url)}` : "";
    stream = await backupJson(`/api/stream/${id}?source=${source}${urlParam}`, 35000);
  }

  if (!stream.stream_url) throw new Error("Backup engine returned no stream URL");
  const probe = await probeAudioUrl(stream.stream_url, 8000);
  if (!probe.ok) throw new Error("Backup audio CDN is not responding");
  const audioUrl = probe.range ? stream.stream_url : `/api/music/stream?url=${encodeURIComponent(stream.stream_url)}`;

  return {
    audioUrl,
    duration: stream.duration ?? (track.duration || undefined),
    artwork: track.artwork,
    title: stream.title ?? track.title,
    artist: stream.artist ?? track.artist,
    quality: "Full track (backup engine)",
    provider,
  };
}
