import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  createPlaylist,
  playlistsByOwner,
  publicPlaylists,
} from "@/lib/db/playlists";
import { refreshDbIfStale } from "@/lib/db/json-store";

/** GET — your playlists, plus public ones from other listeners. */
export async function GET() {
  // Refresh the snapshot first: another instance may have just flushed an
  // import/create. List must never go stale for longer than the window.
  await refreshDbIfStale(15_000);
  const user = await getSessionUser();
  const mine = user ? playlistsByOwner(user.id) : [];
  const discover = user ? publicPlaylists().filter((p) => p.ownerId !== user.id) : publicPlaylists();
  return NextResponse.json({ mine, discover });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to create playlists" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { name?: string; description?: string; public?: boolean; collaborative?: boolean }
    | null;

  const playlist = createPlaylist({
    name: body?.name ?? `My Playlist #${playlistsByOwner(user.id).length + 1}`,
    description: body?.description,
    ownerId: user.id,
    ownerName: user.username,
    public: body?.public,
    collaborative: body?.collaborative,
  });

  return NextResponse.json({ playlist }, { status: 201 });
}
