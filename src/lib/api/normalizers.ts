import type { Album, Artist, MusicSource, Playlist, Track } from "@/types";

/* ============================================================
   NORMALIZERS
   ------------------------------------------------------------
   Each upstream provider shapes its payload differently. These
   functions map every response onto the shared domain models so
   the UI only ever consumes `Track` / `Artist` / `Album`.
   ============================================================ */

export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

/** "3:43" | "1:05:30" | "4.23" → seconds. Returns 0 when unparseable. */
export function parseDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // YouTube-ish numbers are sometimes seconds, sometimes m.ss.
    return value > 0 && value < 1000 ? Math.round(value) : Math.round(value);
  }
  if (typeof value !== "string") return 0;
  const parts = value.trim().split(/[:.]/).map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.replace(/[^\d.]/g, "")) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

const ARTWORK_FALLBACKS = [
  "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=70",
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=70",
  "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=70",
];

export function fallbackArtwork(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return ARTWORK_FALLBACKS[hash % ARTWORK_FALLBACKS.length];
}

export function artwork(value: unknown, seed: string): string {
  const url = str(value);
  return url || fallbackArtwork(seed);
}

/** True for SoundCloud profile URLs (artist pages, not playable tracks). */
export function isSoundCloudProfile(url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length <= 1;
  } catch {
    return false;
  }
}

/**
 * True for SoundCloud set URLs (`/artist/sets/slug`) — EPs, albums and
 * playlists uploaded as collections. A set is a RELEASE, never a song:
 * treating one as a playable track makes the resolver title-search it
 * against Spotify and stream a completely different song.
 */
export function isSoundCloudSet(url: string): boolean {
  try {
    return new URL(url).pathname.split("/").includes("sets");
  } catch {
    return false;
  }
}

/* ---------- SoundCloud search ---------- */

interface SoundCloudItem {
  title?: unknown;
  artist?: unknown;
  thumbnail?: unknown;
  url?: unknown;
}

export function normalizeSoundCloudTracks(raw: unknown, source: MusicSource = "soundcloud"): {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
} {
  const body = asRecord(raw);
  const list = Array.isArray(body?.result) ? (body.result as SoundCloudItem[]) : [];
  const tracks: Track[] = [];
  const artists: Artist[] = [];
  const albums: Album[] = [];

  for (const item of list) {
    const url = str(item.url);
    const title = str(item.title, "Unknown track");
    const artist = str(item.artist, "Unknown artist");

    if (url && isSoundCloudProfile(url)) {
      artists.push({
        id: `ar_${slug(artist || title)}`,
        name: artist || title,
        image: artwork(item.thumbnail, artist || title),
        source,
        url,
      });
      continue;
    }

    // A set is a release (EP/album upload), not a song: surface it as a
    // non-playable EP row that carries the uploader's SoundCloud URL, so
    // it never enters the playable track list. SoundCloud does not report
    // release shape or track count in search results, so EPs are the
    // default assumption for releases surfacing next to song hits.
    if (url && isSoundCloudSet(url)) {
      albums.push({
        id: `al_${slug(`${title}-${artist}`)}`,
        title,
        artist,
        artistId: `ar_${slug(artist)}`,
        artwork: artwork(item.thumbnail, `${artist}-${title}`),
        type: "ep",
        trackCount: 0,
        duration: 0,
        source,
        url,
      });
      continue;
    }

    tracks.push({
      id: `tr_sc_${slug(url || `${artist}-${title}`)}`,
      title,
      artist,
      artistId: `ar_${slug(artist)}`,
      duration: 0,
      artwork: artwork(item.thumbnail, `${artist}-${title}`),
      source,
      url,
      providerId: url,
    });
  }

  return { tracks, artists, albums };
}

/* ---------- Spotify search ---------- */

interface SpotifyItem {
  name?: unknown;
  artists?: unknown;
  artist?: unknown;
  album?: unknown;
  albumName?: unknown;
  /** Spotify release shape of the album: "album" | "single" | "ep" (or "EP" — normalised). */
  albumType?: unknown;
  album_type?: unknown;
  /** ISO release date, used for "New" markers. */
  releaseDate?: unknown;
  release_date?: unknown;
  duration?: unknown;
  uri?: unknown;
  spotifyUrl?: unknown;
  url?: unknown;
  cover?: unknown;
  image?: unknown;
  id?: unknown;
  previewUrl?: unknown;
  popularity?: unknown;
}

export function normalizeSpotifyTracks(raw: unknown, source: MusicSource = "spotify"): Track[] {
  const body = asRecord(raw);
  const list = Array.isArray(body?.result) ? (body.result as SpotifyItem[]) : [];
  const tracks: Track[] = [];

  // album_type comes in as "album" | "single" | "ep" (sometimes "EP").
  const albumTypeOf = (v: unknown): Track["albumType"] | undefined => {
    const t = str(v).toLowerCase();
    return t === "album" || t === "single" || t === "ep" ? t : undefined;
  };
  const releaseDateOf = (v: unknown): string | undefined => {
    const d = str(v);
    return /^\d{4}(-\d{2}(-\d{2})?)?/.test(d) ? d : undefined;
  };

  for (const item of list) {
    const title = str(item.name, "Unknown track");
    const rawArtists = item.artists ?? item.artist;
    const artist = Array.isArray(rawArtists)
      ? rawArtists.map((a) => str(a)).join(", ")
      : str(rawArtists, "Unknown artist");
    const album = str(item.album ?? item.albumName);
    const url = str(item.spotifyUrl ?? item.url);
    const preview = str(item.previewUrl);
    if (!url && !preview) continue;

    tracks.push({
      id: `tr_sp_${str(item.id, slug(`${artist}-${title}`))}`,
      title,
      artist,
      artistId: `ar_${slug(artist.split(",")[0])}`,
      album,
      albumId: album ? `al_${slug(`${album}-${artist.split(",")[0]}`)}` : undefined,
      duration: parseDuration(item.duration),
      artwork: artwork(item.cover ?? item.image, `${artist}-${title}`),
      source,
      url,
      previewUrl: preview || undefined,
      providerId: str(item.id),
      plays: num(item.popularity),
      releaseDate: releaseDateOf(item.releaseDate ?? item.release_date),
      albumType: albumTypeOf(item.albumType ?? item.album_type),
    });
  }

  return tracks;
}

/* ---------- YouTube search ---------- */

interface YouTubeItem {
  videoId?: unknown;
  title?: unknown;
  url?: unknown;
  duration?: unknown;
  views?: unknown;
  channel?: unknown;
  channelUrl?: unknown;
  thumbnail?: unknown;
  description?: unknown;
}

export function normalizeYouTubeTracks(raw: unknown, source: MusicSource = "youtube"): Track[] {
  const body = asRecord(raw);
  const list = Array.isArray(body?.data) ? (body.data as YouTubeItem[]) : Array.isArray(body?.result) ? (body.result as YouTubeItem[]) : [];
  const tracks: Track[] = [];

  for (const item of list) {
    const title = str(item.title, "Unknown track");
    let channel = str(item.channel, "Unknown artist");
    // "Artist - Topic" channels ARE the official artist — the suffix is
    // YouTube's auto-generated naming, not a feat. Strip it so the row
    // shows the real name instead of platform boilerplate.
    channel = channel.replace(/\s*-\s*topic\s*$/i, "").trim() || channel;
    const url = str(item.url);
    const videoId = str(item.videoId);
    if (!url && !videoId) continue;

    tracks.push({
      id: `tr_yt_${videoId || slug(url)}`,
      title,
      artist: channel,
      artistId: `ar_${slug(channel)}`,
      duration: parseDuration(item.duration),
      artwork: artwork(item.thumbnail, `${channel}-${title}`),
      source,
      url: url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined),
      providerId: videoId || undefined,
      plays: parseViews(str(item.views)),
    });
  }

  return tracks;
}

function parseViews(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d.]/g, " ").trim().split(/\s+/)[0];
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/* ---------- Album grouping ---------- */

/**
 * Builds real albums by grouping tracks that share an album name and
 * main artist. This is how the app derives albums — the upstream search
 * endpoints return flat track lists, never album objects — so every
 * album card in the UI is backed by actual playable tracks.
 */
export function albumsFromTracks(tracks: Track[]): Album[] {
  const groups = new Map<string, { album: Album; reported?: Album["type"]; tracks: Track[] }>();
  for (const t of tracks) {
    if (!str(t.album)) continue;
    const mainArtist = (t.artist.split(",")[0] ?? t.artist).trim() || "Unknown artist";
    const id = `al_${slug(`${t.album}-${mainArtist}`)}`;
    const group = groups.get(id);
    if (group) {
      // Search pages often repeat the same track — drop exact duplicates.
      const dedupeKey = `${slug(t.title)}::${t.duration || "na"}`;
      if (!group.tracks.some((x) => `${slug(x.title)}::${x.duration || "na"}` === dedupeKey)) {
        group.tracks.push(t);
      }
      // Remember a reported release shape from any track in the group.
      if (!group.reported && t.albumType) group.reported = t.albumType;
      continue;
    }
    // `reported` is tracked separately from `album.type` (which needs a
    // placeholder) so that "the provider said nothing" stays distinguishable
    // from "the provider said album" — only then can inference run below.
    const earliest = t.releaseDate;
    groups.set(id, {
      album: {
        id,
        title: t.album as string,
        artist: mainArtist,
        artistId: t.artistId ?? `ar_${slug(mainArtist)}`,
        artwork: t.artwork,
        type: t.albumType ?? "album",
        trackCount: 1,
        duration: t.duration || 0,
        source: t.source,
        releaseDate: earliest,
      },
      reported: t.albumType,
      tracks: [t],
    });
  }
  return [...groups.values()].map((g) => {
    // Sped-up / slowed-down re-uploads are not album songs. Drop them when
    // the group still holds the genuine track(s); an underground release whose
    // only surfaced versions are variants stays intact rather than emptying.
    const VARIANT_RE = /(\s*[-–]\s*)?(sped\s*up|slowed(\s*down)?(\s*\+?\s*reverb)?|nightcore)$/i;
    const cleaned = g.tracks.filter((t) => !VARIANT_RE.test(t.title.trim()));
    const tracks = cleaned.length > 0 ? cleaned : g.tracks;
    const duration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    // Honest inference: a search window only surfaces a slice of an album —
    // claiming "EP"/"Single" from that slice mislabeled real albums, so the
    // window alone may only call a lone track a single. Real shapes (the
    // catalogue's reported albumType) always win below.
    const inferred: Album["type"] = tracks.length <= 1 ? "single" : "album";
    return {
      ...g.album,
      type: g.reported ?? inferred,
      trackCount: tracks.length,
      duration,
      tracks,
    };
  });
}

/**
 * Merges album lists collected from several sources (grouped tracks plus
 * provider-native album objects, e.g. SoundCloud sets). Exact-id duplicates
 * collapse, and a trackless album (a set whose contents we could not fetch)
 * never shadows a real, track-backed release carrying the same title — the
 * playable one is what the user wants to open.
 */
export function mergeAlbums(...lists: Album[][]): Album[] {
  const withTracks: Album[] = [];
  const trackless: Album[] = [];
  for (const list of lists) {
    for (const a of list) (a.trackCount > 0 ? withTracks : trackless).push(a);
  }
  const out: Album[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const a of [...withTracks, ...trackless]) {
    if (ids.has(a.id)) continue;
    const title = slug(a.title);
    if (a.trackCount === 0 && titles.has(title)) continue;
    ids.add(a.id);
    titles.add(title);
    out.push(a);
  }
  return out;
}

/* ---------- Spotify artist / album search (when supported) ---------- */

export function normalizeSpotifyArtists(raw: unknown): Artist[] {
  const body = asRecord(raw);
  const list = Array.isArray(body?.result) ? (body.result as SpotifyItem[]) : [];
  return list
    .filter((i) => str(i.name))
    .map((i) => ({
      id: `ar_${slug(str(i.name))}`,
      name: str(i.name),
      image: artwork(i.image ?? i.cover, str(i.name)),
      source: "spotify" as const,
      url: str(i.spotifyUrl ?? i.url) || undefined,
      monthlyListeners: num(i.popularity),
    }));
}

export function normalizeSpotifyAlbums(raw: unknown): Album[] {
  const body = asRecord(raw);
  const list = Array.isArray(body?.result) ? (body.result as SpotifyItem[]) : [];
  return list
    .filter((i) => str(i.name ?? i.album))
    .map((i) => {
      const title = str(i.name ?? i.album);
      const artist = str(i.artists ?? i.artist, "Unknown artist");
      return {
        id: `al_${slug(`${title}-${artist}`)}`,
        title,
        artist,
        artistId: `ar_${slug(artist.split(",")[0])}`,
        artwork: artwork(i.cover ?? i.image, `${title}-${artist}`),
        type: "album" as const,
        trackCount: 0,
        duration: 0,
        source: "spotify" as const,
        url: str(i.spotifyUrl ?? i.url) || undefined,
      };
    });
}

/* ---------- Playlist / chart helpers ---------- */

export function playlistFromTracks(
  id: string,
  name: string,
  description: string,
  tracks: Track[],
  owner = "Lenzo Music"
): Playlist {
  const now = Date.now();
  return {
    id,
    name,
    description,
    artwork: tracks[0]?.artwork ?? fallbackArtwork(name),
    owner,
    public: true,
    collaborative: false,
    tracks,
    createdAt: now,
    updatedAt: now,
    followers: tracks.length * 137,
  };
}
