import { NextResponse } from "next/server";
import { callUpstream } from "@/lib/api/client";
import { albumsFromTracks, normalizeSpotifyTracks, slug } from "@/lib/api/normalizers";
import { engineSearchRaw, engineTrackToTrack } from "@/lib/server/spotifyEngine";
import type { Album } from "@/types";

/**
 * GET /api/music/album/[id] — `id` is the app-level album key
 * (`al_<slug(album)-<slug(artist)>>`) produced by albumsFromTracks.
 * We re-search the Spotify engine with the decoded slug as the query,
 * regroup the returned tracks into albums, and return the matching group
 * so every album page is backed by real, playable tracks from the same
 * catalogue. The mirror API is the fallback when the engine is down.
 *
 * Set-style ids (title + SoundCloud uploader) never exist verbatim on
 * Spotify, so when no exact id matches we fall back to the release whose
 * title the query slug contains — longest title first, most tracks on a
 * tie — instead of dead-ending on a 404.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/music/album/[id]">) {
  const { id } = await ctx.params;
  const query = decodeURIComponent(id.startsWith("al_") ? id.slice(3) : id).replace(/-/g, " ");

  const pick = (albums: Album[]) => {
    const exact = albums.find((a) => a.id === id);

    const qSlug = slug(query);
    const byTitle = albums
      .filter((a) => {
        const t = slug(a.title);
        return t.length >= 4 && qSlug.includes(t);
      })
      .sort(
        (a, b) => slug(b.title).length - slug(a.title).length || b.trackCount - a.trackCount,
      );
    return exact ?? byTitle[0] ?? null;
  };

  let albums: Album[] = [];
  const errors: string[] = [];

  // Engine first — real catalogue grouping at web-player latency.
  try {
    const found = await engineSearchRaw(query, 30);
    const grouped = albumsFromTracks(found.tracks.map(engineTrackToTrack));
    // Fold the catalogue's real release type/year over the grouped cards.
    const native = found.albums;
    if (native.length) {
      const byId = new Map(native.map((a) => [`al_${slug(`${a.name}-${a.mainArtist}`)}`, a]));
      for (const g of grouped) {
        const n = byId.get(g.id);
        if (!n) continue;
        if (n.type) g.type = n.type;
        if (n.year) {
          g.year = n.year;
          g.releaseDate = String(n.year);
        }
      }
    }
    albums = grouped;
  } catch (err) {
    errors.push(`engine: ${err instanceof Error ? err.message : "unknown"}`);
  }

  // Mirror-API fallback — only when the engine failed or found nothing.
  if (!albums.length) {
    try {
      const raw = await callUpstream({ endpoint: "search.spotify", params: { query } });
      albums = albumsFromTracks(normalizeSpotifyTracks(raw));
    } catch (err) {
      errors.push(`upstream: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  const album = pick(albums);

  if (!album) {
    console.error(`[album] ${id} not found (${errors.join(" | ") || "empty catalogue"})`);
    return NextResponse.json({ error: "Album not found in catalogue" }, { status: 404 });
  }

  return NextResponse.json({ album });
}
