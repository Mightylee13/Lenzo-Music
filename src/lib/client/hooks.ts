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
    // Repaint the previous response from this tab's session cache
    // immediately; the network fetch below still refreshes it.
    const cached = readSessionCache<T>(url);
    setState((s) => ({ data: cached ?? s.data, loading: !cached, error: null }));
    fetch(url, { headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        return body as T;
      })
      .then((data) => {
        if (cancelled) return;
        writeSessionCache(url, data);
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Something went wrong" });
        }
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

function readSessionCache<T>(url: string): T | null {
  try {
    const raw = sessionStorage.getItem(USE_API_CACHE_PREFIX + url);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; at: number };
    if (typeof parsed?.at !== "number" || Date.now() - parsed.at > USE_API_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSessionCache<T>(url: string, data: T): void {
  try {
    sessionStorage.setItem(USE_API_CACHE_PREFIX + url, JSON.stringify({ data, at: Date.now() }));
  } catch {
    /* quota exceeded / private mode — caching is best-effort */
  }
}

/** Drop the painted cache for one URL (e.g. after a mutation elsewhere). */
export function invalidateApiCache(url: string): void {
  try {
    sessionStorage.removeItem(USE_API_CACHE_PREFIX + url);
  } catch { /* private mode */ }
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
