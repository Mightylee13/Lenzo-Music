import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { curatedPlaylistById } from "@/lib/api/curated";
import { ensureDbLoaded, refreshDbIfStale } from "@/lib/db/json-store";
import {
  addTrackToPlaylist,
  deletePlaylist,
  duplicatePlaylist,
  findPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  updatePlaylist,
  type PlaylistPatch,
} from "@/lib/db/playlists";
import type { Track } from "@/types";

type Body = {
  op: "edit" | "add-tracks" | "remove-track" | "reorder" | "duplicate";
  patch?: PlaylistPatch & { track?: Track; from?: number; to?: number };
} | null;

/** GET — a single playlist, if it exists and is visible to the caller.
 *  Curated shelves (demo `pl-*` and live-built `genre-*` playlists)
 *  resolve here too; they are read-only for everyone. */
export async function GET(_request: Request, ctx: RouteContext<"/api/playlists/[id]">) {
  const { id } = await ctx.params;
  await ensureDbLoaded();
  let playlist = findPlaylist(id) ?? (await curatedPlaylistById(id));
  if (!playlist) {
    // This instance's snapshot may predate the write that created the
    // playlist on another serverless instance — refresh once before the
    // honest "not found".
    await refreshDbIfStale(3_000);
    playlist = findPlaylist(id) ?? (await curatedPlaylistById(id));
  }
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });

  const user = await getSessionUser();
  const isOwner = Boolean(user?.id) && user?.id === playlist.ownerId;
  if (!playlist.public && !isOwner) {
    return NextResponse.json({ error: "This playlist is private" }, { status: 403 });
  }
  return NextResponse.json({ playlist, isOwner });
}

/** PATCH — owner-scoped mutations (edit, tracks, reorder, duplicate). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/playlists/[id]">) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const playlist = findPlaylist(id);
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  if (playlist.ownerId !== user.id && !(playlist.collaborative && playlist.public)) {
    return NextResponse.json({ error: "You do not have permission to edit this playlist" }, { status: 403 });
  }

  const body = ((await request.json().catch(() => null)) as Body) ?? null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  switch (body.op) {
    case "edit": {
      const patch = body.patch ?? {};
      delete (patch as { track?: Track }).track;
      const updated = updatePlaylist(id, patch);
      return NextResponse.json({ playlist: updated });
    }
    case "add-tracks": {
      const track = body.patch?.track;
      if (!track?.id) return NextResponse.json({ error: "A track is required" }, { status: 400 });
      const updated = addTrackToPlaylist(id, track);
      return NextResponse.json({ playlist: updated });
    }
    case "remove-track": {
      const trackId = body.patch?.track?.id;
      if (!trackId) return NextResponse.json({ error: "A track id is required" }, { status: 400 });
      const updated = removeTrackFromPlaylist(id, trackId);
      return NextResponse.json({ playlist: updated });
    }
    case "reorder": {
      const from = Number(body.patch?.from);
      const to = Number(body.patch?.to);
      const updated = reorderPlaylistTracks(id, from, to);
      return NextResponse.json({ playlist: updated });
    }
    case "duplicate": {
      const copy = duplicatePlaylist(id, user.id, user.username);
      if (!copy) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
      return NextResponse.json({ playlist: copy }, { status: 201 });
    }
    default:
      return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/playlists/[id]">) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const playlist = findPlaylist(id);
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  if (playlist.ownerId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "Only the owner can delete a playlist" }, { status: 403 });
  }
  deletePlaylist(id);
  return NextResponse.json({ ok: true });
}
