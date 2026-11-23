import type { Track } from "@/types";

/* ============================================================
   SPOTIFY PLAYLIST IMPORTER
   Reads any public Spotify playlist from a URL — no user
   credentials.

   Single strategy (the old embed/main-page HTML scrapes were
   removed: Spotify made those pages client-rendered, so no
   track data exists in the HTML anymore):

     pathfinder -> anonymous web-player session token (read from
                   a public track embed's __NEXT_DATA__), then
                   paginated 100-track pages via the persisted
                   web-player GraphQL query
                   (protocol ref: omkarcloud/spotify-scraper)

   Failure rules:
     - 401 / expired/invalid token  -> exchange a fresh token once
     - network blip / 5xx           -> one whole-flow retry
     - __typename "NotFound"        -> playlist is private, deleted
                                       or region-locked (clear user
                                       error, no useless fallback)
   ============================================================ */

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query";
const PATHFINDER_PLAYLIST_HASH = "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0";
const SPOTIFY_APP_VERSION = "1.3.3.52.gba294495";
const TOKEN_EMBED_URL = "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const MAX_TRACKS = 200;
const PAGE_LIMIT = 100;

export interface SpotifyImport {
  name: string;
  owner: string | null;
  description: string | null;
  source: "pathfinder";
  tracks: Track[];
}

export class SpotifyImportError extends Error {
  /** true when the playlist itself can't be seen (private/deleted) vs. a transient fault */
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "SpotifyImportError";
    this.permanent = permanent;
  }
}

export function extractPlaylistId(url: string): string {
  const trimmed = url.trim();
  // bare 22-char ID, spotify:playlist:<id> URI, or any oembed/open URL containing the ID
  const match = trimmed.match(/(?:playlist[/:])([A-Za-z0-9]{22})/) ?? trimmed.match(/^([A-Za-z0-9]{22})$/);
  if (!match) throw new SpotifyImportError(`No playlist ID found in: ${trimmed}`, true);
  return match[1];
}

/** Fetch text with a timeout; errors propagate to the caller. */
async function fetchText(url: string, init: RequestInit & { timeoutMs: number }): Promise<string> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(init.timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/* ---------- __NEXT_DATA__ parsing ---------- */

const NEXT_DATA_RE = /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function nextData(html: string): Record<string, unknown> {
  const match = NEXT_DATA_RE.exec(html);
  if (!match) throw new Error("Spotify page did not expose __NEXT_DATA__ (layout changed).");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

/* ---------- Anonymous web-player session ---------- */

type Session = { token: string };

async function exchangePathfinderToken(): Promise<Session> {
  const html = await fetchText(TOKEN_EMBED_URL, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml" },
    timeoutMs: 25000,
  });
  const state = nextData(html) as {
    props?: { pageProps?: { state?: { settings?: { session?: { accessToken?: string; isAnonymous?: boolean } } } } };
  };
  const session = state.props?.pageProps?.state?.settings?.session;
  if (!session?.accessToken) {
    throw new SpotifyImportError("Spotify did not provide a usable public-playlist session.", false);
  }
  return { token: session.accessToken };
}

/* ---------- Pathfinder (anonymous web-player API) ---------- */

/** Thrown when retries should refresh the token and retry the page. */
class TokenError extends Error {}

interface PlaylistEntity extends Record<string, unknown> {
  __typename?: string;
  name?: string;
  description?: string;
  ownerV2?: { data?: { name?: string; display_name?: string } };
  content?: { items?: unknown[]; totalCount?: number };
}

function playlistQuery(pid: string, offset: number, limit: number): string {
  const variables = {
    uri: `spotify:playlist:${pid}`,
    offset,
    limit,
    enableWatchFeedEntrypoint: false,
    includeEpisodeContentRatingsV2: false,
  };
  const params = new URLSearchParams({
    operationName: "fetchPlaylist",
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: PATHFINDER_PLAYLIST_HASH } }),
  });
  return `${PATHFINDER_URL}?${params}`;
}

async function pathfinderPage(pid: string, offset: number, limit: number, session: Session): Promise<PlaylistEntity> {
  const url = playlistQuery(pid, offset, limit);

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          authorization: `Bearer ${session.token}`,
          "app-platform": "WebPlayer",
          "spotify-app-version": SPOTIFY_APP_VERSION,
          origin: "https://open.spotify.com",
          referer: "https://open.spotify.com/",
        },
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
    } catch {
      if (attempt < 2) {
        Object.assign(session, await exchangePathfinderToken());
        continue;
      }
      throw new SpotifyImportError("Could not reach Spotify (network error). Try again.", false);
    }

    if (res.status === 401 || res.status === 403) {
      if (attempt < 2) {
        Object.assign(session, await exchangePathfinderToken());
        continue;
      }
      throw new SpotifyImportError("Spotify rejected the anonymous session.", false);
    }
    if (res.status === 429) {
      throw new SpotifyImportError("Spotify is rate-limiting playlist imports — wait a minute and retry.", false);
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < 2) {
        Object.assign(session, await exchangePathfinderToken());
        continue;
      }
      throw new SpotifyImportError(`Spotify playlist query failed (${res.status}).`, false);
    }

    const body = (await res.json()) as {
      errors?: Array<{ message?: string }>;
      data?: { playlistV2?: PlaylistEntity };
    };
    if (body.errors?.length) {
      throw new SpotifyImportError(body.errors.map((e) => e.message ?? "query failed").join("; "), false);
    }
    const entity = body.data?.playlistV2;
    if (!entity) throw new SpotifyImportError("Spotify returned no public playlist data.", false);
    if (entity.__typename === "NotFound") {
      throw new SpotifyImportError(
        "Playlist not found — it may be private, deleted, or region-locked.",
        true,
      );
    }
    return entity;
  }
  throw new SpotifyImportError("Spotify rate-limited playlist import after retries.", false);
}

function normalizePathfinderTrack(row: unknown): Track | null {
  const wrapper = (row as { itemV2?: { data?: unknown } })?.itemV2?.data;
  const track = wrapper as {
    name?: string;
    uri?: string;
    artists?: { items?: Array<{ profile?: { name?: string } }> };
    albumOfTrack?: {
      name?: string;
      coverArt?: { sources?: Array<{ url?: string; width?: number }> };
    };
    trackDuration?: { totalMilliseconds?: number };
  };
  if (!track?.name || !track.uri) return null;

  const artistNames = (track.artists?.items ?? [])
    .map((a) => a.profile?.name)
    .filter((n): n is string => Boolean(n));
  const artists = artistNames.join(", ");
  if (!artists) return null;

  const album = track.albumOfTrack ?? {};
  const coverSources = (album.coverArt?.sources ?? []).filter((s): s is { url: string; width?: number } => Boolean(s.url));
  const artwork = coverSources.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";
  const trackId = track.uri.split(":").pop() ?? "";
  if (!trackId) return null;

  return {
    id: `spotify-${trackId}`,
    title: track.name,
    artist: artists,
    album: album.name || undefined,
    duration:
      track.trackDuration?.totalMilliseconds && track.trackDuration.totalMilliseconds > 0
        ? Math.round(track.trackDuration.totalMilliseconds / 1000)
        : 0,
    artwork,
    source: "spotify",
    url: `https://open.spotify.com/track/${trackId}`,
  };
}

async function fetchViaPathfinder(pid: string): Promise<SpotifyImport> {
  const session = await exchangePathfinderToken();
  let offset = 0;
  let total = 0;
  const tracks: Track[] = [];
  let name = "";
  let owner: string | null = null;
  let description: string | null = null;

  while (tracks.length < MAX_TRACKS) {
    const limit = Math.min(PAGE_LIMIT, MAX_TRACKS - tracks.length);
    const entity = await pathfinderPage(pid, offset, limit, session);
    const content = entity.content ?? {};
    const rows = content.items ?? [];

    if (!name) {
      const ownerData = entity.ownerV2?.data ?? {};
      name = entity.name ?? "";
      owner = ownerData.name ?? ownerData.display_name ?? null;
      description = entity.description ?? null;
      total = content.totalCount ?? 0;
    }

    for (const row of rows) {
      const track = normalizePathfinderTrack(row);
      if (track && !tracks.some((t) => t.id === track.id)) tracks.push(track);
      if (tracks.length >= MAX_TRACKS) break;
    }
    offset += rows.length;
    if (!rows.length || (total && offset >= total) || rows.length < limit) break;
  }

  if (!tracks.length) {
    throw new SpotifyImportError("This playlist has no importable songs or is not public.", true);
  }
  return { name: name || "Imported playlist", owner, description, source: "pathfinder", tracks };
}

/**
 * Import a public Spotify playlist. One whole-flow retry on transient
 * failures; permanent failures (not-found etc.) fail immediately with a
 * clear message.
 */
export async function importSpotifyPlaylist(url: string): Promise<SpotifyImport> {
  const pid = extractPlaylistId(url);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchViaPathfinder(pid);
    } catch (err) {
      lastError = err;
      if (err instanceof SpotifyImportError && err.permanent) break;
    }
  }
  if (lastError instanceof SpotifyImportError) throw lastError;
  throw new SpotifyImportError(
    lastError instanceof Error ? `Spotify import failed: ${lastError.message}` : "Spotify import failed.",
    false,
  );
}
