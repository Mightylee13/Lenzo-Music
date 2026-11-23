import "server-only";
import { getSetting, setSetting } from "@/lib/db/json-store";
import type { AppSettings } from "@/types";

/** SECTION 19/20 — admin-controlled application configuration. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  appName: "Lenzo Music",
  tagline: "Your sound. Your wave.",
  maintenanceMode: false,
  registrationOpen: true,
  guestMode: true,
  features: [
    { key: "streaming", label: "Music streaming", enabled: true, description: "Resolve and play audio through the configured music API." },
    { key: "downloads", label: "Downloads", enabled: true, description: "Allow users to keep tracks for offline listening." },
    { key: "lyrics", label: "Lyrics", enabled: true, description: "Show lyrics returned by the upstream provider." },
    { key: "podcasts", label: "Podcasts", enabled: true, description: "Enable the podcast section." },
    { key: "radio", label: "Radio", enabled: true, description: "Enable artist/song/genre radio stations." },
    { key: "registration", label: "Registration", enabled: true, description: "Allow new account creation." },
    { key: "premium", label: "Premium plans", enabled: false, description: "Preview the Free/Premium architecture. Payments stay disabled." },
    { key: "social", label: "Social features", enabled: true, description: "Follow artists, playlists and other listeners." },
  ],
  homeSections: [
    { id: "recent", title: "Recently played", enabled: true, kind: "playlists" },
    { id: "made-for-you", title: "Made for you", enabled: true, kind: "playlists" },
    { id: "top-nigeria", title: "Top 100 Nigeria", enabled: true, kind: "playlists" },
    { id: "top-amapiano", title: "Top Amapiano", enabled: true, kind: "playlists" },
    { id: "top-global", title: "Top 50 USA", enabled: true, kind: "playlists" },
    { id: "heavy-rotation", title: "Your heavy rotation", enabled: true, kind: "tracks" },
    { id: "trending", title: "Trending songs", enabled: true, kind: "tracks" },
    { id: "new-releases", title: "New releases", enabled: true, kind: "albums" },
    { id: "charts", title: "Top charts", enabled: true, kind: "charts" },
    { id: "nigerian", title: "Nigerian music", enabled: true, kind: "tracks" },
    { id: "afrobeats", title: "Afrobeats", enabled: true, kind: "tracks" },
    { id: "amapiano", title: "Amapiano", enabled: true, kind: "tracks" },
    { id: "hiphop", title: "Hip-hop", enabled: true, kind: "tracks" },
    { id: "rnb", title: "R&B", enabled: true, kind: "tracks" },
    { id: "gospel", title: "Gospel", enabled: true, kind: "tracks" },
    { id: "pop", title: "Pop", enabled: true, kind: "tracks" },
    { id: "electronic", title: "Electronic", enabled: true, kind: "tracks" },
    { id: "chill", title: "Chill", enabled: true, kind: "playlists" },
    { id: "workout", title: "Workout", enabled: true, kind: "playlists" },
    { id: "focus", title: "Focus", enabled: true, kind: "playlists" },
    { id: "recommended-artists", title: "Recommended artists", enabled: true, kind: "artists" },
  ],
};

export function getAppSettings(): AppSettings {
  const stored = getSetting("appSettings", undefined as Partial<AppSettings> | undefined);
  if (!stored) return DEFAULT_APP_SETTINGS;
  return {
    ...DEFAULT_APP_SETTINGS,
    ...stored,
    features: stored.features?.length ? stored.features : DEFAULT_APP_SETTINGS.features,
    homeSections: stored.homeSections?.length ? stored.homeSections : DEFAULT_APP_SETTINGS.homeSections,
  };
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getAppSettings(), ...patch };
  setSetting("appSettings", next);
  return next;
}

export function isFeatureEnabled(key: string): boolean {
  return getAppSettings().features.find((f) => f.key === key)?.enabled ?? false;
}
