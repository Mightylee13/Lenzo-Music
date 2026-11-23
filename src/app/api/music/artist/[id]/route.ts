import { NextResponse } from "next/server";
import { lookupArtist } from "@/lib/api/music";
import { slug } from "@/lib/api/normalizers";

/**
 * GET /api/music/artist/[id] — `id` is the app-level artist key
 * (`ar_<slug-of-name>`) produced by the normalizers, so the display
 * name is recoverable and a targeted re-search builds the profile.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/music/artist/[id]">) {
  const { id } = await ctx.params;
  const name = decodeURIComponent(id.startsWith("ar_") ? id.slice(3) : id).replace(/-/g, " ");

  try {
    const { tracks, albums, artists } = await lookupArtist(name);

    const artist =
      artists.find((a) => a.id === (id.startsWith("ar_") ? id : `ar_${slug(id)}`)) ??
      artists[0] ??
      null;

    const related = artists.filter((a) => a.id !== artist?.id).slice(0, 12);
    const ownTracks = tracks.filter(
      (t) => (artist && t.artistId === artist?.id) || slug(t.artist.split(",")[0]) === slug(name)
    );
    const ownAlbums = albums.filter((a) => a.artistId === artist?.id || slug(a.artist.split(",")[0]) === slug(name));

    return NextResponse.json({
      artist,
      tracks: ownTracks.slice(0, 25),
      albums: ownAlbums,
      related,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Artist lookup failed" },
      { status: 502 }
    );
  }
}
