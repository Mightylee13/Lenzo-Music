import { create } from "zustand";
import type { RepeatMode, ResolvedAudio, Track } from "@/types";
import { useUi } from "@/lib/store/ui";

/* ============================================================
   PLAYER STORE
   ------------------------------------------------------------
   Owns the queue, playback state and the resolution pipeline.

   Playback strategy (per project requirements):
     1. The full track is resolved server-side through the
        Spotify v2 / ytmp3 converters — never a 30s preview.
     2. While resolving, the UI shows a real "loading" state.
     3. Only complete audio sources are ever handed to <audio>;
        if resolution fails, the player says so honestly.

   The single <audio> element lives in <AudioEngine/> and is handed
   to this store through `attachAudio`.
   ============================================================ */

export type PlayerStatus = "idle" | "resolving" | "ready" | "playing" | "paused" | "error";

interface PlayerState {
  queue: Track[];
  index: number;
  current: Track | null;
  resolved: ResolvedAudio | null;
  status: PlayerStatus;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;
  /** Tracks that failed to resolve (id → reason) so lists can dim them. */
  unplayable: Record<string, string>;
  lyrics: string | null;
  expanded: boolean;
  panelTab: "now" | "lyrics" | "queue";
  seeking: boolean;

  attachAudio: (el: HTMLAudioElement | null) => void;
  playQueue: (tracks: Track[], startIndex?: number) => void;
  playTrack: (track: Track, context?: Track[]) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  setShuffle: (on: boolean) => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  moveQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  saveQueueAsTracks: () => Track[];
  setExpanded: (v: boolean) => void;
  setPanelTab: (tab: "now" | "lyrics" | "queue") => void;
  setSeeking: (v: boolean) => void;
  setLyrics: (lyrics: string | null) => void;
}

let audio: HTMLAudioElement | null = null;
let resolveToken = 0;
let failureStreak = 0;
const resolvedCache = new Map<string, ResolvedAudio>();
/** Cap resolution cache so long listening sessions can't grow it unbounded. */
const RESOLVED_CACHE_MAX = 120;
function cacheResolved(trackId: string, audio: ResolvedAudio): void {
  if (resolvedCache.size >= RESOLVED_CACHE_MAX) {
    const oldest = resolvedCache.keys().next().value;
    if (oldest !== undefined) resolvedCache.delete(oldest);
  }
  resolvedCache.set(trackId, audio);
}

/** Seconds before track end at which the next track starts loading. */
const PRELOAD_AHEAD_SEC = 45;
let preloadEl: HTMLAudioElement | null = null;
let preloadKey: string | null = null;

/** The identical next-index logic for `next()` and the preloader. */
function computeNextIndex(state: { queue: Track[]; index: number; shuffle: boolean; repeat: RepeatMode }, auto: boolean): number | null {
  const { queue, index, shuffle, repeat } = state;
  if (!queue.length) return null;
  if (shuffle && queue.length > 1) return (index + 1) % queue.length;
  const ni = index + 1;
  if (ni >= queue.length) {
    if (repeat === "all") return 0;
    if (auto) return null;
    return 0;
  }
  return ni;
}

function dropPreload() {
  preloadKey = null;
  if (preloadEl) {
    preloadEl.removeAttribute("src");
    preloadEl = null;
  }
}

/**
 * Warm the next track ~20s before the current one ends: resolve it into
 * our cache and let a hidden element pull the audio bytes into the HTTP
 * cache, so switching tracks starts playback instantly. Works with
 * shuffle because it reuses the same next-index logic as `next()`.
 */
async function maybePreloadNext(): Promise<void> {
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const remaining = audio.duration - audio.currentTime;
  if (remaining > PRELOAD_AHEAD_SEC || remaining <= 0) return;

  const state = usePlayerStore.getState();
  const nextIndex = computeNextIndex(state, true);
  if (nextIndex === null) return;
  const nextTrack = state.queue[nextIndex];
  if (!nextTrack) return;

  const key = `${state.current?.id ?? ""}::${nextIndex}`;
  if (preloadKey === key) return;
  preloadKey = key;

  try {
    const resolved = await resolveAudio(nextTrack);
    preloadEl = new Audio();
    preloadEl.preload = "auto";
    // Through the proxy so the service worker stores the bytes on the
    // device while it preloads — the song is cached before it even plays.
    preloadEl.src = audioSourceFor(resolved, nextTrack.id);
    preloadEl.load();
  } catch {
    preloadKey = null; // unresolvable — let the normal skip path handle it
  }
}

/** Client-side memo so skipping back never re-hits the API. */
const inflight = new Map<string, Promise<ResolvedAudio>>();

/* ---------- offline / playability helpers ---------- */

function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/**
 * The SW stores played songs' bytes on-device under /__audio__/<tid>.
 * Offline we can still play those even though `resolve` is unreachable —
 * point the audio element at the proxy with just the track id and the SW
 * serves the stored file. Returns the stream URL or null.
 */
async function offlineStreamSource(trackId: string): Promise<string | null> {
  try {
    if (typeof caches === "undefined") return null;
    const hit = await caches.match(`/__audio__/${encodeURIComponent(trackId)}`);
    return hit ? `/api/music/stream?tid=${encodeURIComponent(trackId)}` : null;
  } catch {
    return null;
  }
}

function markUnplayable(trackId: string, reason: string): void {
  usePlayerStore.setState((s) => ({ unplayable: { ...s.unplayable, [trackId]: reason } }));
}

function markPlayable(trackId: string): void {
  usePlayerStore.setState((s) => {
    if (!s.unplayable[trackId]) return s;
    const unplayable = { ...s.unplayable };
    delete unplayable[trackId];
    return { unplayable };
  });
}

// Back online: everything is playable again.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    failureStreak = 0;
    usePlayerStore.setState({ unplayable: {} });
  });
}

/**
 * Offline navigation helper: walk the queue from `start` in `dir` and
 * return the first track whose audio bytes are stored on this device —
 * skips land on playable songs instead of dimmed, dead ones.
 */
async function firstPlayableOffset(start: number, dir: 1 | -1): Promise<number | null> {
  const { queue } = usePlayerStore.getState();
  if (!queue.length) return null;
  for (let i = 0; i < queue.length; i++) {
    const idx = (start + i * dir + queue.length) % queue.length;
    if (await offlineStreamSource(queue[idx].id)) return idx;
  }
  return null;
}

/**
 * DOWNLOADS REALLY DOWNLOAD.
 * `toggleDownload` used to only bookmark the track — offline, "saved"
 * songs still had to stream. This pulls the full audio through the
 * proxy so the service worker stores the bytes on the device under
 * /__audio__/<tid>. Best-effort: errors are swallowed.
 */
export async function cacheTrackAudio(track: Track): Promise<void> {
  try {
    if (!track) return;
    if (await offlineStreamSource(track.id)) return; // already on device
    const resolved = await resolveAudio(track);
    const src = audioSourceFor(resolved, track.id);
    if (!src || /^(blob:|data:)/.test(src)) return;
    // The SW intercepts stream requests and persists the full file
    // itself; cancelling our body just frees memory — its own fetch
    // (storeFull) keeps running independently.
    const res = await fetch(src, { cache: "no-store" });
    void res.body?.cancel().catch(() => undefined);
  } catch {
    /* best-effort */
  }
}

/* ---------- downloads backfill ---------- */

/** Tracks whose device copy we already secured this session. */
const backfilled = new Set<string>();
let backfillRunning = false;

/**
 * After sign-in/bootstrap, quietly cache any downloaded songs that are
 * not yet on this device — one at a time so it never floods the radio.
 */
export function backfillDownloadCache(tracks: Track[]): void {
  if (backfillRunning || isOffline() || !tracks.length) return;
  void (async () => {
    backfillRunning = true;
    for (const track of tracks) {
      if (backfilled.has(track.id)) continue;
      if (isOffline()) break;
      backfilled.add(track.id); // even on failure, don't retry in a loop
      await cacheTrackAudio(track);
    }
    backfillRunning = false;
  })();
}

export async function resolveAudio(track: Track, force = false): Promise<ResolvedAudio> {
  const cached = resolvedCache.get(track.id);
  if (cached && !force) return cached;

  const pending = inflight.get(track.id);
  // A click landing on a track whose resolution is already under way
  // (prefetch) must reuse that promise, never start a second conversion.
  if (pending && !force) return pending;

  const promise = fetch("/api/music/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, force }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Audio resolution failed (${res.status})`);
      }
      const data = (await res.json()) as { audio: ResolvedAudio };
      cacheResolved(track.id, data.audio);
      return data.audio;
    })
    .finally(() => inflight.delete(track.id));
  inflight.set(track.id, promise);
  return promise;
}

const prefetching = new Set<string>();

/**
 * Warms resolution for the first few tracks of a visible list in the
 * background, so clicking play usually starts instantly. Errors are
 * ignored — the real play path surfaces them.
 */
export async function prefetchTracks(tracks: Track[], count = 2): Promise<void> {
  for (const track of tracks.slice(0, count)) {
    if (resolvedCache.has(track.id) || prefetching.has(track.id)) continue;
    prefetching.add(track.id);
    try {
      await resolveAudio(track);
    } catch {
      /* not playable — the play path will show it */
    } finally {
      prefetching.delete(track.id);
    }
  }
}

/**
 * Route playback through our stream proxy tagged with the track id.
 * The service worker keys its device cache on `tid`, so a song stays
 * one cache entry for its whole life even though resolved CDN links
 * (signed, expiring) change between plays. Replays are then served
 * from the device — instant, and offline-capable.
 */
function audioSourceFor(resolved: ResolvedAudio, trackId: string): string {
  const url = resolved.audioUrl;
  if (!url || /^(blob:|data:)/.test(url)) return url;
  if (url.startsWith("/api/music/stream")) {
    // The server pre-proxies range-hostile sources — just tag the track id.
    const tagged = new URL(url, "http://local");
    tagged.searchParams.set("tid", trackId);
    return tagged.pathname + tagged.search;
  }
  return `/api/music/stream?url=${encodeURIComponent(url)}&tid=${encodeURIComponent(trackId)}`;
}

function loadSource(url: string, autoplay: boolean) {
  if (!audio) return;
  audio.src = url;
  audio.load();
  if (autoplay) {
    const promise = audio.play();
    if (promise) {
      promise.catch(() => {
        // Autoplay was blocked by the browser — reflect reality.
        usePlayerStore.setState({ isPlaying: false, status: "paused" });
      });
    }
  }
}

function setMediaPlaybackState(state: "playing" | "paused") {
  if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch { /* unsupported */ }
}

/**
 * Wire the OS control-center actions. Next/prev/seek need JavaScript;
 * play/pause are registered EXPLICITLY because on iOS standalone PWAs the
 * "native resume with no handler" path silently fails once WebKit
 * suspends the page in the background — the control-center play button
 * would do nothing until the app was reopened. A registered handler makes
 * iOS wake the page to deliver the action, and our element listeners keep
 * the store in sync either way.
 */
function installMediaSessionHandlers() {
  if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
  const st = () => usePlayerStore.getState();
  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ["previoustrack", () => st().prev()],
    ["nexttrack", () => st().next()],
    ["play", () => {
      if (!audio) return;
      // If the page was suspended, the element may need its current
      // source re-kicked; play() on a healthy element just resumes.
      void audio.play().catch(() => {
        const track = usePlayerStore.getState().current;
        if (track) void startTrack(track, usePlayerStore.getState().queue, usePlayerStore.getState().index, audio?.currentTime ?? 0);
      });
    }],
    ["pause", () => audio?.pause()],
    ["seekto", (details) => {
      const t = (details as { seekTime?: number }).seekTime;
      if (typeof t === "number") st().seek(t);
    }],
    ["seekbackward", () => st().seek(Math.max(0, (audio?.currentTime ?? 0) - 10))],
    ["seekforward", () => st().seek((audio?.currentTime ?? 0) + 10)],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action unsupported on this platform */
    }
  }
}

function updateMediaSession(track: Track, resolved: ResolvedAudio | null) {
  if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? "Lenzo Music",
      artwork: [
        { src: resolved?.artwork ?? track.artwork, sizes: "512x512", type: "image/jpeg" },
      ],
    });
    // iOS quirk (esp. standalone PWA): assigning metadata can drop the
    // action handlers — always re-arm AFTER the metadata is set.
    installMediaSessionHandlers();
    navigator.mediaSession.playbackState = "playing";
  } catch {
    /* unsupported */
  }
}

async function startTrack(track: Track, queue: Track[], index: number, resumeAt = 0) {
  const token = ++resolveToken;
  const store = usePlayerStore.getState();
  dropPreload();

  // The new click owns the player immediately: stop and drop the old
  // stream so the old song never keeps playing while the new one loads.
  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* element already detached */
    }
  }

  usePlayerStore.setState({
    current: track,
    queue,
    index,
    resolved: null,
    lyrics: null,
    error: null,
    progress: 0,
    duration: track.duration || 0,
    status: "resolving",
    isPlaying: false,
  });

  try {
    // Prefer the device's stored copy of this song when it exists: the
    // URL never expires, so control-center play/pause still works after a
    // long background pause (expired signed CDN links play silence while
    // the frozen PWA can't re-resolve), and replays start instantly.
    let resolved: ResolvedAudio;
    const cachedLocal = await offlineStreamSource(track.id);
    if (cachedLocal) {
      resolved = {
        audioUrl: cachedLocal,
        artwork: track.artwork,
        duration: track.duration,
        provider: "ytmp3",
      } as ResolvedAudio;
      cacheResolved(track.id, resolved);
    } else {
      resolved = await resolveAudio(track);
    }
    if (token !== resolveToken) return; // user skipped ahead while resolving

    usePlayerStore.setState({ resolved, lyrics: resolved.lyrics ?? null });
    if (resolved.duration) usePlayerStore.setState({ duration: resolved.duration });

    loadSource(audioSourceFor(resolved, track.id), true);
    // Restoring a pause position (control-center resume after the URL
    // expired): jump back once the new source can seek.
    if (resumeAt > 0 && audio) {
      const restore = () => {
        try {
          audio!.currentTime = resumeAt;
        } catch { /* metadata not ready yet */ }
      };
      if (audio.readyState >= 1) restore();
      else audio.addEventListener("loadedmetadata", restore, { once: true });
    }
    usePlayerStore.setState({ status: "playing", isPlaying: true });

    updateMediaSession(track, resolved);

    // Start resolving the next queue entry right away — a converter takes
    // several seconds, which is longer than the idle gap before "ended" if
    // the listener skips early. Resolution warms the client cache; the byte
    // preload keeps its own window (PRELOAD_AHEAD_SEC).
    void (async () => {
      if (token !== resolveToken) return;
      const ni = computeNextIndex(usePlayerStore.getState(), true);
      if (ni === null) return;
      const nt = usePlayerStore.getState().queue[ni];
      if (!nt) return;
      try {
        await resolveAudio(nt);
      } catch { /* skip path handles it */ }
    })();
  } catch (err) {
    if (token !== resolveToken) return;

    // Offline: the resolver is unreachable, but songs already played are
    // still stored on the device — play directly from the audio cache.
    if (isOffline()) {
      const cachedSource = await offlineStreamSource(track.id);
      if (token !== resolveToken) return;
      if (!cachedSource) {
        // Not saved on this device: hop to the next saved song in the
        // queue (bounded by a failure streak so it can never loop).
        failureStreak += 1;
        const skipState = usePlayerStore.getState();
        if (failureStreak <= skipState.queue.length && skipState.queue.length > 1) {
          const playable = await firstPlayableOffset(skipState.index + 1, 1);
          if (token === resolveToken && playable !== null) {
            void startTrack(skipState.queue[playable], skipState.queue, playable);
            return;
          }
        }
        if (token !== resolveToken) return;
        usePlayerStore.setState({
          status: "error",
          error: "You're offline — this song isn't saved on your device.",
          isPlaying: false,
        });
        return;
      }
      const cachedResolved = {
        audioUrl: cachedSource,
        artwork: track.artwork,
        duration: track.duration,
        provider: "ytmp3",
      } as ResolvedAudio;
      usePlayerStore.setState({
        resolved: cachedResolved,
        lyrics: null,
        status: "playing",
        isPlaying: true,
      });
      loadSource(audioSourceFor(cachedResolved, track.id), true);
      updateMediaSession(track, cachedResolved);
      return;
    }

    const message = err instanceof Error ? err.message : "This track is unavailable right now.";
    usePlayerStore.setState({ status: "error", error: message, isPlaying: false });
    markUnplayable(track.id, message);

    // Don't strand the listener on an unresolvable track: auto-skip to the
    // next queue entry unless failures stack up (max 3 in a row means the
    // network or every converter is down — stop and surface the error).
    const state = usePlayerStore.getState();
    failureStreak += 1;
    if (failureStreak <= 3 && state.queue.length > 1) {
      useUi.getState().showToast(`Skipping "${track.title}" — unavailable`, "info");
      state.next(true);
    }
  }
}

function orderedIndices(count: number, start: number): number[] {
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => i !== start);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [start, ...rest];
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  current: null,
  resolved: null,
  status: "idle",
  isPlaying: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",
  error: null,
  unplayable: {},
  lyrics: null,
  expanded: false,
  panelTab: "now",
  seeking: false,

  attachAudio: (el) => {
    audio = el;
    if (!el) return;
    el.volume = get().volume;

    el.addEventListener("timeupdate", () => {
      if (!usePlayerStore.getState().seeking) {
        set({ progress: el.currentTime });
      }
      if (el.duration && Number.isFinite(el.duration)) {
        const d = Math.round(el.duration);
        if (usePlayerStore.getState().duration !== d) set({ duration: d });
      }
      void maybePreloadNext();
    });

    el.addEventListener("waiting", () => set({ status: "resolving" }));
    el.addEventListener("playing", () => {
      failureStreak = 0;
      const id = usePlayerStore.getState().current?.id;
      if (id) markPlayable(id);
      set({ status: "playing", isPlaying: true, error: null });
      setMediaPlaybackState("playing");
    });
    el.addEventListener("pause", () => {
      if (!el.ended) {
        set({ isPlaying: false, status: "paused" });
        setMediaPlaybackState("paused");
      }
    });
    el.addEventListener("error", () => {
      const state = usePlayerStore.getState();
      if (!state.current || !el.src || !el.currentSrc) {
        // Source intentionally dropped (startTrack swap) — not a failure.
        return;
      }
      // Signed CDN links expire. A resume from the control center after a
      // long background pause hits a dead URL and plays silence: recover by
      // re-resolving the SAME track and restoring the position, instead of
      // surfacing an error (or letting the song sit dead until the app is
      // reopened).
      const position = el.currentTime || 0;
      const track = state.current;
      void (async () => {
        try {
          const resolved = await resolveAudio(track, true);
          if (usePlayerStore.getState().current?.id !== track.id) return;
          loadSource(audioSourceFor(resolved, track.id), usePlayerStore.getState().isPlaying);
          el.currentTime = position;
          const still = usePlayerStore.getState();
          if (still.isPlaying) {
            await el.play().catch(() => set({ isPlaying: false, status: "paused" }));
            set({ resolved, status: "playing", error: null });
            setMediaPlaybackState("playing");
          } else {
            set({ resolved, status: "paused", error: null });
          }
        } catch {
          const message = isOffline()
            ? "You're offline — this song isn't saved on your device."
            : "The audio source stopped working. Trying the next available source…";
          if (!isOffline() && track) markUnplayable(track.id, message);
          set({
            error: message,
            status: "error",
          });
          setMediaPlaybackState("paused");
        }
      })();
    });

    el.addEventListener("ended", () => {
      const { repeat, shuffle, queue, index } = usePlayerStore.getState();
      if (repeat === "one") {
        el.currentTime = 0;
        el.play().catch(() => undefined);
        return;
      }
      if (!shuffle && index >= queue.length - 1 && repeat === "off") {
        set({ isPlaying: false, status: "paused", progress: 0 });
        return;
      }
      usePlayerStore.getState().next(true);
    });

    installMediaSessionHandlers();

    // Standalone PWAs (iOS, Android) can drop media-session handlers when
    // the app is backgrounded/resumed. Re-arm on every visibility change —
    // cheap, and the handlers close over getState() only.
    document.addEventListener("visibilitychange", () => {
      installMediaSessionHandlers();
    });
  },

  playQueue: (tracks, startIndex = 0) => {
    if (!tracks.length) return;
    // Shuffle ON + Play = start a RANDOM song (Spotify behaviour), then
    // continue through the rest shuffled. The shuffle toggle itself never
    // starts playback.
    const randomized = get().shuffle && tracks.length > 1;
    const start = randomized ? Math.floor(Math.random() * tracks.length) : startIndex;
    const ordered = randomized ? reorder(tracks, start) : tracks;
    const idx = randomized ? start : startIndex;
    void startTrack(ordered[idx], ordered, idx);
  },

  playTrack: (track, context) => {
    const queue = context && context.length ? context : [track];
    const index = Math.max(0, queue.findIndex((t) => t.id === track.id));
    void startTrack(track, queue, index);
  },

  toggle: () => {
    const { current, isPlaying, queue } = get();
    if (!current) {
      if (queue.length) void startTrack(queue[0], queue, 0);
      return;
    }
    if (isPlaying) get().pause();
    else get().resume();
  },

  pause: () => {
    audio?.pause();
    set({ isPlaying: false, status: "paused" });
  },

  resume: () => {
    const state = get();
    if (!audio || !state.current) return;
    if (!audio.src) {
      // Nothing loaded yet (e.g. after a hard refresh) — resolve and play.
      void startTrack(state.current, state.queue, state.index);
      return;
    }
    const position = audio.currentTime || 0;
    const { current: track, queue, index } = state;
    audio.play()
      .then(() => set({ isPlaying: true, status: "playing", error: null }))
      .catch(() => {
        // The signed CDN URL expired while the app was in the background.
        // Some mobile browsers report this as a play() rejection without an
        // element error event — recover by fully re-resolving the SAME track
        // at the same position instead of silently staying paused.
        void startTrack(track, queue, index, position);
      });
  },

  next: (auto = false) => {
    const { queue } = get();
    if (!queue.length) return;
    const nextIndex = computeNextIndex(get(), auto);
    if (nextIndex === null) {
      set({ isPlaying: false, status: "paused", progress: 0 });
      return;
    }
    void (async () => {
      let idx = nextIndex;
      // Offline: land on the next SAVED song, skipping dimmed ones.
      if (isOffline()) {
        const playable = await firstPlayableOffset(nextIndex, 1);
        if (playable === null) {
          set({ isPlaying: false, status: "paused", error: "You're offline — no saved songs left in this queue." });
          useUi.getState().showToast("Offline — no more saved songs in this queue", "info");
          return;
        }
        idx = playable;
      }
      void startTrack(queue[idx], queue, idx);
    })();
  },

  prev: () => {
    const { queue, index } = get();
    if (!queue.length) return;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      set({ progress: 0 });
      return;
    }
    void (async () => {
      let idx = index <= 0 ? queue.length - 1 : index - 1;
      // Offline: previous SAVED song instead of a dead one.
      if (isOffline()) {
        const playable = await firstPlayableOffset(idx, -1);
        if (playable === null) {
          useUi.getState().showToast("Offline — no saved songs behind this one", "info");
          return;
        }
        idx = playable;
      }
      void startTrack(queue[idx], queue, idx);
    })();
  },

  seek: (seconds) => {
    if (!audio) return;
    const clamped = Math.max(0, Math.min(seconds, audio.duration || seconds));
    audio.currentTime = clamped;
    set({ progress: clamped, seeking: false });
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    if (audio) {
      audio.volume = volume;
      audio.muted = volume === 0;
    }
    set({ volume, muted: volume === 0 });
  },

  toggleMute: () => {
    const muted = !get().muted;
    if (audio) audio.muted = muted;
    set({ muted });
  },

  toggleShuffle: () => set({ shuffle: !get().shuffle }),
  setShuffle: (on) => set({ shuffle: on }),

  cycleRepeat: () => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const current = get().repeat;
    set({ repeat: order[(order.indexOf(current) + 1) % order.length] });
  },

  addToQueue: (track) => {
    const { queue, current } = get();
    if (!current) {
      void startTrack(track, [track], 0);
      return;
    }
    set({ queue: [...queue, track] });
  },

  playNext: (track) => {
    const { queue, index, current } = get();
    if (!current) {
      void startTrack(track, [track], 0);
      return;
    }
    const next = [...queue];
    next.splice(index + 1, 0, track);
    set({ queue: next });
  },

  removeFromQueue: (index) => {
    const { queue, index: current } = get();
    if (index === current) return;
    const next = queue.filter((_, i) => i !== index);
    set({ queue: next, index: index < current ? current - 1 : current });
  },

  moveQueue: (from, to) => {
    const { queue, index: current } = get();
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    let newCurrent = current;
    if (current === from) newCurrent = to;
    else if (from < current && to >= current) newCurrent = current - 1;
    else if (from > current && to <= current) newCurrent = current + 1;
    set({ queue: next, index: newCurrent });
  },

  clearQueue: () => {
    const { current } = get();
    set({ queue: current ? [current] : [], index: 0 });
  },

  saveQueueAsTracks: () => get().queue,

  setExpanded: (expanded) => set({ expanded }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setSeeking: (seeking) => set({ seeking }),
  setLyrics: (lyrics) => set({ lyrics }),
}));

function reorder(tracks: Track[], startIndex: number): Track[] {
  const indices = orderedIndices(tracks.length, startIndex);
  return indices.map((i) => tracks[i]);
}
