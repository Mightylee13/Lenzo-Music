"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  Disc3,
  Heart,
  ListEnd,
  ListStart,
  ListPlus,
  Music2,
  Radio,
  Share2,
  User,
} from "lucide-react";
import Sheet, { SheetItem } from "@/components/ui/Sheet";
import { useSession } from "@/lib/store/session";
import { usePlayerStore } from "@/lib/store/player";
import { useUi } from "@/lib/store/ui";
import { apiGet, apiSend } from "@/lib/client/fetcher";
import type { Playlist, Track } from "@/types";

/* ============================================================
   TRACK SHEET — universal "..." actions menu for a track.
   Handles like, queue (next/end), playlist picker, download,
   follow artist, share and provider links.
   ============================================================ */

interface TrackSheetProps {
  track: Track | null;
  context?: Track[];
  onClose: () => void;
  /** Playlist the track is already in (enables "remove from…"). */
  inPlaylistId?: string;
  onPlaylistMutated?: () => void;
}

export default function TrackSheet({ track, context, onClose, inPlaylistId, onPlaylistMutated }: TrackSheetProps) {
  const [step, setStep] = useState<"actions" | "playlists">("actions");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  const player = usePlayerStore.getState();
  const session = useSession();
  const ui = useUi.getState();

  if (!track) return null;

  const openPlaylists = async () => {
    setStep("playlists");
    setLoadingPlaylists(true);
    try {
      const data = await apiGet<{ mine: Playlist[] }>("/api/playlists");
      setPlaylists(data.mine);
    } catch {
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  };

  const addToPlaylist = async (playlistId: string) => {
    try {
      await apiSend(`/api/playlists/${playlistId}`, "PATCH", { op: "add-tracks", patch: { track } });
      ui.showToast("Added to playlist", "success");
      onPlaylistMutated?.();
      onClose();
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Could not add track", "error");
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      ui.showToast(ok, "success");
      onClose();
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Action failed", "error");
    }
  };

  return (
    <Sheet
      open={Boolean(track)}
      onClose={onClose}
      title={step === "actions" ? `Actions · ${track.title}` : "Add to playlist"}
    >
      {step === "actions" ? (
        <div className="flex flex-col pb-2 sm:pb-0">
          {player.current?.id !== track.id && (
            <SheetItem
              icon={<Radio className="size-4" />}
              label="Play now"
              description={track.artist}
              onClick={() => {
                usePlayerStore.getState().playTrack(track, context);
                onClose();
              }}
            />
          )}
          <SheetItem
            icon={<ListStart className="size-4" />}
            label="Play next"
            onClick={() => run(() => Promise.resolve(usePlayerStore.getState().playNext(track)), "Playing next")}
          />
          <SheetItem
            icon={<ListEnd className="size-4" />}
            label="Add to queue"
            onClick={() => run(() => Promise.resolve(usePlayerStore.getState().addToQueue(track)), "Added to queue")}
          />
          {session.user && (
            <SheetItem
              icon={<Heart className={`size-4 ${session.isLiked(track.id) ? "fill-current text-danger" : ""}`} />}
              label={session.isLiked(track.id) ? "Remove from Liked Songs" : "Add to Liked Songs"}
              onClick={() => run(() => session.toggleLike(track), session.isLiked(track.id) ? "Removed from Liked Songs" : "Added to Liked Songs")}
            />
          )}
          {session.user && (
            <SheetItem icon={<ListPlus className="size-4" />} label="Add to playlist" onClick={openPlaylists} />
          )}
          {inPlaylistId && (
            <SheetItem
              icon={<Disc3 className="size-4" />}
              label="Remove from this playlist"
              onClick={() =>
                run(async () => {
                  await apiSend(`/api/playlists/${inPlaylistId}`, "PATCH", { op: "remove-track", patch: { track: { id: track.id } as Track } });
                  onPlaylistMutated?.();
                }, "Removed")
              }
            />
          )}
          {session.user && (
            <SheetItem
              icon={<ArrowDownToLine className="size-4" />}
              label={session.isDownloaded(track.id) ? "Remove download" : "Save to downloads"}
              onClick={() => run(() => session.toggleDownload(track), session.isDownloaded(track.id) ? "Download removed" : "Saved for offline")}
            />
          )}
          {session.user && track.artistId && (
            <SheetItem
              icon={<User className="size-4" />}
              label={session.isFollowingArtist(track.artistId) ? "Unfollow artist" : "Follow artist"}
              onClick={() =>
                run(
                  () =>
                    session.toggleFollowArtist({
                      id: track.artistId!,
                      name: track.artist.split(",")[0],
                      image: track.artwork,
                      source: track.source,
                    }),
                  "Done"
                )
              }
            />
          )}
          {track.url && (
            <a
              href={track.url}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/6"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/6">
                <Music2 className="size-4" />
              </span>
              <span className="text-sm font-semibold">Open on {track.source === "youtube" ? "YouTube" : track.source === "spotify" ? "Spotify" : "SoundCloud"}</span>
            </a>
          )}
          <SheetItem
            icon={<Share2 className="size-4" />}
            label="Share"
            onClick={async () => {
              const shareUrl = track.url ?? `${window.location.origin}/search?q=${encodeURIComponent(track.title)}`;
              try {
                if (navigator.share) {
                  await navigator.share({ title: track.title, text: `${track.artist} · ${track.title}`, url: shareUrl });
                } else {
                  await navigator.clipboard.writeText(shareUrl);
                  ui.showToast("Link copied to clipboard", "success");
                }
                onClose();
              } catch {
                /* share dismissed */
              }
            }}
          />
          <Link
            href={`/search?q=${encodeURIComponent(track.artist)}`}
            onClick={onClose}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/6"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/6">
              <Disc3 className="size-4" />
            </span>
            <span className="text-sm font-semibold">More from this artist</span>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col pb-2 sm:pb-0">
          {loadingPlaylists ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Loading your playlists…</p>
          ) : playlists.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              No playlists yet — create one on the Playlists page.
            </p>
          ) : (
            playlists.map((pl) => (
              <SheetItem
                key={pl.id}
                icon={<ListPlus className="size-4" />}
                label={pl.name}
                description={`${pl.tracks.length} songs`}
                onClick={() => addToPlaylist(pl.id)}
              />
            ))
          )}
        </div>
      )}
    </Sheet>
  );
}
