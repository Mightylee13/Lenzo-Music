"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================
   SMALL CLIENT HOOKS used across pages.
   ============================================================ */

export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Fetch-on-mount (or on query change) helper with loading + error. */
export function useApi<T>(url: string | null): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    // Repaint the previous response from the device cache immediately;
    // the network fetch below still refreshes it.
    const cached = readCache<T>(url);
    setState((s) => ({ data: cached ?? s.data, loading: !cached, error: null }));
    fetch(url, { headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        return body as T;
      })
      .then((data) => {
        if (cancelled) return;
        writeCache(url, data);
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Offline / API down: repaint whatever we have saved on this
        // device (any age) instead of showing an error page — pages
        // you have visited before remain browsable offline.
        const fallback = readCacheAnyAge<T>(url);
        if (fallback) {
          setState({ data: fallback, loading: false, error: null });
          return;
        }
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Something went wrong" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

const USE_API_CACHE_PREFIX = "useapi:";
/** How long a cached response may paint before the network answer. */
const USE_API_CACHE_TTL_MS = 180_000;
/** Bounded disk budget: trim the least-recently-used entries beyond this. */
const USE_API_CACHE_MAX_ENTRIES = 70;

function cacheEntry<T>(url: string, maxAgeMs: number | null): T | null {
  try {
    // localStorage survives tab close/reopen; fall back to the older
    // sessionStorage entries written before this upgrade.
    const raw = localStorage.getItem(USE_API_CACHE_PREFIX + url) ?? sessionStorage.getItem(USE_API_CACHE_PREFIX + url);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; at: number };
    if (typeof parsed?.at !== "number") return null;
    if (maxAgeMs !== null && Date.now() - parsed.at > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function readCache<T>(url: string): T | null {
  return cacheEntry<T>(url, USE_API_CACHE_TTL_MS);
}

/** Any-age fallback — used when the network fails (offline mode). */
function readCacheAnyAge<T>(url: string): T | null {
  return cacheEntry<T>(url, null);
}

function writeCache<T>(url: string, data: T): void {
  const key = USE_API_CACHE_PREFIX + url;
  try {
    localStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
  } catch {
    // Quota exceeded — drop the oldest entries and retry once.
    try {
      const entries: Array<{ key: string; at: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(USE_API_CACHE_PREFIX)) continue;
        const at = JSON.parse(localStorage.getItem(k) ?? "{}")?.at;
        entries.push({ key: k, at: typeof at === "number" ? at : 0 });
      }
      entries.sort((a, b) => a.at - b.at);
      for (const e of entries.slice(0, Math.ceil(entries.length / 2))) {
        localStorage.removeItem(e.key);
      }
      localStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
    } catch {
      /* still full or private mode — caching is best-effort */
    }
  }
  // Keep the cache bounded regardless of quota signals.
  try {
    const entries: Array<{ key: string; at: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(USE_API_CACHE_PREFIX) || k === key) continue;
      const at = JSON.parse(localStorage.getItem(k) ?? "{}")?.at;
      entries.push({ key: k, at: typeof at === "number" ? at : 0 });
    }
    if (entries.length > USE_API_CACHE_MAX_ENTRIES) {
      entries.sort((a, b) => a.at - b.at);
      for (const e of entries.slice(0, entries.length - USE_API_CACHE_MAX_ENTRIES)) {
        localStorage.removeItem(e.key);
      }
    }
  } catch { /* best-effort */ }
}

/** Drop the painted cache for one URL (e.g. after a mutation elsewhere). */
export function invalidateApiCache(url: string): void {
  try {
    localStorage.removeItem(USE_API_CACHE_PREFIX + url);
    sessionStorage.removeItem(USE_API_CACHE_PREFIX + url);
  } catch { /* private mode */ }
}

/** Live network status — flips as the device goes online/offline. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Simple open/close with Escape handling + body scroll lock. */
export function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  return ref;
}
