import { NextResponse } from "next/server";
import { getSessionUser, publicUser } from "@/lib/auth/session";
import { patchUser } from "@/lib/db/users";
import type { Track, Album, Artist } from "@/types";

/* ============================================================
   LIBRARY — likes, saved albums, followed artists/podcasts and
   recently played all live on the user record. One action-based
   PATCH endpoint keeps optimistic client updates simple.
   ============================================================ */

type Body =
  | { op: "like" | "unlike"; track: Track }
  | { op: "save-album" | "unsave-album"; album: Album }
  | { op: "follow-artist" | "unfollow-artist"; artist: Artist }
  | { op: "follow-podcast" | "unfollow-podcast"; podcastId: string }
  | { op: "recent"; track: Track }
  | { op: "add-download" | "remove-download"; track: Track }
  | null;

function toggleUserList<T>(list: T[], item: T, add: boolean, keyOf: (v: T) => string): T[] {
  const key = keyOf(item);
  return add ? (list.some((v) => keyOf(v) === key) ? list : [...list, item]) : list.filter((v) => keyOf(v) !== key);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({
    likedTracks: user.likedTracks,
    savedAlbums: user.savedAlbums,
    followedArtists: user.followedArtists,
    followedPodcasts: user.followedPodcasts,
    recentlyPlayed: user.recentlyPlayed,
    downloads: user.downloads,
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = ((await request.json().catch(() => null)) as Body) ?? null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const patch: Record<string, unknown> = {};

  switch (body.op) {
    case "like":
    case "unlike":
      patch.likedTracks = toggleUserList(user.likedTracks, body.track, body.op === "like", (t) => t.id);
      break;
    case "save-album":
    case "unsave-album":
      patch.savedAlbums = toggleUserList(user.savedAlbums, body.album, body.op === "save-album", (a) => a.id);
      break;
    case "follow-artist":
    case "unfollow-artist":
      patch.followedArtists = toggleUserList(
        user.followedArtists,
        body.artist,
        body.op === "follow-artist",
        (a) => a.id
      );
      break;
    case "follow-podcast":
    case "unfollow-podcast": {
      const add = body.op === "follow-podcast";
      const set = new Set(user.followedPodcasts);
      if (add) set.add(body.podcastId);
      else set.delete(body.podcastId);
      patch.followedPodcasts = [...set];
      break;
    }
    case "recent": {
      // Cap history at 200 entries, most-recent-first, de-duplicated.
      const history = user.recentlyPlayed as unknown as Track[];
      const rest = history.filter((t) => t.id !== body.track.id);
      patch.recentlyPlayed = [body.track, ...rest].slice(0, 200);
      break;
    }
    case "add-download":
    case "remove-download":
      patch.downloads = toggleUserList(user.downloads, body.track, body.op === "add-download", (t) => t.id);
      break;
  }

  const updated = patchUser(user.id, patch);
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user: publicUser(updated) });
}
