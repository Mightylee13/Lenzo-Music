"use client";

/**
 * Device audio cache stats — the service worker stores played and
 * downloaded songs on THIS device (Cache Storage, audio-cache-v1,
 * keys under /__audio__/<trackId>). Nothing is uploaded anywhere.
 */

const AUDIO_CACHE = "audio-cache-v1";
const AUDIO_KEY_PREFIX = "/__audio__/";

export interface AudioCacheStats {
  /** Number of songs stored on this device. */
  songs: number;
  /** Total bytes of stored audio (from content-length, blob fallback). */
  bytes: number;
}

export async function getAudioCacheStats(): Promise<AudioCacheStats> {
  const empty = { songs: 0, bytes: 0 };
  if (typeof caches === "undefined") return empty;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const keys = await cache.keys();
    let songs = 0;
    let bytes = 0;
    for (const key of keys) {
      if (!new URL(key.url).pathname.startsWith(AUDIO_KEY_PREFIX)) continue;
      songs++;
      const res = await cache.match(key);
      if (!res) continue;
      const len = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(len) && len > 0) bytes += len;
      else bytes += (await res.blob()).size; // streamed entries without a header
    }
    return { songs, bytes };
  } catch {
    return empty;
  }
}

/** Removes every stored song from THIS device. Returns songs removed. */
export async function clearAudioCache(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const keys = await cache.keys();
    let removed = 0;
    for (const key of keys) {
      if (!new URL(key.url).pathname.startsWith(AUDIO_KEY_PREFIX)) continue;
      if (await cache.delete(key)) removed++;
    }
    return removed;
  } catch {
    return 0;
  }
}

/** True when this device already holds the song's full audio. */
export async function hasCachedAudio(trackId: string): Promise<boolean> {
  if (typeof caches === "undefined" || !trackId) return false;
  try {
    return Boolean(await caches.match(`/__audio__/${encodeURIComponent(trackId)}`));
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
