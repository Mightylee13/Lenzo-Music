"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";

/* ============================================================
   AUDIO ENGINE
   The single <audio> element for the whole application. Mounted
   once by the shell and attached to the player store; also wires
   Media Session controls, keyboard shortcuts and recent-history
   tracking. Renders nothing.
   ============================================================ */

export default function AudioEngine() {
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    // NOTE: crossOrigin must stay unset. The converter hosts (spotidown,
    // ytmp3 CDNs) don't send CORS headers, so an anonymous crossOrigin
    // request makes the browser block every track outright.
    usePlayerStore.getState().attachAudio(audio);

    const onPlay = () => {
      const current = usePlayerStore.getState().current;
      if (current) useSession.getState().pushRecent(current);
    };
    audio.addEventListener("play", onPlay);

    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      usePlayerStore.getState().attachAudio(null);
    };
  }, []);

  useEffect(() => {
    const player = () => usePlayerStore.getState();

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", () => player().resume());
        navigator.mediaSession.setActionHandler("pause", () => player().pause());
        navigator.mediaSession.setActionHandler("nexttrack", () => player().next());
        navigator.mediaSession.setActionHandler("previoustrack", () => player().prev());
        navigator.mediaSession.setActionHandler("seekbackward", (details) =>
          player().seek(player().progress - (details.seekOffset ?? 10))
        );
        navigator.mediaSession.setActionHandler("seekforward", (details) =>
          player().seek(player().progress + (details.seekOffset ?? 10))
        );
      } catch {
        /* partial browser support */
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never hijack keys while typing in inputs.
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      const p = player();
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
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
