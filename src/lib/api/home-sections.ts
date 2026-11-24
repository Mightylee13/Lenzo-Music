import "server-only";
import { callUpstream } from "@/lib/api/client";
import { chartPlaylistById, defaultChartPlaylists } from "@/lib/api/charts";
import { curatedGenrePlaylist } from "@/lib/api/curated";
import { searchAll, searchTracks } from "@/lib/api/music";
import { albumsFromTracks, normalizeSpotifyTracks } from "@/lib/api/normalizers";
import { engineAlbumToAlbum, engineSearchRaw } from "@/lib/server/spotifyEngine";
import { getSessionUser } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/db/app-settings";
import { playlistsByOwner } from "@/lib/db/playlists";
import { CHARTS, PLAYLISTS } from "@/lib/data/demo";
import type { Album, HomeSectionConfig, Track } from "@/types";

/* ============================================================
   HOME SECTION BUILDER (server-only, shared)
   ------------------------------------------------------------
   Each homepage section is built independently. Local sections
   (recently played, made for you) are pure DB reads; remote
   sections hit the catalogue via a concurrency gate so a cold
   homepage floods neither the user nor the upstream API.

   Every remote section is cached on its own with per-entry
   stale-while-revalidate, so loading the homepage "in small
   small" never repeats upstream work.
   ============================================================ */

export interface SectionPayload {
  id: string;
  title: string;
  kind: "tracks" | "playlists" | "albums" | "artists" | "charts";
  tracks?: unknown[];
  playlists?: unknown[];
  albums?: unknown[];
  artists?: unknown[];
}

export interface SectionDescriptor {
  id: string;
  title: string;
  kind: string;
  /** Set when the section is served from a local/DB build or a warm cache. */
  payload: SectionPayload | null;
}

const TRENDING_QUERY = "trending songs this week";

/** Demo shelf (real, resolvable titles) so a flaky upstream never blanks a tracks shelf. */
function demoShelfTracks(count: number): Track[] {
  return (CHARTS[0]?.tracks ?? []).slice(0, count);
}

/** Live results if truly non-empty, otherwise the demo shelf. */
function pickShelfTracks(live: Track[] | undefined, count: number): Track[] {
  const arr = live ?? [];
  return arr.length ? arr.slice(0, count) : demoShelfTracks(count);
}

/* ---------- upstream concurrency gate ---------- */

let active = 0;
const waiters: Array<() => void> = [];

async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

/* ---------- local builders (no upstream) ---------- */

export function localSectionPayload(
  section: HomeSectionConfig,
  recent: Track[],
  madeForUser: unknown[]
): SectionPayload {
  if (section.id === "recent") {
    return { id: section.id, title: section.title, kind: "tracks", tracks: recent.slice(0, 10) };
  }
  // made-for-you and any other local shelf
  return { id: section.id, title: section.title, kind: "playlists", playlists: madeForUser };
}

export function isLocalSection(id: string): boolean {
  return id === "recent" || id === "made-for-you";
}

export async function localContext(): Promise<{ recent: Track[]; madeForUser: unknown[] }> {
  const user = await getSessionUserSafe();
  const recent = (user?.recentlyPlayed ?? []) as unknown as Track[];
  const madeForUser = [...(user ? playlistsByOwner(user.id).slice(0, 8) : []), ...PLAYLISTS.slice(0, 8)];
  return { recent, madeForUser };
}

async function getSessionUserSafe() {
  try {
    return await getSessionUser();
  } catch {
    return null;
  }
}

/* ---------- remote builders ---------- */

/** Major artists whose newest drops the New Releases shelf surfaces. */
const NEW_RELEASE_ARTISTS = [
  "burna boy", "wizkid", "davido", "asake", "rema", "ayra starr",
  "tems", "tyla", "odumodublvck", "rugerr", "cassette", "fave",
];

async function engineNewReleases(): Promise<Album[]> {
  const now = new Date();
  const yearsToTry = now.getMonth() === 0 ? [now.getFullYear(), now.getFullYear() - 1] : [now.getFullYear()];
  for (const year of yearsToTry) {
    const scans = await Promise.allSettled(
      NEW_RELEASE_ARTISTS.map((artist) => engineSearchRaw(artist, 24))
    );
    const byId = new Map<string, Album>();
    for (const scan of scans) {
      if (scan.status !== "fulfilled") continue;
      for (const a of scan.value.albums) {
        if (a.year !== year) continue;
        const mapped = engineAlbumToAlbum(a);
        if (!byId.has(mapped.id)) byId.set(mapped.id, mapped);
      }
    }
    const list = [...byId.values()];
    if (list.length) return list;
  }
  return [];
}

async function buildSectionPayload(
  section: HomeSectionConfig,
  recent: Track[],
  madeForUser: unknown[]
): Promise<SectionPayload> {
  switch (section.id) {
    case "heavy-rotation": {
      // Most-appearing artists in the user's recent history.
      const counts = new Map<string, number>();
      for (const t of recent) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
      const topNames = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);
      if (!topNames.length) {
        const fallback = await withUpstreamSlot(() => searchTracks(TRENDING_QUERY, "spotify")).catch(() => null);
        return {
          id: section.id,
          title: section.title,
          kind: "tracks",
          tracks: pickShelfTracks(fallback?.tracks ?? (await withUpstreamSlot(() => searchTracks(TRENDING_QUERY, "soundcloud")).catch(() => null))?.tracks, 10),
        };
      }
      // Search the real catalogue (engine-first) — SoundCloud results are
      // covers/remixes that play the wrong song.
      const results = await Promise.allSettled(
        topNames.map((name) => withUpstreamSlot(() => searchTracks(name, "spotify")))
      );
      const merged = results.flatMap((r) => (r.status === "fulfilled" && r.value ? r.value.tracks.slice(0, 3) : []));
      return { id: section.id, title: section.title, kind: "tracks", tracks: merged.slice(0, 10) };
    }
    case "charts": {
      const chart = await withUpstreamSlot(() => searchTracks("top 50 hits", "spotify")).catch(() => null);
      const live = chart?.tracks ?? [];
      if (live.length) {
        return { id: section.id, title: section.title, kind: "charts", tracks: live.slice(0, 30) };
      }
      // Upstream empty/flaked — the official Apple chart takes over so the
      // shelf never dies (these titles resolve through the network too).
      const appleChart = await chartPlaylistById("chart-apple-ng").catch(() => null);
      return {
        id: section.id,
        title: section.title,
        kind: "charts",
        tracks: (appleChart?.tracks ?? demoShelfTracks(30)).slice(0, 30),
      };
    }
    case "new-releases": {
      // THE ENGINE — real catalogue "just out": scan major artists'
      // discographies and keep only current-year releases, newest first.
      // The old mirror query ("new releases this week") returned whatever
      // the upstream guessed, which is why the shelf never showed the new.
      const engineReleases = await withUpstreamSlot(() => engineNewReleases()).catch(() => []);
      if (engineReleases.length) {
        return { id: section.id, title: section.title, kind: "albums", albums: engineReleases.slice(0, 14) };
      }
      const raw = await withUpstreamSlot(() =>
        callUpstream({ endpoint: "search.spotify", params: { query: "new releases this week" } })
      ).catch(() => null);
      return {
        id: section.id,
        title: section.title,
        kind: "albums",
        albums: raw ? albumsFromTracks(normalizeSpotifyTracks(raw)).slice(0, 14) : [],
      };
    }
    case "recommended-artists": {
      const results = await withUpstreamSlot(() => searchAll("afrobeats rnb pop hip-hop")).catch(() => null);
      return { id: section.id, title: section.title, kind: "artists", artists: (results?.artists ?? []).slice(0, 12) };
    }
    case "top-nigeria":
    case "top-global":
    case "top-amapiano": {
      // Real editorial chart playlists (Apple Music charts + Deezer editorial),
      // independent of the flaky upstream API.
      const charts = await defaultChartPlaylists();
      const byName: Record<string, string> = {
        "top-nigeria": "chart-apple-ng",
        "top-global": "chart-apple-us",
        "top-amapiano": "chart-dz-amapiano",
      };
      const wanted = byName[section.id];
      const heading = charts.find((c) => c.id === wanted) ?? null;
      return {
        id: section.id,
        title: section.title,
        kind: "playlists",
        playlists: heading ? [heading] : [],
      };
    }
    case "trending": {
      // Real trending = the official Apple "Most Played" chart for Nigeria
      // (real weekly-updated hits, resolvable tracks). A text query like
      // "trending songs this week" only ever matched songs literally
      // named "Trending".
      const chart = await withUpstreamSlot(() => chartPlaylistById("chart-apple-ng")).catch(() => null);
      if (chart?.tracks?.length) {
        return { id: section.id, title: section.title, kind: "tracks", tracks: chart.tracks.slice(0, 20) };
      }
      const results =
        (await withUpstreamSlot(() => searchTracks(TRENDING_QUERY, "spotify")).catch(() => null)) ??
        (await withUpstreamSlot(() => searchTracks(TRENDING_QUERY, "soundcloud")).catch(() => null));
      return {
        id: section.id,
        title: section.title,
        kind: "tracks",
        tracks: pickShelfTracks(results?.tracks, 10),
      };
    }
    default:
      break;
  }

  if (section.kind === "playlists" && !isLocalSection(section.id)) {
    // Admin asked for a playlist shelf — build a real curated playlist.
    const playlist = await withUpstreamSlot(() => curatedGenrePlaylist(section.id, section.title)).catch(() => null);
    return { id: section.id, title: section.title, kind: "playlists", playlists: playlist ? [playlist] : [] };
  }

  // Genre/mood tracks shelf — real catalogue first, SoundCloud as backup.
  const results =
    (await withUpstreamSlot(() => searchTracks(`${section.title} songs`, "spotify")).catch(() => null)) ??
    (await withUpstreamSlot(() => searchTracks(`${section.title} songs`, "soundcloud")).catch(() => null));
  const tracks = pickShelfTracks(results?.tracks, 10);
  const artists = (results?.artists ?? []).slice(0, 10);
  return {
    id: section.id,
    title: section.title,
    kind: "tracks",
    tracks: tracks.length ? tracks : undefined,
    artists: tracks.length ? undefined : artists,
  };
}

/* ---------- per-section stale-while-revalidate cache ---------- */

const FRESH_TTL = 10 * 60 * 1000;
const EMPTY_TTL = 60 * 1000;

interface SectionCacheEntry {
  at: number;
  payload: SectionPayload | null; // null = built empty (failed/ nothing found)
  refresh: Promise<unknown> | null;
}

const sectionCache = new Map<string, SectionCacheEntry>();

/** Non-blocking peek: returns any cached copy, fresh or stale. */
export function peekSection(id: string): SectionPayload | null {
  return sectionCache.get(id)?.payload ?? null;
}

function entryFresh(entry: SectionCacheEntry): boolean {
  return Date.now() - entry.at <= (entry.payload ? FRESH_TTL : EMPTY_TTL);
}

export async function getSectionPayload(id: string): Promise<SectionPayload | null> {
  const section = getAppSettings().homeSections.find((s) => s.id === id && s.enabled);
  if (!section) return null;
  if (isLocalSection(id)) {
    const { recent, madeForUser } = await localContext();
    return localSectionPayload(section, recent, madeForUser);
  }

  const entry = sectionCache.get(id);
  if (entry && entryFresh(entry)) return entry.payload;
  if (entry?.refresh) {
    // A rebuild is already running — serve the copy on hand.
    return entry.payload;
  }

  const rebuild = (async () => {
    try {
      const { recent, madeForUser } = await localContext();
      const payload = await buildSectionPayload(section, recent, madeForUser);
      const empty = !payload.tracks?.length && !payload.playlists?.length && !payload.albums?.length && !payload.artists?.length;
      sectionCache.set(id, { at: Date.now(), payload: empty ? null : payload, refresh: null });
    } catch {
      const current = sectionCache.get(id);
      if (current) current.refresh = null;
    }
  })();

  if (entry) {
    // Stale copy exists — hand it back and refresh in the background.
    entry.refresh = rebuild;
    return entry.payload;
  }

  // Cold: first request for this section must wait for the build.
  await rebuild;
  return sectionCache.get(id)?.payload ?? null;
}
