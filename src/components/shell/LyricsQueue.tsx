"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, GripVertical, Trash2, X } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { apiSend, formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   LYRICS + QUEUE views — shared by the desktop right panel,
   the full-screen player and standalone /lyrics + /queue pages.
   Lyrics come from the provider only (ytmp3 payload). A soft
   LRC/timestamp parser highlights and scrolls the current line.
   ============================================================ */

interface LyricLine {
  time: number;
  text: string;
}

export function parseLyrics(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // LRC lines may carry multiple timestamps: [00:12.00][00:40.00] text
    const stamp = line.match(/^\s*((?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/);
    if (stamp) {
      const text = stamp[2].trim();
      const timeRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
      let t: RegExpExecArray | null;
      while ((t = timeRe.exec(stamp[1]))) {
        const time = Number(t[1]) * 60 + Number(t[2]) + (t[3] ? Number(`0.${t[3]}`) : 0);
        lines.push({ time, text });
      }
    } else if (line.trim()) {
      lines.push({ time: -1, text: line.trim() });
    }
  }
  return lines;
}

export function LyricsView({ className = "", variant = "panel" }: { className?: string; variant?: "panel" | "overlay" }) {
  const overlay = variant === "overlay";
  const current = usePlayerStore((s) => s.current);
  const lyrics = usePlayerStore((s) => s.lyrics);
  const progress = usePlayerStore((s) => s.progress);
  const container = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLParagraphElement | null>(null);
  const lookupAttempts = useRef<Set<string>>(new Set());
  const [lookupDone, setLookupDone] = useState(false);

  // One synced-lyrics lookup per track. Applies LRCLIB synced/plain lyrics
  // even over embedded plain provider lyrics, so songs resolved through
  // sources without timing still get a synced version when one exists.
  useEffect(() => {
    setLookupDone(false);
  }, [current?.id]);

  useEffect(() => {
    if (!current || lookupDone) return;
    if (lookupAttempts.current.has(current.id)) {
      if (lookupAttempts.current.has(`done:${current.id}`)) setLookupDone(true);
      return;
    }
    lookupAttempts.current.add(current.id);
    const trackId = current.id;
    const q = `/api/music/lyrics?title=${encodeURIComponent(current.title)}&artist=${encodeURIComponent(
      current.artist,
    )}${current.duration ? `&duration=${Math.round(current.duration)}` : ""}`;
    // No AbortController/cleanup on purpose: StrictMode remounts this effect
    // in dev and the in-flight attempt must survive the first unmount.
    fetch(q, { signal: AbortSignal.timeout(60000) })
      .then((r) => r.json())
      .then((data: { synced?: string | null; plain?: string | null }) => {
        const state = usePlayerStore.getState();
        if (state.current?.id !== trackId) return;
        const synced = typeof data?.synced === "string" && data.synced.trim().length > 20 ? data.synced : null;
        const plain = typeof data?.plain === "string" && data.plain.trim().length > 20 ? data.plain : null;
        const chosen = synced ?? plain;
        if (chosen && chosen !== state.lyrics) state.setLyrics(chosen);
      })
      .catch(() => undefined)
      .finally(() => {
        lookupAttempts.current.add(`done:${trackId}`);
        setLookupDone(true);
      });
  }, [current?.id, current?.title, current?.artist, current?.duration, lookupDone]);

  const lines = useMemo(() => parseLyrics(lyrics ?? ""), [lyrics]);
  const timed = lines.some((l) => l.time >= 0);
  const activeIndex = useMemo(() => {
    if (!timed) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time >= 0 && lines[i].time <= progress + 0.2) idx = i;
      else if (lines[i].time > progress) break;
    }
    return idx;
  }, [lines, progress, timed]);

  // Pause auto-scroll for a few seconds after the user scrolls manually,
  // so reading ahead isn't yanked back to the active line.
  const userScrollUntil = useRef(0);
  const handleUserScroll = useCallback(() => {
    userScrollUntil.current = Date.now() + 5000;
  }, []);

  useEffect(() => {
    const el = activeRef.current;
    const box = container.current;
    if (el && box && activeIndex >= 0 && Date.now() >= userScrollUntil.current) {
      box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.35, behavior: "smooth" });
    }
  }, [activeIndex]);

  if (!current) {
    return <p className={`px-4 py-8 text-center text-sm text-muted ${className}`}>Play something to see its lyrics here.</p>;
  }
  if (!lyrics) {
    const finished = current && lookupAttempts.current.has(`done:${current.id}`);
    return (
      <p className={`px-4 py-8 text-center text-sm ${overlay ? "text-white/70" : "text-muted"} ${className}`}>
        {finished
          ? "Lyrics are not available for this track — the providers do not carry them."
          : "Looking up lyrics…"}
      </p>
    );
  }

  return (
    <div ref={container} onWheel={handleUserScroll} onTouchStart={handleUserScroll} onPointerDown={handleUserScroll} className={`scrollbar-thin overflow-y-auto px-4 py-4 ${className}`}>
      <div className="flex flex-col gap-3">
        {lines.map((line, i) => {
          const active = i === activeIndex;
          const near = timed && activeIndex >= 0 && i > activeIndex && i <= activeIndex + 3;
          const tone = overlay
            ? active
              ? "text-white"
              : near
                ? "text-white/75"
                : "text-white/35"
            : active
              ? "text-cyan scale-[1.01]"
              : near
                ? "text-ink/80"
                : "text-muted/55";
          return (
            <p
              key={i}
              ref={active ? activeRef : null}
              onClick={() => {
                // Spotify behaviour: tap a lyric line to jump the song there
                // (panel + full-page modes; the artwork overlay opens the
                // full page instead, so its lines stay non-interactive).
                if (!overlay && line.time >= 0) {
                  const st = usePlayerStore.getState();
                  st.seek(line.time);
                  if (!st.isPlaying) st.resume();
                }
              }}
              className={`text-[15px] font-bold leading-snug transition-all duration-300 ${tone}${!overlay && line.time >= 0 ? " cursor-pointer hover:text-ink hover:opacity-100" : ""}`}
            >
              {line.text || "\u00A0"}
            </p>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Exactly the line being sung — rendered over the artwork as a single
 * bold line (Spotify's current-line card instead of a text block).
 */
export function ActiveLyricLine({ className = "" }: { className?: string }) {
  const current = usePlayerStore((s) => s.current);
  const lyrics = usePlayerStore((s) => s.lyrics);
  const progress = usePlayerStore((s) => s.progress);

  const activeText = useMemo(() => {
    const lines = parseLyrics(lyrics ?? "");
    if (!lines.length || !lines.some((l) => l.time >= 0)) return null;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time >= 0 && lines[i].time <= progress + 0.2) idx = i;
      else if (lines[i].time > progress) break;
    }
    if (idx === -1) return null;
    const text = lines[idx].text.trim();
    return text ? text : null;
  }, [lyrics, progress, current?.id]);

  if (!activeText) return null;
  return (
    <p className={`animate-fade-in text-lg font-extrabold leading-snug text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ${className}`}>
      {activeText}
    </p>
  );
}

/* ------------------------------------------------------------------ */

export function QueueView({ onClose, standalone = false }: { onClose?: () => void; standalone?: boolean }) {
  const session = useSession();
  const store = usePlayerStore.getState();
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);

  if (!current && queue.length === 0) {
    return (
      <p className={`px-4 py-8 text-center text-sm text-muted ${standalone ? "" : ""}`}>
        Your queue is empty. Play a song or an album to start a queue.
      </p>
    );
  }

  const upcoming = queue.slice(index + 1);

  const saveQueueAsPlaylist = async () => {
    if (!session.user) {
      useUi.getState().showToast("Sign in to save queues as playlists", "error");
      return;
    }
    try {
      const result = await apiSend<{ playlist: { id: string } }>("/api/playlists", "POST", {
        name: `Queue · ${new Date().toLocaleDateString()}`,
      });
      for (const t of queue) {
        await apiSend(`/api/playlists/${result.playlist.id}`, "PATCH", {
          op: "add-tracks",
          patch: { track: t },
        });
      }
      useUi.getState().showToast("Queue saved as playlist", "success");
    } catch {
      useUi.getState().showToast("Could not save queue", "error");
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          {upcoming.length ? `${upcoming.length} in queue` : "Queue"}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={saveQueueAsPlaylist}
            aria-label="Save queue as playlist"
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-ink"
          >
            <ArrowDownToLine className="size-4 rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Clear queue"
            onClick={() => store.clearQueue()}
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-danger"
          >
            <Trash2 className="size-4" />
          </button>
          {onClose && (
            <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-ink">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Currently playing */}
      {current && (
        <div className="px-3 pb-2">
          <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Now playing</p>
          <QueueRow track={current} active />
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="px-3 pb-4">
          <p className="px-1 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Next up</p>
          <div className="flex flex-col">
            {upcoming.map((t, i) => (
              <QueueRow key={`${t.id}-${i}`} track={t} queueIndex={index + 1 + i} />
            ))}
          </div>
        </div>
      )}

      {!upcoming.length && current && (
        <p className="px-4 pb-6 text-xs text-faint">Nothing lined up next. Turn on autoplay radio or add songs from any page.</p>
      )}
    </div>
  );
}

function QueueRow({ track, queueIndex, active }: { track: import("@/types").Track; queueIndex?: number; active?: boolean }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveQueue = usePlayerStore((s) => s.moveQueue);

  return (
    <div className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-white/5">
      <span className="hidden cursor-grab text-faint group-hover:block" aria-hidden>
        <GripVertical className="size-4" />
      </span>
      <button type="button" onClick={() => queueIndex !== undefined && playTrack(track, usePlayerStore.getState().queue)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <Artwork src={track.artwork} seed={track.id} label={track.title} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold ${active ? "text-cyan" : "text-ink"}`}>{track.title}</span>
          <span className="block truncate text-xs text-muted">{track.artist}</span>
        </span>
      </button>
      <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatDuration(track.duration)}</span>
      {queueIndex !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${track.title} from queue`}
          onClick={() => removeFromQueue(queueIndex)}
          className="grid size-7 shrink-0 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
