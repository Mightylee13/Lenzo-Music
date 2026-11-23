"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Heart,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   BOTTOM PLAYER — persistent desktop playback bar.
   ============================================================ */

export default function BottomPlayer() {
  const current = usePlayerStore((s) => s.current);
  const resolved = usePlayerStore((s) => s.resolved);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);

  const store = usePlayerStore.getState();
  const session = useSession();
  const ui = useUi.getState();
  const rightPanel = useUi((s) => s.rightPanelVisible);
  const pathname = usePathname();

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const busy = status === "resolving";

  // The lyrics page has its own always-visible transport dock.
  if (!current || pathname === "/lyrics") return null;

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <footer className="relative z-40 hidden h-[84px] shrink-0 items-center gap-4 border-t border-hairline glass px-4 pb-[env(safe-area-inset-bottom)] md:flex">
      {/* Track info */}
      <div className="flex min-w-0 items-center gap-3 lg:w-[26%]">
        <button
          type="button"
          onClick={() => !rightPanel && useUi.getState().toggleRightPanel()}
          aria-label="Open now playing"
          className="shrink-0"
        >
          <Artwork src={resolved?.artwork ?? current.artwork} seed={current.id} label={current.title} alt="" className="size-14 rounded-lg object-cover" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{current.title}</p>
          <p className="truncate text-xs text-muted">
            {current.artistId ? (
              <Link href={`/artists/${current.artistId}`} className="hover:text-ink hover:underline">{current.artist}</Link>
            ) : (
              current.artist
            )}
          </p>
          {busy && <p className="truncate text-[10px] font-semibold text-cyan">Finding the best source…</p>}
          {error && !busy && <p className="truncate text-[10px] text-warning">{error}</p>}
        </div>
        {session.user && (
          <button
            type="button"
            aria-label="Like"
            onClick={async () => {
              try {
                await session.toggleLike(current);
              } catch (err) {
                ui.showToast(err instanceof Error ? err.message : "Failed", "error");
              }
            }}
            className={`ml-1 hidden size-8 place-items-center rounded-full hover:bg-white/8 lg:grid ${session.isLiked(current.id) ? "text-danger" : "text-muted"}`}
          >
            <Heart className={`size-4 ${session.isLiked(current.id) ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {/* Transport + progress */}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Shuffle"
            onClick={store.toggleShuffle}
            className={`grid size-8 place-items-center rounded-full transition-colors hover:bg-white/8 ${shuffle ? "text-cyan" : "text-muted"}`}
          >
            <Shuffle className="size-4" />
          </button>
          <button type="button" aria-label="Previous" onClick={store.prev} className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-ink">
            <SkipBack className="size-5 fill-current" />
          </button>
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={store.toggle}
            className="grid size-11 place-items-center rounded-full bg-white text-bg shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            {busy ? (
              <span className="size-4 animate-spin rounded-full border-2 border-bg border-b-transparent" />
            ) : isPlaying ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" />
            )}
          </button>
          <button type="button" aria-label="Next" onClick={() => store.next()} className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-ink">
            <SkipForward className="size-5 fill-current" />
          </button>
          <button
            type="button"
            aria-label={`Repeat: ${repeat}`}
            onClick={store.cycleRepeat}
            className={`grid size-8 place-items-center rounded-full transition-colors hover:bg-white/8 ${repeat !== "off" ? "text-cyan" : "text-muted"}`}
          >
            <RepeatIcon className="size-4" />
          </button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-2">
          <span className="w-9 text-right text-[10px] tabular-nums text-faint">{formatDuration(progress)}</span>
          <input
            type="range"
            aria-label="Seek"
            className="bw-range h-3 min-w-0 flex-1"
            style={{ ["--range-progress" as string]: `${pct}%` }}
            value={progress}
            max={duration || 1}
            onChange={(e) => store.seek(Number(e.target.value))}
            onMouseDown={() => usePlayerStore.setState({ seeking: true })}
          />
          <span className="w-9 text-[10px] tabular-nums text-faint">{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Right controls */}
      <div className="hidden items-center justify-end gap-1.5 lg:flex lg:w-[26%]">
        <button
          type="button"
          aria-label="Lyrics"
          onClick={() => {
            if (!rightPanel) useUi.getState().toggleRightPanel();
            store.setPanelTab("lyrics");
          }}
          className={`grid size-8 place-items-center rounded-full hover:bg-white/8 ${store.panelTab === "lyrics" ? "text-cyan" : "text-muted"}`}
        >
          <Mic2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Queue"
          onClick={() => {
            if (!rightPanel) useUi.getState().toggleRightPanel();
            store.setPanelTab("queue");
          }}
          className={`grid size-8 place-items-center rounded-full hover:bg-white/8 ${store.panelTab === "queue" ? "text-cyan" : "text-muted"}`}
        >
          <ListMusic className="size-4" />
        </button>
        <button type="button" aria-label="Mute" onClick={store.toggleMute} className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-ink">
          <VolumeIcon className="size-4" />
        </button>
        <input
          type="range"
          aria-label="Volume"
          className="bw-range h-3 w-24"
          style={{ ["--range-progress" as string]: `${(muted ? 0 : volume) * 100}%` }}
          value={muted ? 0 : volume}
          max={1}
          step={0.01}
          onChange={(e) => store.setVolume(Number(e.target.value))}
        />
      </div>
    </footer>
  );
}
