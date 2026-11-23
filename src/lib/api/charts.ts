import "server-only";
import { generateArtwork } from "@/lib/artwork";
import type { Playlist, Track } from "@/types";

/* ============================================================
   CHART PLAYLISTS (server-only)
   ------------------------------------------------------------
   Real editorial chart playlists in the Spotify sense —
   "Top 100 Nigeria", "Top 50 Global", genre charts — built
   from public chart sources, no user credentials:

     Apple Music RSS charts (official, per country, up to 200)
     Deezer editorial playlists (genre charts via search)

   Chart tracks carry no provider audio link, so playback goes
   through resolveTrack's Spotify-match → YouTube-match → backup
   chain, each gated by the identity check: what plays is
   exactly the song listed.

   Playlists are cached ~6 h (charts move daily); failures are
   retried after 5 minutes. Ids: `chart-<key>`.
   ============================================================ */

const FRESH_TTL = 6 * 60 * 60 * 1000;
const EMPTY_TTL = 60 * 1000;

interface CacheEntry {
  at: number;
  playlist: Playlist | null;
}

const chartCache = new Map<string, CacheEntry>();
const chartInflight = new Map<string, Promise<Playlist | null>>();

async function fetchJson<T>(url: string, timeoutMs = 20000, retries = 1): Promise<T> {
  // Bare fetch — Deezer's API returns 200-with-error-body for exotic
  // header sets, so keep the request exactly as plain as possible.
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Chart source returned ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Chart source failed");
}

function makeChartPlaylist(
  id: string,
  name: string,
  description: string,
  tracks: Track[],
  owner: string
): Playlist {
  const now = Date.now();
  return {
    id,
    name,
    description,
    artwork: tracks[0]?.artwork ?? generateArtwork(id, name),
    owner,
    public: true,
    collaborative: false,
    tracks,
    createdAt: now,
    updatedAt: now,
    followers: 0,
  };
}

/* ---------- Apple Music RSS charts ---------- */

interface AppleRssResponse {
  feed?: {
    title?: string;
    results?: Array<{
      id?: string;
      name?: string;
      artistName?: string;
      albumName?: string;
      artworkUrl100?: string;
      url?: string;
      releaseDate?: string;
    }>;
  };
}

/** `chart-apple-<storefront>` — the official "Most Played" chart for a country. */
async function appleChartPlaylist(storefront: string, limit: number): Promise<Playlist | null> {
  const id = `chart-apple-${storefront}`;
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const body = await fetchJson<AppleRssResponse>(url);
  const rows = body.feed?.results ?? [];

  const tracks: Track[] = [];
  for (const row of rows) {
    if (!row.name || !row.artistName || !row.id) continue;
    tracks.push({
      id: `tr_chart_apple_${row.id}`,
      title: row.name,
      artist: row.artistName,
      album: row.albumName || undefined,
      duration: 0,
      artwork: (row.artworkUrl100 ?? "").replace("/100x100bb.jpg", "/600x600bb.jpg"),
      source: "applemusic",
      url: row.url,
    });
  }
  if (!tracks.length) return null;

  const COUNTRY_A: Record<string, string> = {
    ng: "Nigeria",
    us: "United States",
    gb: "United Kingdom",
    za: "South Africa",
    gh: "Ghana",
    ke: "Kenya",
    ca: "Canada",
    de: "Germany",
    fr: "France",
  };
  const country = COUNTRY_A[storefront] ?? storefront.toUpperCase();
  return makeChartPlaylist(
    id,
    `Top ${tracks.length} ${country}`,
    `The most played songs in ${country} right now — official Apple Music chart.`,
    tracks,
    "Apple Music"
  );
}

/* ---------- Deezer editorial playlists ---------- */

interface DeezerPlaylistHit {
  id?: number;
  title?: string;
  picture_medium?: string;
  picture_xl?: string;
  nb_tracks?: number;
  fans?: number;
  user?: { name?: string };
}

interface DeezerPlaylistFull {
  title?: string;
  description?: string;
  picture_xl?: string;
  fans?: number;
  user?: { name?: string };
  tracks?: {
    data?: Array<{
      id?: number;
      title?: string;
      duration?: number;
      artist?: { name?: string };
      album?: { title?: string; cover_medium?: string; cover_xl?: string };
    }>;
  };
}

/** `id` must be passed explicitly — it is the shelf's stable key, never derived
 *  from the query (which can differ from the display title). */
async function deezerChartPlaylist(id: string, query: string, displayTitle: string, maxTracks: number): Promise<Playlist | null> {
  const search = await fetchJson<{ data?: DeezerPlaylistHit[] }>(
    `https://api.deezer.com/search/playlist?q=${encodeURIComponent(query)}&limit=10`
  );
  const hits = (search.data ?? [])
    .filter((h) => h.id && (h.nb_tracks ?? 0) >= 10)
    .sort((a, b) => (b.fans ?? 0) - (a.fans ?? 0) || (b.nb_tracks ?? 0) - (a.nb_tracks ?? 0));
  const winner = hits[0];
  if (!winner?.id) return null;

  const full = await fetchJson<DeezerPlaylistFull>(`https://api.deezer.com/playlist/${winner.id}?limit=100`);
  const rows = full.tracks?.data ?? [];

  const tracks: Track[] = [];
  for (const row of rows) {
    if (!row.title || !row.artist?.name || !row.id) continue;
    tracks.push({
      id: `tr_chart_dz_${row.id}`,
      title: row.title,
      artist: row.artist.name,
      album: row.album?.title || undefined,
      duration: row.duration && row.duration > 0 ? Math.round(row.duration) : 0,
      artwork: row.album?.cover_xl || row.album?.cover_medium || "",
      source: "deezer",
      url: undefined,
    });
    if (tracks.length >= maxTracks) break;
  }
  if (!tracks.length) return null;

  return makeChartPlaylist(
    id,
    displayTitle,
    `${winner.title ?? displayTitle} — Deezer editorial picks, ${tracks.length} hit${tracks.length === 1 ? "" : "s"}.`,
    tracks,
    full.user?.name || "Deezer"
  );
}

/* ---------- public API ---------- */

/** Build (or fetch from cache) a chart playlist by its `chart-*` id. */
export async function chartPlaylistById(id: string): Promise<Playlist | null> {
  const hit = chartCache.get(id);
  if (hit && Date.now() - hit.at <= (hit.playlist ? FRESH_TTL : EMPTY_TTL)) return hit.playlist;

  const running = chartInflight.get(id);
  if (running) return running;

  const build = async (): Promise<Playlist | null> => {
    if (id.startsWith("chart-apple-")) {
      const storefront = id.slice("chart-apple-".length);
      const limit = storefront === "ng" ? 100 : 50;
      return appleChartPlaylist(storefront, limit).catch(() => null);
    }
    if (id.startsWith("chart-dz-")) {
      const slug = id.slice("chart-dz-".length);
      if (slug === "amapiano") {
        return deezerChartPlaylist(id, "Amapiano Hits", "Top Amapiano", 50).catch(() => null);
      }
      const title = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      return deezerChartPlaylist(id, slug.replace(/-/g, " "), `Top ${title}`, 50).catch(() => null);
    }
    return null;
  };

  const job = build()
    .then((playlist) => {
      chartCache.set(id, { at: Date.now(), playlist });
      return playlist;
    })
    .finally(() => {
      chartInflight.delete(id);
    });
  chartInflight.set(id, job);
  return job;
}

/** The default chart shelf shown on the homepage, in display order. */
export async function defaultChartPlaylists(): Promise<Playlist[]> {
  const results = await Promise.allSettled([
    chartPlaylistById("chart-apple-ng"),
    chartPlaylistById("chart-apple-us"),
    chartPlaylistById("chart-dz-amapiano"),
  ]);
  return results
    .filter((r): r is PromiseFulfilledResult<Playlist> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}
