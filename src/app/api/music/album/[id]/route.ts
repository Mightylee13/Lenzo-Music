import { NextResponse } from "next/server";
import { callUpstream } from "@/lib/api/client";
import { albumsFromTracks, normalizeSpotifyTracks, slug } from "@/lib/api/normalizers";

/**
 * GET /api/music/album/[id] — `id` is the app-level album key
 * (`al_<slug(album)-<slug(artist)>>`) produced by albumsFromTracks.
 * We re-search Spotify with the decoded slug as the query, regroup the
 * returned tracks into albums, and return the matching group so every
 * album page is backed by real, playable tracks from the same catalogue.
 *
 * Set-style ids (title + SoundCloud uploader) never exist verbatim on
 * Spotify, so when no exact id matches we fall back to the release whose
 * title the query slug contains — longest title first, most tracks on a
 * tie — instead of dead-ending on a 404.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/music/album/[id]">) {
  const { id } = await ctx.params;
  const query = decodeURIComponent(id.startsWith("al_") ? id.slice(3) : id).replace(/-/g, " ");

  try {
    const raw = await callUpstream({ endpoint: "search.spotify", params: { query } });
    const albums = albumsFromTracks(normalizeSpotifyTracks(raw));
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
    const album = exact ?? byTitle[0] ?? null;

    if (!album) {
      return NextResponse.json({ error: "Album not found in catalogue" }, { status: 404 });
    }

    return NextResponse.json({ album });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Album lookup failed" },
      { status: 502 }
    );
  }
}
