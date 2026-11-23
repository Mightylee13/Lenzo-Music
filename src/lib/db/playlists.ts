import "server-only";
import { collection, updateDb } from "@/lib/db/json-store";
import { generateArtwork } from "@/lib/artwork";
import type { Playlist, Track } from "@/types";

/* ============================================================
   PLAYLISTS — user-owned, persisted in the JSON store.
   Owner scoping happens in the route handlers; the user id is
   kept on `ownerId` so the queries below are O(n) and simple.
   ============================================================ */

export function playlists(): Playlist[] {
  return collection<Playlist>("playlists");
}

export function playlistsByOwner(ownerId: string): Playlist[] {
  return playlists().filter((p) => p.ownerId === ownerId);
}

export function publicPlaylists(): Playlist[] {
  return playlists().filter((p) => p.public);
}

export function findPlaylist(id: string): Playlist | null {
  return playlists().find((p) => p.id === id) ?? null;
}

export interface NewPlaylistInput {
  name: string;
  description?: string;
  ownerId: string;
  ownerName: string;
  public?: boolean;
  collaborative?: boolean;
}

export function createPlaylist(input: NewPlaylistInput): Playlist {
  const now = Date.now();
  const playlist: Playlist = {
    id: `pl_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || "New playlist",
    description: input.description?.trim() ?? "",
    artwork: generateArtwork(input.name, input.name),
    owner: input.ownerName,
    ownerId: input.ownerId,
    public: input.public ?? false,
    collaborative: input.collaborative ?? false,
    tracks: [],
    createdAt: now,
    updatedAt: now,
    followers: 0,
  };
  updateDb((db) => {
    const list = (db.playlists as Playlist[]) ?? [];
    list.push(playlist);
    db.playlists = list;
  });
  return playlist;
}

export type PlaylistPatch = Partial<
  Pick<Playlist, "name" | "description" | "artwork" | "public" | "collaborative" | "tracks">
> & { removeArtwork?: boolean };

export function updatePlaylist(id: string, patch: PlaylistPatch): Playlist | null {
  let updated: Playlist | null = null;
  updateDb((db) => {
    const list = (db.playlists as Playlist[]) ?? [];
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const { removeArtwork, ...rest } = patch;
    const current = list[idx];
    list[idx] = {
      ...current,
      ...rest,
      id: current.id,
      ownerId: current.ownerId,
      owner: current.owner,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
      // Re-generate procedural artwork when the name changes and no custom
      // artwork (or an explicit artwork removal) was supplied.
      artwork: rest.artwork ?? (removeArtwork && rest.name ? generateArtwork(rest.name, rest.name) : current.artwork),
    };
    updated = list[idx];
    db.playlists = list;
  });
  return updated;
}

export function duplicatePlaylist(id: string, ownerId: string, ownerName: string): Playlist | null {
  const source = findPlaylist(id);
  if (!source) return null;
  const copy = createPlaylist({
    name: `${source.name} (copy)`,
    description: source.description,
    ownerId,
    ownerName,
    public: false,
    collaborative: false,
  });
  copy.tracks = source.tracks;
  updatePlaylist(copy.id, { tracks: source.tracks });
  return updateDb((db) => {
    const list = (db.playlists as Playlist[]) ?? [];
    const idx = list.findIndex((p) => p.id === copy.id);
    if (idx === -1) return copy;
    list[idx].tracks = source.tracks;
    db.playlists = list;
    return list[idx];
  });
}

export function deletePlaylist(id: string): boolean {
  let removed = false;
  updateDb((db) => {
    const list = (db.playlists as Playlist[]) ?? [];
    const next = list.filter((p) => p.id !== id);
    removed = next.length !== list.length;
    db.playlists = next;
  });
  return removed;
}

export function addTrackToPlaylist(id: string, track: Track): Playlist | null {
  const playlist = findPlaylist(id);
  if (!playlist) return null;
  if (playlist.tracks.some((t) => t.id === track.id)) return playlist;
  return updatePlaylist(id, { tracks: [...playlist.tracks, track] });
}

export function removeTrackFromPlaylist(id: string, trackId: string): Playlist | null {
  const playlist = findPlaylist(id);
  if (!playlist) return null;
  return updatePlaylist(id, {
    tracks: playlist.tracks.filter((t) => t.id !== trackId),
  });
}

export function reorderPlaylistTracks(id: string, from: number, to: number): Playlist | null {
  const playlist = findPlaylist(id);
  if (!playlist) return null;
  const tracks = [...playlist.tracks];
  if (from < 0 || to < 0 || from >= tracks.length || to >= tracks.length || from === to) return playlist;
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return updatePlaylist(id, { tracks });
}
