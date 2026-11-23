"use client";

import { ChevronLeft, Shuffle } from "lucide-react";
import Link from "next/link";
import { GenreGrid } from "@/app/(app)/search/page";
import TrackList from "@/components/tracks/TrackList";
import MediaCard from "@/components/ui/MediaCard";
import { ErrorState, TrackListSkeleton } from "@/components/ui/skeletons";
import { useApi } from "@/lib/client/hooks";
import { usePlayerStore } from "@/lib/store/player";
import type { Track } from "@/types";

/* ============================================================
   EXPLORE — genre & mood collections. `/explore` shows the grid;
   `/explore/[genre]` shows a deep-dive with curated tracks.
   ============================================================ */

export default function ExplorePage() {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Explore</h1>
        <p className="mt-1 text-sm text-muted">Genres, moods and curated collections — tap any card to dive in.</p>
      </header>
      <GenreGrid />
    </div>
  );
}

export function ExploreGenre({ genreId }: { genreId: string }) {
  // One merged catalogue — no provider tabs.
  const data = useApi<{ results: { tracks: Track[] } }>(
    `/api/music/search?q=${encodeURIComponent(`${genreId} songs`)}&limit=50`
  );

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <button type="button" onClick={() => history.back()} className="flex w-fit items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
        <ChevronLeft className="size-4" /> All genres
      </button>

      <header className="rounded-2xl surface-gradient border border-white/8 p-6 shadow-xl shadow-black/40 md:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Collection</p>
        <h1 className="mt-1 text-3xl font-extrabold capitalize tracking-tight text-ink md:text-4xl">{genreId.replace(/-/g, " ")}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!data.data?.results.tracks.length}
            onClick={() => data.data && usePlayerStore.getState().playQueue(data.data.results.tracks, 0)}
            className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-brand/30 transition hover:bg-cyan disabled:opacity-40"
          >
            Play collection
          </button>
          <button
            type="button"
            disabled={!data.data?.results.tracks.length}
            onClick={() => {
              const store = usePlayerStore.getState();
              store.setShuffle(true);
              const tracks = [...(data.data?.results.tracks ?? [])];
              if (tracks.length) {
                const i = Math.floor(Math.random() * tracks.length);
                store.playQueue(tracks, i);
              }
            }}
            className="flex items-center gap-1.5 rounded-pill border border-hairline px-5 py-2.5 text-xs font-bold text-ink transition hover:bg-white/6 disabled:opacity-40"
          >
            <Shuffle className="size-3.5" /> Shuffle
          </button>
        </div>
      </header>

      {data.loading && <TrackListSkeleton count={10} />}
      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
      {data.data?.results.tracks && <TrackList tracks={data.data.results.tracks} showIndex />}
    </div>
  );
}

export { MediaCard };
