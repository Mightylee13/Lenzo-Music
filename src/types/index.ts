/* ============================================================
   BLUEWAVE — NORMALIZED DOMAIN MODELS
   Every upstream provider (SoundCloud / Spotify / YouTube /
   Apple Music / demo data) is normalized into these shapes so
   the rest of the app never has to know which API answered.
   ============================================================ */

export type MusicSource = "soundcloud" | "spotify" | "youtube" | "applemusic" | "deezer" | "demo";

export interface Track {
  /** Stable app-level id (provider-prefixed). */
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  /** Seconds. */
  duration: number;
  artwork: string;
  source: MusicSource;
  /** Canonical page URL on the provider (used by the downloader). */
  url?: string;
  /** 30s preview that can stream instantly while full audio resolves. */
  previewUrl?: string;
  providerId?: string;
  /** Popularity when the provider reports it. */
  plays?: number;
  explicit?: boolean;
  /** Upstream release date (ISO) when the provider reports it — powers "New". */
  releaseDate?: string;
  /** Spotify release shape of the track's album ("album" | "single" | "ep"). */
  albumType?: "album" | "single" | "ep";
}

export interface Artist {
  id: string;
  name: string;
  image: string;
  monthlyListeners?: number;
  verified?: boolean;
  bio?: string;
  source: MusicSource;
  url?: string;
  genre?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artwork: string;
  year?: number;
  type: "album" | "single" | "ep" | "compilation";
  /** Upstream release date (ISO) when the provider reports it. */
  releaseDate?: string;
  trackCount: number;
  duration: number;
  source: MusicSource;
  url?: string;
  tracks?: Track[];
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  artwork: string;
  owner: string;
  ownerId?: string;
  public: boolean;
  collaborative: boolean;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
  followers?: number;
}

export interface Podcast {
  id: string;
  title: string;
  publisher: string;
  artwork: string;
  description: string;
  episodeCount: number;
  source: MusicSource;
  url?: string;
}

export interface Episode {
  id: string;
  podcastId: string;
  title: string;
  description: string;
  artwork: string;
  duration: number;
  publishedAt: string;
  audioUrl?: string;
}

export interface Genre {
  id: string;
  name: string;
  color: string;
  gradient: string;
}

export interface Chart {
  id: string;
  name: string;
  description: string;
  artwork: string;
  tracks: Track[];
}

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  playlists: Playlist[];
  podcasts: Podcast[];
  total: number;
}

export type SearchSource = "soundcloud" | "spotify" | "youtube";

/* ---------- Resolved, playable audio ---------- */

export type ResolvableSource = "soundcloud" | "spotify" | "spotify-v2" | "ytmp3" | "applemusic";

export interface ResolvedAudio {
  audioUrl: string;
  duration?: number;
  artwork?: string;
  title?: string;
  artist?: string;
  /** Plain text or LRC — never fabricated. */
  lyrics?: string;
  quality?: string;
  provider: ResolvableSource;
  /** True when the URL is a short preview rather than the full track. */
  isPreview?: boolean;
  expiresAt?: number;
  /** True when audioUrl points at the engine host itself (stable-IP
      direct streaming) — played as-is, not re-proxied. */
  engineHost?: boolean;
}

/* ---------- Playback ---------- */

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackState {
  current: Track | null;
  queue: Track[];
  index: number;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  loading: boolean;
  buffering: boolean;
  error: string | null;
}

/* ---------- Auth / users ---------- */

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  bio?: string;
  role: "user" | "admin";
  createdAt: number;
  followers: string[];
  following: string[];
  recentlyPlayed: string[];
  likedTracks: Track[];
  savedAlbums: Album[];
  followedArtists: Artist[];
  followedPodcasts: string[];
  downloads: Track[];
  settings: UserSettings;
}

export interface UserSettings {
  audioQuality: "low" | "normal" | "high" | "lossless";
  crossfade: number;
  normalizeVolume: boolean;
  explicitContent: boolean;
  autoplay: boolean;
  theme: "midnight" | "ocean" | "midnight-contrast";
  language: string;
  notifications: boolean;
  downloadWifiOnly: boolean;
  privateSession: boolean;
  dataSaver: boolean;
}

export interface Session {
  user: PublicUser | null;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  bio?: string;
  role: "user" | "admin";
  createdAt: number;
}

/* ---------- API configuration (admin) ---------- */

export interface EndpointMapping {
  key: string;
  path: string;
  method: "GET" | "POST";
  description: string;
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  authHeader: string;
  authPrefix: string;
  docsUrl: string;
  timeoutMs: number;
  endpoints: EndpointMapping[];
  /** Upstream response -> normalized model field mapping (JSON path style). */
  responseMappings: Record<string, string>;
  requestHeaders: Record<string, string>;
}

/** ApiConfig with the secret key stripped — safe to send to the browser. */
export type PublicApiConfig = Omit<ApiConfig, "apiKey"> & {
  hasKey: boolean;
  status: ApiStatus;
};

export interface ApiStatus {
  ok: boolean;
  latencyMs?: number;
  message: string;
  checkedAt?: number;
  version?: string;
}

/* ---------- Admin / app settings ---------- */

export interface FeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
  description: string;
}

export interface HomeSectionConfig {
  id: string;
  title: string;
  enabled: boolean;
  kind: "tracks" | "playlists" | "artists" | "albums" | "charts" | "genres";
}

export interface AppSettings {
  appName: string;
  tagline: string;
  maintenanceMode: boolean;
  registrationOpen: boolean;
  guestMode: boolean;
  features: FeatureFlag[];
  homeSections: HomeSectionConfig[];
}

export interface ApiLogEntry {
  id: string;
  at: number;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  source: string;
  error?: string;
}

/* ---------- Generic ---------- */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
