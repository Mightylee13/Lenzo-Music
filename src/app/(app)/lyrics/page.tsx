"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { LyricsView } from "@/components/shell/LyricsQueue";
import { usePlayerStore } from "@/lib/store/player";
import Artwork from "@/components/ui/Artwork";
import { EmptyState } from "@/components/ui/skeletons";
import { formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   LYRICS PAGE — the full lyrics for whatever is playing, with a
   down-arrow back to Now Playing and its own transport bar
   (seek, prev/next, play/pause), Spotify style.
   ============================================================ */

export default function LyricsPage() {
  const router = useRouter();
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const busy = usePlayerStore((s) => s.status === "resolving");

  // Range inputs need a number that never exceeds max while streaming
  // durations still settle.
  const max = Math.max(duration, progress, 1);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shown = scrubbing ?? progress;

  // Keep the scrub bar in sync once the streaming duration lands.
  useEffect(() => setScrubbing(null), [duration]);

  return (
    <div className="flex min-h-[calc(100vh-11rem)] flex-col gap-6 animate-fade-in">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (history.length > 1 ? router.back() : router.push("/"))}
            aria-label="Go back"
            className="grid size-9 place-items-center rounded-full border border-hairline bg-card text-muted transition hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </button>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Lyrics</h1>
        </div>
        {/* Down arrow → back to the Now Playing page */}
        <button
          type="button"
          onClick={() => router.push("/now-playing")}
          aria-label="Back to Now Playing"
          className="flex items-center gap-1.5 rounded-pill bg-card px-3.5 py-2 text-xs font-bold text-muted ring-1 ring-white/5 transition hover:text-ink"
        >
          Now playing
          <ChevronDown className="size-4" />
        </button>
      </header>

      {current ? (
        <>
          <div className="flex items-center gap-4">
            <Artwork src={current.artwork} seed={current.id} alt={current.title} className="size-16 shrink-0 rounded-xl shadow-lg shadow-black/40 md:size-20" />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{current.title}</p>
              <p className="truncate text-sm text-muted">{busy ? "Finding best source…" : current.artist}</p>
            </div>
          </div>

          <LyricsView className="max-h-none flex-1" />

          {/* Transport — same controls as Now Playing, so you can drive
              the song while reading the lyrics. */}
          <div className="sticky bottom-0 rounded-t-2xl bg-gradient-to-t from-bg via-bg/95 to-bg/80 pb-[max(8px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className="flex flex-col gap-2 px-1">
              <input
                type="range"
                min={0}
                max={max}
                step={0.1}
                value={shown}
                aria-label="Seek"
                onChange={(e) => setScrubbing(Number(e.target.value))}
                onPointerUp={() => {
                  if (scrubbing !== null) usePlayerStore.getState().seek(scrubbing);
                  setScrubbing(null);
                }}
                onTouchEnd={() => {
                  if (scrubbing !== null) usePlayerStore.getState().seek(scrubbing);
                  setScrubbing(null);
                }}
                onMouseUp={() => {
                  if (scrubbing !== null) usePlayerStore.getState().seek(scrubbing);
                  setScrubbing(null);
                }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#398CFF]"
              />
              <div className="flex justify-between text-[10px] tabular-nums text-faint">
                <span>{formatDuration(shown)}</span>
                <span>{duration > 0 ? formatDuration(duration) : "—"}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-center gap-7">
              <button
                type="button"
                aria-label="Previous"
                onClick={() => usePlayerStore.getState().prev()}
                className="grid size-11 place-items-center rounded-full text-ink transition hover:bg-white/8 active:scale-95"
              >
                <SkipBack className="size-5 fill-current" />
              </button>
              <button
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                onClick={() => usePlayerStore.getState().toggle()}
                className="grid size-14 place-items-center rounded-full bg-white text-bg shadow-xl transition hover:scale-[1.03] active:scale-95"
              >
                {isPlaying ? <Pause className="size-7 fill-current" /> : <Play className="ml-0.5 size-7 fill-current" />}
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={() => usePlayerStore.getState().next()}
                className="grid size-11 place-items-center rounded-full text-ink transition hover:bg-white/8 active:scale-95"
              >
                <SkipForward className="size-5 fill-current" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          title="No lyrics yet"
          description="Lyrics appear here for whatever you are playing."
          action={
            <button type="button" onClick={() => router.push("/now-playing")} className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">
              Open Now Playing
            </button>
          }
        />
      )}
    </div>
  );
}
