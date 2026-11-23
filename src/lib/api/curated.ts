import "server-only";
import { searchTracks } from "@/lib/api/music";
import { getAppSettings } from "@/lib/db/app-settings";
import { PLAYLISTS } from "@/lib/data/demo";
import type { Playlist } from "@/types";

/* ============================================================
   CURATED PLAYLISTS (server-only)
   ------------------------------------------------------------
   Section shelves the admin marks as kind "playlists" (Chill,
   Workout, Focus…) become real, playable playlist objects built
   live from the catalogue — so the card says "Playlist", links
   to a real playlist page, and its tracks all resolve.

   Resolution happens doubly: referenced via id, rebuilt via
   search and rebuilt with the same query. Cached per id.
   ============================================================ */

const FRESH_TTL = 10 * 60 * 1000;
const EMPTY_TTL = 60 * 1000;

interface CacheEntry {
  at: number;
  playlist: Playlist | null;
}

const genreCache = new Map<string, CacheEntry>();

/** `genre-<sectionId>` playlist built from live search results. */
export async function curatedGenrePlaylist(sectionId: string, title: string): Promise<Playlist | null> {
  const key = `genre-${sectionId}`;
  const hit = genreCache.get(key);
  if (hit && Date.now() - hit.at <= (hit.playlist ? FRESH_TTL : EMPTY_TTL)) return hit.playlist;

  const results = await searchTracks(`${title} songs`, "soundcloud").catch(() => null);
  const tracks = (results?.tracks ?? []).slice(0, 14);
  const now = Date.now();
  const playlist: Playlist | null = tracks.length
    ? {
        id: key,
        name: title,
        description: `${title} — curated live from the catalogue.`,
        artwork: tracks[0]?.artwork ?? "",
        owner: "Lenzo Music",
        public: true,
        collaborative: false,
        tracks,
        createdAt: now,
        updatedAt: now,
        followers: 0,
      }
    : null;

  genreCache.set(key, { at: now, playlist });
  return playlist;
}

/** Resolve any curated playlist id: demo shelves (`pl-*`) and genre shelves (`genre-*`). */
export async function curatedPlaylistById(id: string): Promise<Playlist | null> {
  if (id.startsWith("pl-")) {
    return PLAYLISTS.find((p) => p.id === id) ?? null;
  }
  if (id.startsWith("chart-")) {
    const { chartPlaylistById } = await import("@/lib/api/charts");
    return chartPlaylistById(id);
  }
  if (id.startsWith("genre-")) {
    const sectionId = id.slice("genre-".length);
    const section = getAppSettings().homeSections.find((s) => s.id === sectionId);
    if (!section) return null;
    return curatedGenrePlaylist(section.id, section.title);
  }
  return null;
}
