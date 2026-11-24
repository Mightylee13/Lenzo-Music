"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, MoreHorizontal, Pause, Play } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import TrackSheet from "@/components/tracks/TrackSheet";
import { usePlayerStore, prefetchTracks } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { formatDuration } from "@/lib/client/fetcher";
import { useOnline } from "@/lib/client/hooks";
import type { Track } from "@/types";

/* ============================================================
   TRACK LIST — the core list used on home/artists/albums/playlists
   and search results. Mobile rows are thumb-sized; hover play on
   desktop; current track gets an equalizer accent.
   ============================================================ */

export function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-cyan animate-equalizer"
          style={{ height: "100%", animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

interface TrackListProps {
  tracks: Track[];
  showIndex?: boolean;
  showAlbum?: boolean;
  playlistId?: string;
  onPlaylistMutated?: () => void;
  /** Duration column mostly hidden in compact contexts (e.g. mobile search). */
  compact?: boolean;
  emptyMessage?: string;
}

export default function TrackList({
  tracks,
  showIndex = true,
  showAlbum = false,
  playlistId,
  onPlaylistMutated,
  compact = false,
  emptyMessage = "Nothing here yet.",
}: TrackListProps) {
  const [sheetTrack, setSheetTrack] = useState<Track | null>(null);
  const router = useRouter();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = usePlayerStore((s) => s.current);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const unplayable = usePlayerStore((s) => s.unplayable);
  const session = useSession();
  const ui = useUi.getState();
  const online = useOnline();

  // Offline: which tracks are stored on this device (played before)?
  // Those still play from the device cache — everything else dims.
  const [offlineCached, setOfflineCached] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (online) {
      setOfflineCached(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ids = new Set<string>();
      try {
        if (typeof caches !== "undefined") {
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            for (const req of await cache.keys()) {
              const match = /\/__audio__\/(.+)$/.exec(new URL(req.url).pathname);
              if (match) ids.add(decodeURIComponent(match[1]));
            }
          }
        }
      } catch { /* no cache access — treat everything as unplayable */ }
      if (!cancelled) setOfflineCached(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  // Play click routing: when the track is known-unplayable right now,
  // say so instead of silently failing in the player.
  const guardPlay = (track: Track) => {
    const dead = online ? Boolean(unplayable[track.id]) : offlineCached !== null && !offlineCached.has(track.id);
    if (dead && !online) {
      ui.showToast("You're offline — only songs you've played before can play.", "info");
      return;
    }
    if (current?.id === track.id) toggle();
    else playTrack(track, tracks);
  };

  // Warm only the first track: the upstream converter serialises per-key
  // requests, so prefetching several tracks queues real taps behind them.
  useEffect(() => {
    if (!tracks.length) return;
    const t = setTimeout(() => void prefetchTracks(tracks, 1), 2000);
    return () => clearTimeout(t);
  }, [tracks]);

  if (tracks.length === 0) {
    return <p className="px-2 py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="flex flex-col">
        {tracks.map((track, i) => {
          const isCurrent = current?.id === track.id;
          // Playability right now: online it depends on whether the track
          // already failed to resolve; offline only device-saved songs
          // (audio bytes stored by the service worker) can play.
          const dead = online
            ? Boolean(unplayable[track.id])
            : offlineCached !== null && !offlineCached.has(track.id);
          const offlinePlayable = !online && offlineCached?.has(track.id);
          const offlineScanning = !online && offlineCached === null;
          return (
            <div
              key={`${track.id}-${i}`}
              className={`group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/4 md:grid-cols-[2rem_4fr_3fr_auto] md:px-3 ${
                dead && !offlineScanning ? "opacity-40 saturate-50" : ""
              }`}
            >
              {/* Index / play state */}
              <div className="flex items-center justify-center">
                {isCurrent && isPlaying ? (
                  <button type="button" onClick={toggle} aria-label="Pause" className="grid place-items-center">
                    <span className="group-hover:hidden"><Equalizer /></span>
                    <Pause className="hidden size-4 fill-current text-ink group-hover:block" />
                  </button>
                ) : (
                  <>
                    {showIndex && (
                      <span className={`${isCurrent ? "text-cyan" : "text-faint"} text-sm tabular-nums group-hover:hidden`}>
                        {i + 1}
                      </span>
                    )}
                    {!showIndex && (
                      <span className="size-4 group-hover:hidden" />
                    )}
                    <button
                      type="button"
                      aria-label={`Play ${track.title}`}
                      onClick={() => guardPlay(track)}
                      className="hidden text-ink group-hover:block"
                    >
                      <Play className="size-4 fill-current" />
                    </button>
                    {isCurrent && !isPlaying && (
                      <button
                        type="button"
                        onClick={toggle}
                        aria-label="Resume"
                        className="text-cyan group-hover:hidden"
                      >
                        <Play className="size-4 fill-current" />
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Title + artist */}
              <button
                type="button"
                onClick={() => guardPlay(track)}
                // Hover / first touch anywhere on a row warms its audio
                // source, so the actual tap usually starts instantly.
                onPointerEnter={() => prefetchTracks([track], 1)}
                onTouchStart={() => prefetchTracks([track], 1)}
                className="flex min-w-0 items-center gap-3 text-left"
              >
                <Artwork src={track.artwork} seed={track.id} label={track.title} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold ${isCurrent ? "text-cyan" : "text-ink"}`}>
                    {track.title}
                    {track.explicit && <span className="ml-1.5 rounded bg-white/10 px-1 text-[10px] font-bold text-muted">E</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {track.artistId ? (
                      // A real <Link> can't live inside the row <button>, so
                      // navigate programmatically instead (valid HTML, same UX).
                      <span
                        role="link"
                        tabIndex={0}
                        className="cursor-pointer hover:text-ink hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/artists/${track.artistId}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            router.push(`/artists/${track.artistId}`);
                          }
                        }}
                      >
                        {track.artist}
                      </span>
                    ) : (
                      track.artist
                    )}
                    {offlinePlayable && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-success">Saved</span>
                    )}
                    {!online && !offlinePlayable && offlineCached !== null && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-faint">Offline</span>
                    )}
                  </span>
                </span>
              </button>

              {/* Album (desktop) */}
              {showAlbum ? (
                <span className="hidden truncate text-sm text-muted md:block">
                  {track.album && track.albumId ? (
                    <Link href={`/albums/${track.albumId}`} className="hover:text-ink hover:underline">
                      {track.album}
                    </Link>
                  ) : (
                    track.album ?? ""
                  )}
                </span>
              ) : (
                <span className="hidden md:block" />
              )}

              {/* Like + duration + menu */}
              <div className="flex items-center justify-end gap-1.5">
                {session.user && (
                  <button
                    type="button"
                    aria-label={session.isLiked(track.id) ? "Unlike" : "Like"}
                    onClick={async () => {
                      try {
                        await session.toggleLike(track);
                      } catch (err) {
                        ui.showToast(err instanceof Error ? err.message : "Sign in first", "error");
                      }
                    }}
                    className={`grid size-8 place-items-center rounded-full transition-colors hover:bg-white/8 ${
                      session.isLiked(track.id)
                        ? "text-danger"
                        : "text-faint md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                  >
                    <Heart className={`size-4 ${session.isLiked(track.id) ? "fill-current" : ""}`} />
                  </button>
                )}
                {!compact && <span className="w-10 text-right text-xs tabular-nums text-faint">{formatDuration(track.duration)}</span>}
                <button
                  type="button"
                  aria-label={`More options for ${track.title}`}
                  onClick={() => setSheetTrack(track)}
                  className="grid size-8 place-items-center rounded-full text-faint transition-colors hover:bg-white/8 hover:text-ink"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <TrackSheet
        track={sheetTrack}
        context={tracks}
        inPlaylistId={playlistId}
        onPlaylistMutated={onPlaylistMutated}
        onClose={() => setSheetTrack(null)}
      />
    </>
  );
}
