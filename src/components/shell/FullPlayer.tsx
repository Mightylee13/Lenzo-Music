"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Maximize2,
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
  X,
} from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { LyricsView, QueueView } from "@/components/shell/LyricsQueue";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   FULL-SCREEN PLAYER — Spotify-style now-playing: large centred
   artwork, title row with save action, thin seek bar, classic
   transport order, and synced lyrics as a scrim over the artwork
   (tap to open the full lyrics page). The artwork only goes to
   the full lyrics page, never on any toggle.
   ============================================================ */

type Overlay = "lyrics" | "queue" | null;
type FullView = "lyrics" | "queue" | null;

export default function FullPlayer() {
  const expanded = usePlayerStore((s) => s.expanded);
  const [overlay, setOverlay] = useState<Overlay>("lyrics");
  const [fullView, setFullView] = useState<FullView>(null);

  if (!expanded) return null;

  return <Expanded overlay={overlay} setOverlay={setOverlay} fullView={fullView} setFullView={setFullView} />;
}

function Expanded({
  overlay,
  setOverlay,
  fullView,
  setFullView,
}: {
  overlay: Overlay;
  setOverlay: (v: Overlay) => void;
  fullView: FullView;
  setFullView: (v: FullView) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
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
  const busy = status === "resolving";

  const store = usePlayerStore.getState();
  const session = useSession();
  const [drawerTab, setDrawerTab] = useState<"now" | "lyrics" | "queue">("lyrics");

  if (!current) return null;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const artworkSrc = resolved?.artwork ?? current.artwork;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-bg md:rounded-none">
      {/* Blurred artwork backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <img src={artworkSrc} alt="" aria-hidden className="size-full scale-150 object-cover opacity-25 blur-3xl saturate-150" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-1 pt-[max(12px,env(safe-area-inset-top))]">
        <button
          type="button"
          aria-label={pathname === "/now-playing" ? "Back to home" : "Collapse player"}
          onClick={() => {
            if (pathname === "/now-playing") router.back();
            else usePlayerStore.getState().setExpanded(false);
          }}
          className="grid size-10 place-items-center rounded-full text-ink hover:bg-white/8"
        >
          <ChevronDown className="size-6" />
        </button>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Now playing</p>
        <button
          type="button"
          aria-label="Save to downloads"
          onClick={async () => {
            const wasDownloaded = session.isDownloaded(current.id);
            try {
              await session.toggleDownload(current);
              useUi.getState().showToast(wasDownloaded ? "Removed from downloads" : "Saved offline", "success");
            } catch (err) {
              useUi.getState().showToast(err instanceof Error ? err.message : "Failed", "error");
            }
          }}
          className={`grid size-10 place-items-center rounded-full hover:bg-white/8 ${session.isDownloaded(current.id) ? "text-cyan" : "text-muted"}`}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-3 px-5 pb-[max(14px,env(safe-area-inset-bottom))] md:flex-row md:items-stretch md:gap-8 md:px-10">
        {/* Cover + lyrics-over-artwork, Spotify style */}
        <div className="relative w-full flex-1 min-h-0 md:aspect-square md:w-full md:max-w-sm md:flex-none md:self-center">
          <Artwork
            src={artworkSrc}
            seed={current.id}
            label={current.title}
            alt={`${current.title} artwork`}
            className="absolute inset-0 size-full rounded-lg object-cover shadow-2xl shadow-black/60"
            loading="eager"
          />
          {busy && (
            <span className="absolute left-3 top-3 z-10 rounded-full glass-strong px-2.5 py-1 text-[10px] font-bold text-cyan">
              Finding best source…
            </span>
          )}

          {/* Lyrics scrim (mobile) — karaoke-style over the artwork */}
          {overlay === "lyrics" && (
            <button
              type="button"
              aria-label="Open full lyrics"
              onClick={() => setFullView("lyrics")}
              className="absolute inset-0 z-0 flex flex-col overflow-hidden rounded-lg text-left"
            >
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />
              <LyricsView variant="overlay" className="relative z-10 mt-auto min-h-0 [&>div]:!gap-1.5 [&_p]:!text-[13px]" />
              <span className="relative z-10 flex items-center gap-1 px-4 pb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
                <Maximize2 className="size-3" /> Full lyrics
              </span>
            </button>
          )}

          {/* Queue overlay (mobile) — same slot, compact sheet */}
          {overlay === "queue" && (
            <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[62%] flex-col overflow-hidden rounded-lg bg-black/55 backdrop-blur-md ring-1 ring-white/10">
              <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Queue</p>
                <div className="flex items-center gap-0.5">
                  <button type="button" aria-label="Full queue page" onClick={() => setFullView("queue")} className="grid size-7 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-ink">
                    <Maximize2 className="size-3.5" />
                  </button>
                  <button type="button" aria-label="Hide queue" onClick={() => setOverlay(null)} className="grid size-7 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-ink">
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                <QueueView />
              </div>
            </div>
          )}

          {/* Show lyrics chip when hidden */}
          {overlay === null && (
            <button
              type="button"
              onClick={() => setOverlay("lyrics")}
              className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-pill bg-black/55 px-4 py-2 text-xs font-bold text-ink backdrop-blur-md hover:bg-black/70"
            >
              <Mic2 className="size-3.5" /> Show lyrics
            </button>
          )}
        </div>

        {/* Title, progress, transport */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-3 md:min-h-0 md:flex-1 md:flex-none md:self-center">
          {/* Title row — Spotify puts the save action on the right */}
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-left md:text-center">
              <h2 className="truncate text-lg font-extrabold tracking-tight text-ink md:text-xl">
                {current.title}
                {current.explicit && <span className="ml-1.5 rounded bg-white/10 px-1 text-[10px] font-bold text-muted">E</span>}
              </h2>
              <p className="truncate text-sm text-muted">{current.artist}</p>
            </div>
            {session.user && (
              <button
                type="button"
                aria-label="Like"
                onClick={() => void session.toggleLike(current).catch((err: Error) => useUi.getState().showToast(err.message, "error"))}
                className={`grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/8 ${session.isLiked(current.id) ? "text-cyan" : "text-muted"}`}
              >
                <Heart className={`size-5 ${session.isLiked(current.id) ? "fill-current" : ""}`} />
              </button>
            )}
          </div>

          {/* Progress */}
          <div className="w-full">
            <input
              type="range"
              aria-label="Seek"
              className="bw-range h-3 w-full"
              style={{ ["--range-progress" as string]: `${pct}%` }}
              value={progress}
              max={duration || 1}
              onChange={(e) => store.seek(Number(e.target.value))}
              onMouseDown={() => usePlayerStore.setState({ seeking: true })}
            />
            <div className="flex justify-between text-[10px] tabular-nums text-faint">
              <span>{formatDuration(progress)}</span>
              <span>{formatDuration(Math.max(0, duration - progress))}</span>
            </div>
          </div>

          {/* Transport */}
          <div className="flex w-full items-center justify-between">
            <button
              type="button"
              aria-label="Shuffle"
              onClick={store.toggleShuffle}
              className={`grid size-10 place-items-center rounded-full hover:bg-white/8 ${shuffle ? "text-cyan" : "text-muted"}`}
            >
              <Shuffle className="size-5" />
            </button>
            <button type="button" aria-label="Previous" onClick={store.prev} className="grid size-12 place-items-center rounded-full text-ink active:scale-95">
              <SkipBack className="size-7 fill-current" />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={store.toggle}
              className="grid size-16 place-items-center rounded-full bg-white text-bg shadow-xl transition-transform hover:scale-105 active:scale-95"
            >
              {busy ? (
                <span className="size-6 animate-spin rounded-full border-[3px] border-bg border-b-transparent" />
              ) : isPlaying ? (
                <Pause className="ml-0.5 size-7 fill-current" />
              ) : (
                <Play className="ml-1 size-7 fill-current" />
              )}
            </button>
            <button type="button" aria-label="Next" onClick={() => store.next()} className="grid size-12 place-items-center rounded-full text-ink active:scale-95">
              <SkipForward className="size-7" />
            </button>
            <button
              type="button"
              aria-label={`Repeat: ${repeat}`}
              onClick={store.cycleRepeat}
              className={`grid size-10 place-items-center rounded-full hover:bg-white/8 ${repeat !== "off" ? "text-cyan" : "text-muted"}`}
            >
              <RepeatIcon className="size-5" />
            </button>
          </div>

          {/* Bottom utility row — Spotify-style small icons */}
          <div className="flex w-full items-center justify-between">
            <button type="button" aria-label="Mute" onClick={store.toggleMute} className="grid size-9 place-items-center rounded-full text-muted hover:text-ink">
              <VolumeIcon className="size-4.5" />
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOverlay(overlay === "lyrics" ? null : "lyrics")}
                aria-label="Toggle lyrics"
                className={`grid size-9 place-items-center rounded-full hover:bg-white/8 ${overlay === "lyrics" ? "text-cyan" : "text-muted"}`}
              >
                <Mic2 className="size-4.5" />
              </button>
              <button
                type="button"
                onClick={() => setOverlay(overlay === "queue" ? null : "queue")}
                aria-label="Toggle queue"
                className={`grid size-9 place-items-center rounded-full hover:bg-white/8 ${overlay === "queue" ? "text-cyan" : "text-muted"}`}
              >
                <ListMusic className="size-4.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Desktop-only: lyrics / queue / about drawer */}
        <div className="hidden md:flex md:min-h-0 md:flex-1 flex-col rounded-2xl border border-white/8 bg-white/3 md:max-w-md">
          <div className="flex items-center gap-1 border-b border-white/6 px-2.5 py-2">
            {(["now", "lyrics", "queue"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDrawerTab(t)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  drawerTab === t ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {t === "lyrics" && <Mic2 className="size-3.5" />}
                {t === "queue" && <ListMusic className="size-3.5" />}
                {t === "now" && "About"}
                {t === "lyrics" && "Lyrics"}
                {t === "queue" && "Queue"}
              </button>
            ))}
            {drawerTab === "lyrics" && (
              <button type="button" aria-label="Full lyrics page" onClick={() => setFullView("lyrics")} className="ml-auto grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-ink">
                <Maximize2 className="size-4" />
              </button>
            )}
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {drawerTab === "now" && (
              <div className="flex flex-col gap-2 p-4 text-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Playback</p>
                <p className="text-ink">Full-track streaming{resolved?.quality ? ` · ${resolved.quality}` : " · MP3"}</p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Keyboard</p>
                <p className="text-muted">Space play/pause · ←/→ seek · ↑/↓ volume · M mute · S shuffle · R repeat</p>
              </div>
            )}
            {drawerTab === "lyrics" && <LyricsView />}
            {drawerTab === "queue" && <QueueView />}
          </div>
        </div>
      </div>

      {/* Full lyrics / queue page — covers the whole player incl. artwork */}
      {fullView && (
        <div className="absolute inset-0 z-20 flex flex-col bg-bg/70 backdrop-blur-2xl">
          <div className="flex items-center justify-between px-4 pb-1 pt-[max(12px,env(safe-area-inset-top))]">
            <button type="button" aria-label="Close full view" onClick={() => setFullView(null)} className="grid size-10 place-items-center rounded-full text-ink hover:bg-white/8">
              <ChevronDown className="size-6" />
            </button>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
              {fullView === "lyrics" ? "Lyrics" : "Queue"}
            </p>
            <span className="size-10" />
          </div>
          {fullView === "lyrics" && (
            /* Spotify shows a small artwork card above the lyrics */
            <div className="mx-auto flex w-full items-center gap-3 px-5 pb-2 md:max-w-2xl">
              <Artwork src={artworkSrc} seed={current.id} label={current.title} alt="" className="size-14 shrink-0 rounded-md object-cover shadow-lg shadow-black/40" />
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-ink">{current.title}</p>
                <p className="truncate text-xs text-muted">{current.artist}</p>
              </div>
            </div>
          )}
          <div className={`scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-[max(16px,env(safe-area-inset-bottom))] ${fullView === "lyrics" ? "md:px-6 [&_p]:!text-xl md:[&_p]:!text-2xl [&_p]:!leading-snug" : ""}`}>
            {fullView === "lyrics" ? <LyricsView variant="overlay" className="md:mx-auto md:max-w-2xl" /> : <QueueView standalone />}
          </div>
        </div>
      )}
    </div>
  );
}
