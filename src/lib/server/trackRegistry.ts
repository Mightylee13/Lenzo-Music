import type { Track } from "@/types";

/* ============================================================
   TRACK REGISTRY (server memory)

   Lets /api/music/stream re-resolve a track by its id alone,
   without any client JS: when a signed CDN url expires during a
   long background pause (the iOS PWA control-center resume
   killer), the media element re-requests /api/music/stream?tid=X
   directly. The stream route recalls the track here and serves a
   fresh url. Populated by resolveTrack() on every resolution.
   ============================================================ */

const REGISTRY_KEY = "__lenzo_track_registry__" as const;

type TrackRegistry = Map<string, Track>;

function registry(): TrackRegistry {
  const g = globalThis as unknown as Record<string, TrackRegistry | undefined>;
  let reg = g[REGISTRY_KEY];
  if (!reg) {
    reg = new Map();
    g[REGISTRY_KEY] = reg;
  }
  return reg;
}

/** Bounded so a busy server can't hoard stale entries. */
const REGISTRY_MAX = 300;

export function rememberTrack(track: Track): void {
  if (!track?.id) return;
  const reg = registry();
  reg.delete(track.id); // refresh insertion order (LRU-ish via first-key eviction)
  reg.set(track.id, track);
  if (reg.size > REGISTRY_MAX) {
    const oldest = reg.keys().next().value;
    if (oldest !== undefined) reg.delete(oldest);
  }
}

export function recallTrack(trackId: string | null | undefined): Track | null {
  if (!trackId) return null;
  return registry().get(trackId) ?? null;
}
