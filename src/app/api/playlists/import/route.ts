import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createPlaylist, updatePlaylist } from "@/lib/db/playlists";
import { importSpotifyPlaylist } from "@/lib/api/spotifyPlaylist";

/**
 * POST /api/playlists/import — body: { url }. Reads a public Spotify
 * playlist (pathfinder web-player API, embed scrape fallback — no user
 * credentials) and stores it as a local playlist with playable tracks.
 */
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to import playlists" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url?.trim()) {
    return NextResponse.json({ error: "A Spotify playlist URL is required" }, { status: 400 });
  }

  try {
    const imported = await importSpotifyPlaylist(body.url);
    const created = createPlaylist({
      name: imported.name,
      description: imported.description ?? (imported.owner ? `Imported from Spotify · ${imported.owner}` : undefined),
      ownerId: user.id,
      ownerName: user.username,
    });
    const artwork = imported.tracks.find((t) => t.artwork)?.artwork;
    const playlist = updatePlaylist(created.id, {
      tracks: imported.tracks,
      ...(artwork ? { artwork } : {}),
    });
    if (!playlist) throw new Error("Import failed");
    return NextResponse.json(
      { playlist, importedCount: imported.tracks.length, via: imported.source },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 422 },
    );
  }
}
