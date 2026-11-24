"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Play, Shuffle } from "lucide-react";
import MediaCard from "@/components/ui/MediaCard";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState, ErrorState, TrackListSkeleton } from "@/components/ui/skeletons";
import { useApi } from "@/lib/client/hooks";
import { albumTypeLabel } from "@/lib/labels";
import { usePlayerStore } from "@/lib/store/player";
import type { Album, Artist, Playlist, Track } from "@/types";

/* ============================================================
   SECTION SHOW-ALL — the real destination behind every home
   shelf's "Show all" link: renders EVERY item the section
   built, not just the shelf slice.
   ============================================================ */

interface SectionPayload {
  id: string;
  title: string;
  kind: string;
  tracks?: Track[];
  playlists?: Playlist[];
  albums?: Album[];
  artists?: Artist[];
}

export default function SectionShowAllPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, loading, error, reload } = useApi<SectionPayload>(
    /^[a-z0-9-]{1,64}$/i.test(id) ? `/api/home/section?id=${encodeURIComponent(id)}` : null,
  );
  const shuffleOn = usePlayerStore((s) => s.shuffle);

  const title = data?.title ?? "Section";
  const tracks = data?.tracks ?? [];

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => globalThis.history.back()}
          className="grid size-9 place-items-center rounded-full bg-card text-muted transition hover:text-ink"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-ink md:text-3xl">{title}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {tracks.length
              ? `${tracks.length} songs`
              : data?.albums?.length
                ? `${data.albums.length} albums`
                : data?.artists?.length
                  ? `${data.artists.length} artists`
                  : data?.playlists?.length
                    ? `${data.playlists.length} playlists`
                    : ""}
          </p>
        </div>
        {tracks.length > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Shuffle all"
              onClick={() => usePlayerStore.getState().toggleShuffle()}
              className={`grid size-10 place-items-center rounded-pill transition ${shuffleOn ? "bg-cyan text-white" : "bg-card text-muted hover:text-ink"}`}
            >
              <Shuffle className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => usePlayerStore.getState().playQueue(tracks, 0)}
              className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-brand/30 transition hover:bg-cyan"
            >
              <span className="flex items-center gap-1.5"><Play className="size-3.5 fill-current" /> Play all</span>
            </button>
          </div>
        )}
      </header>

      {loading && <TrackListSkeleton count={10} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && !tracks.length && !data?.albums?.length && !data?.artists?.length && !data?.playlists?.length && (
        <EmptyState title="Nothing here yet" description="This section is empty right now." />
      )}

      {/* Tracks (trending / charts / heavy rotation / genre shelves) */}
      {tracks.length > 0 && <TrackList tracks={tracks} showIndex />}

      {/* Albums (new releases) */}
      {(data?.albums?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5 md:gap-4 lg:grid-cols-6">
          {(data?.albums ?? []).map((al: Album) => (
            <MediaCard
              key={al.id}
              artwork={al.artwork}
              seed={al.id}
              label={al.title}
              title={al.title}
              subtitle={`${al.artist}${al.year ? ` · ${al.year}` : ""}`}
              badge={albumTypeLabel(al.type)}
              href={`/albums/${al.id}`}
            />
          ))}
        </div>
      )}

      {/* Artists */}
      {(data?.artists?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5 md:gap-4 lg:grid-cols-6">
          {(data?.artists ?? []).map((ar: Artist) => (
            <MediaCard
              key={ar.id}
              artwork={ar.image}
              seed={ar.id}
              label={ar.name}
              title={ar.name}
              subtitle="Artist"
              badge="Artist"
              round
              href={`/artists/${ar.id}`}
            />
          ))}
        </div>
      )}

      {/* Playlists (chart shelves) */}
      {(data?.playlists?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5 md:gap-4 lg:grid-cols-6">
          {(data?.playlists ?? []).map((pl: Playlist) => (
            <MediaCard
              key={pl.id}
              artwork={pl.artwork}
              seed={pl.id}
              label={pl.name}
              title={pl.name}
              subtitle={`Playlist · ${pl.owner}`}
              badge="Playlist"
              href={pl.tracks?.length ? undefined : `/playlists/${pl.id}`}
              onPlay={pl.tracks?.length ? () => usePlayerStore.getState().playQueue(pl.tracks, 0) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
