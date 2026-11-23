"use client";

import { useEffect } from "react";

/* ============================================================
   SERVICE WORKER BOOT — registers the device audio cache.
   Once registered, every played song stores its bytes on the
   device: replays start instantly and survive offline.
   ============================================================ */

export default function ServiceWorkerBoot() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort — playback still works without the cache */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
