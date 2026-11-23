"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";

/* ============================================================
   AUDIO ENGINE
   The single <audio> element for the whole application. Mounted
   once by the shell and attached to the player store (which owns
   the Media Session actions); also wires background-resume
   resync, keyboard shortcuts and recent-history tracking.
   Renders nothing.
   ============================================================ */

export default function AudioEngine() {
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    // NOTE: crossOrigin must stay unset. The converter hosts (spotidown,
    // ytmp3 CDNs) don't send CORS headers, so an anonymous crossOrigin
    // request makes the browser block every track outright.
    audio.setAttribute("playsinline", "");
    // CRITICAL for background playback: the element MUST live in the DOM.
    // A detached <audio> gets its media session dropped and its playback
    // suspended by mobile browsers while the page is backgrounded — the
    // control-center play button then silently does nothing until the app
    // is foregrounded again.
    audio.style.display = "none";
    document.body.appendChild(audio);
    usePlayerStore.getState().attachAudio(audio);

    const onPlay = () => {
      const current = usePlayerStore.getState().current;
      if (current) useSession.getState().pushRecent(current);
    };
    audio.addEventListener("play", onPlay);

    // When the page becomes visible again, resync the UI/OS with what the
    // audio element actually did in the background — and restart playback
    // if the browser paused the element under us while hidden.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const p = usePlayerStore.getState();
      if (p.isPlaying && audio.paused && !audio.ended) {
        audio.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never hijack keys while typing in inputs.
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      // Never hijack keys pressed on interactive elements (Space on a focused button should click it).
      const onInteractive = target?.closest?.("button, a, [role='button'], input, select, [contenteditable]") as HTMLElement | null;
      const isSpace = e.key === " ";
      if (isSpace && onInteractive) return;

      const p = usePlayerStore.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          p.toggle();
          break;
        case "ArrowRight":
          if (e.shiftKey) p.next();
          else p.seek(p.progress + 5);
          break;
        case "ArrowLeft":
          if (e.shiftKey) p.prev();
          else p.seek(p.progress - 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          p.setVolume(p.muted ? 0.2 : p.volume + 0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          p.setVolume(p.volume - 0.05);
          break;
        case "m":
        case "M":
          p.toggleMute();
          break;
        case "s":
        case "S":
          p.toggleShuffle();
          break;
        case "r":
        case "R":
          p.cycleRepeat();
          break;
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      audio.remove();
      usePlayerStore.getState().attachAudio(null);
    };
  }, []);

  return null;
}
