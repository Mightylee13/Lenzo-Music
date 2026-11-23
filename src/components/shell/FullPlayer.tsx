"use client";

import { useRef, useState } from "react";
import Link from "next/link";
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
import { ActiveLyricLine, LyricsView, QueueView } from "@/components/shell/LyricsQueue";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { formatDuration } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { slug } from "@/lib/api/normalizers";
import type { Track } from "@/types";

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
  const lyricsAnchor = useRef<HTMLDivElement | null>(null);

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

      {/* Everything scrolls vertically on mobile: artwork → controls →
          lyrics → about the artist → explore more. Desktop keeps the
          side-by-side layout. */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-[max(24px,env(safe-area-inset-bottom))]">
      <div className="flex min-h-full flex-col gap-3 md:flex-row md:items-stretch md:gap-8 md:px-5">
        {/* Cover + lyrics-over-artwork, Spotify style */}
        <div className="relative aspect-square w-full shrink-0 self-center md:max-w-sm md:flex-none">
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

          {/* Lyrics scrim (mobile) — ONLY the line being sung, big and
              readable over the artwork; tap scrolls down to the full lyrics
              section. */}
          {overlay === "lyrics" && (
            <button
              type="button"
              aria-label="Scroll to lyrics"
              onClick={() => lyricsAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="absolute inset-0 z-0 flex flex-col justify-end overflow-hidden rounded-lg text-left"
            >
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
              <ActiveLyricLine className="relative z-10 px-4 pb-6" />
              <span className="relative z-10 flex items-center gap-1 px-4 pb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
                <Mic2 className="size-3" /> Lyrics
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

        {/* ---- Mobile-only scroll sections ---- */}
        <div className="flex flex-col gap-10 pb-6 md:hidden">
          {/* Lyrics — short preview here (tap a line to seek); the button
              opens the full lyrics page, which has its own transport. */}
          <section ref={lyricsAnchor} className="scroll-mt-20">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-ink">Lyrics</h3>
              <button
                type="button"
                onClick={() => router.push("/lyrics")}
                className="flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-muted hover:bg-white/8 hover:text-ink"
              >
                Show lyrics
                <ChevronDown className="size-3.5 rotate-[-90deg]" aria-hidden />
              </button>
            </div>
            <div className="relative max-h-64 overflow-hidden rounded-2xl border border-white/8 bg-white/4">
              <LyricsView variant="panel" className="max-h-64 rounded-2xl" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 rounded-b-2xl bg-gradient-to-t from-bg to-transparent" />
            </div>
          </section>

          <MobileArtistSections current={current} />
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

/* ------------------------------------------------------------------ */
/* Mobile scroll sections: about the artist + explore more             */

interface ArtistPayload {
  artist: { id: string; name: string; image?: string; source: string } | null;
  tracks: Track[];
  albums: Array<{ id: string; title: string; artwork: string; artist: string; year?: number; type?: string }>;
  related: Array<{ id: string; name: string; image?: string }>;
}

function MobileArtistSections({ current }: { current: Track }) {
  const artistName = current.artist.split(",")[0]?.trim() ?? "";
  const artistId = artistName ? `ar_${slug(artistName)}` : "";
  const data = useApi<ArtistPayload>(artistId ? `/api/music/artist/${encodeURIComponent(artistId)}` : null);

  const artist = data.data?.artist ?? null;
  const ownTracks = data.data?.tracks ?? [];
  const ownAlbums = data.data?.albums ?? [];

  if (data.loading) {
    return (
      <div className="flex flex-col gap-10">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-56 rounded-2xl" />
      </div>
    );
  }
  if (!artist && !ownTracks.length && !ownAlbums.length) return null;

  return (
    <>
      {/* About the artist */}
      <section>
        <h3 className="mb-3 text-base font-extrabold text-ink">About the artist</h3>
        <div className="flex items-center gap-4">
          {artist?.image && (
            <Artwork
              src={artist.image}
              seed={artist.id}
              label={artist.name}
              alt=""
              className="size-20 shrink-0 rounded-full object-cover shadow-lg shadow-black/40"
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-ink">{artist?.name ?? artistName}</p>
            <p className="mt-0.5 text-xs text-muted">
              {ownTracks.length > 0 && `${ownTracks.length} song${ownTracks.length === 1 ? "" : "s"} on Lenzo`}
              {ownTracks.length > 0 && ownAlbums.length > 0 && " · "}
              {ownAlbums.length > 0 && `${ownAlbums.length} release${ownAlbums.length === 1 ? "" : "s"}`}
              {!ownTracks.length && !ownAlbums.length && "Artist in your catalogue"}
            </p>
          </div>
        </div>
      </section>

      {/* Explore more from the artist */}
      {(ownTracks.length > 0 || ownAlbums.length > 0) && (
        <section>
          <h3 className="mb-3 text-base font-extrabold text-ink">Explore {artist?.name ?? artistName}</h3>
          {ownTracks.length > 0 && (
            <div className="flex flex-col">
              {ownTracks.slice(0, 8).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => usePlayerStore.getState().playTrack(t, ownTracks)}
                  className="flex items-center gap-3 rounded-xl px-1 py-1.5 text-left hover:bg-white/5"
                >
                  <Artwork src={t.artwork} seed={t.id} label={t.title} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{t.title}</span>
                    <span className="block truncate text-xs text-muted">{t.artist}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatDuration(t.duration)}</span>
                </button>
              ))}
            </div>
          )}
          {ownAlbums.length > 0 && (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1 hide-scrollbar">
              {ownAlbums.slice(0, 10).map((al) => (
                <Link key={al.id} href={`/albums/${encodeURIComponent(al.id)}`} className="group w-24 shrink-0">
                  <Artwork src={al.artwork} seed={al.id} label={al.title} alt="" className="aspect-square w-full rounded-lg object-cover shadow-md shadow-black/40" />
                  <span className="mt-1.5 block truncate text-[12px] font-semibold text-ink">{al.title}</span>
                  <span className="block truncate text-[11px] text-muted">{al.year ?? ""}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
