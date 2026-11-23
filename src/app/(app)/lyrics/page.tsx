"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { LyricsView } from "@/components/shell/LyricsQueue";
import { usePlayerStore } from "@/lib/store/player";
import Artwork from "@/components/ui/Artwork";
import { EmptyState } from "@/components/ui/skeletons";
import { formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   LYRICS PAGE — full lyrics with a docked transport card that is
   ALWAYS visible (no scrolling needed). The chevron at the top
   dives back to Now Playing, like collapsing the player.
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

  if (!current) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          title="No lyrics yet"
          description="Lyrics appear here for whatever you are playing."
          action={
            <button type="button" onClick={() => router.push("/now-playing")} className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">
              Open Now Playing
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-13rem)] flex-col animate-fade-in">
      {/* Down chevron — the same collapse control as Now Playing; tapping
          it dives back to the Now Playing view. */}
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push("/now-playing")}
          aria-label="Back to Now Playing"
          className="grid size-9 place-items-center rounded-full bg-card text-ink shadow-lg ring-1 ring-white/5 transition hover:scale-105 active:scale-95"
        >
          <ChevronDown className="size-5" />
        </button>
        <h1 className="text-xl font-extrabold tracking-tight text-ink md:text-2xl">Lyrics</h1>
        <span className="size-9" aria-hidden />
      </header>

      <LyricsView className="max-h-none flex-1" />

      {/* Docked transport — sticky, so it never leaves the viewport. */}
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 mt-4 rounded-2xl bg-card/95 shadow-2xl shadow-black/60 ring-1 ring-white/8 backdrop-blur-xl md:bottom-4">
        <div className="flex items-center gap-3 px-4 pt-3">
          <Artwork src={current.artwork} seed={current.id} alt="" className="size-9 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold leading-tight text-ink">{current.title}</p>
            <p className="truncate text-[11px] leading-tight text-muted">{busy ? "Finding best source…" : current.artist}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1 px-4 pt-2">
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
        <div className="flex items-center justify-center gap-7 pb-3 pt-1.5">
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
            {busy ? (
              <span className="size-5 animate-spin rounded-full border-2 border-bg border-b-transparent" />
            ) : isPlaying ? (
              <Pause className="size-7 fill-current" />
            ) : (
              <Play className="ml-0.5 size-7 fill-current" />
            )}
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
    </div>
  );
}
