import type { Track } from "@/types";

/* ============================================================
   SPOTIFY PLAYLIST IMPORTER
   Reads any public Spotify playlist from a URL — no user
   credentials. Two methods, mirroring the reference python
   script (spotify_playlist.py):

     pathfinder -> anonymous web-player session (read from the
                   public embed's __NEXT_DATA__), paginated in
                   100-track pages via the persisted web-player
                   query (protocol ref: omkarcloud/spotify-scraper)
     embed      -> public embed scrape fallback, capped ~100
   ============================================================ */

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query";
const PATHFINDER_PLAYLIST_HASH = "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0";
const SPOTIFY_APP_VERSION = "1.3.3.52.gba294495";
const TOKEN_EMBED_URL = "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const MAX_TRACKS = 200;

export interface SpotifyImport {
  name: string;
  owner: string | null;
  description: string | null;
  source: "pathfinder" | "embed";
  tracks: Track[];
}

export function extractPlaylistId(url: string): string {
  const match = url.match(/(?:playlist[/:])([A-Za-z0-9]{22})/);
  if (!match) throw new Error(`No playlist ID found in: ${url}`);
  return match[1];
}

/** Fetch JSON with a timeout; errors propagate to the caller. */
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

/* ---------- Pathfinder (anonymous web-player API) ---------- */

type Session = { token: string };

async function exchangePathfinderToken(): Promise<Session> {
  const html = await fetchText(TOKEN_EMBED_URL, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    timeoutMs: 25000,
  });
  const state = nextData(html) as {
    props?: { pageProps?: { state?: { settings?: { session?: { accessToken?: string; isAnonymous?: boolean } } } } };
  };
  const session = state.props?.pageProps?.state?.settings?.session;
  if (!session?.accessToken || session.isAnonymous !== true) {
    throw new Error("Spotify did not provide a usable public-playlist session.");
  }
  return { token: session.accessToken };
}

async function pathfinderPage(pid: string, offset: number, limit: number, session: Session): Promise<Record<string, unknown>> {
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
  const headers = {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    authorization: `Bearer ${session.token}`,
    "app-platform": "WebPlayer",
    "spotify-app-version": SPOTIFY_APP_VERSION,
    origin: "https://open.spotify.com",
    referer: "https://open.spotify.com/",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${PATHFINDER_URL}?${params}`, {
      headers,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    if (res.status === 401 && attempt < 2) {
      Object.assign(session, await exchangePathfinderToken());
      continue;
    }
    if (!res.ok) throw new Error(`Spotify playlist query failed (${res.status})`);
    const body = (await res.json()) as { errors?: Array<{ message?: string }>; data?: { playlistV2?: Record<string, unknown> } };
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message ?? "query failed").join("; "));
    }
    const entity = body.data?.playlistV2;
    if (!entity) throw new Error("Spotify returned no public playlist data.");
    return entity;
  }
  throw new Error("Spotify rate-limited playlist import after retries.");
}

function normalizePathfinderTrack(row: unknown): Track | null {
  const wrapper = (row as { itemV2?: { data?: unknown } })?.itemV2?.data;
  const track = wrapper as {
    name?: string;
    uri?: string;
    artists?: { items?: Array<{ profile?: { name?: string } }> };
    albumOfTrack?: {
      name?: string;
      artists?: { items?: Array<{ profile?: { name?: string } }> };
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
    duration: track.trackDuration?.totalMilliseconds && track.trackDuration.totalMilliseconds > 0
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
    const limit = Math.min(100, MAX_TRACKS - tracks.length);
    const entity = await pathfinderPage(pid, offset, limit, session);
    const content = (entity.content ?? {}) as {
      items?: unknown[];
      totalCount?: number;
    };

    if (!name) {
      const ownerData = ((entity.ownerV2 as { data?: Record<string, unknown> } | undefined)?.data ?? {}) as { name?: string; display_name?: string };
      name = (entity.name as string) ?? "";
      owner = ownerData.name ?? ownerData.display_name ?? null;
      description = (entity.description as string) ?? null;
      total = content.totalCount ?? 0;
    }

    const rows = content.items ?? [];
    for (const row of rows) {
      const track = normalizePathfinderTrack(row);
      if (track && !tracks.some((t) => t.id === track.id)) tracks.push(track);
      if (tracks.length >= MAX_TRACKS) break;
    }
    offset += rows.length;
    if (!rows.length || (total && offset >= total) || rows.length < limit) break;
  }

  if (!tracks.length) throw new Error("This playlist has no importable songs or is not public.");
  return { name: name || "Imported playlist", owner, description, source: "pathfinder", tracks };
}

/* ---------- Embed fallback (capped ~100) ---------- */

async function fetchViaEmbed(pid: string): Promise<SpotifyImport> {
  const html = await fetchText(`https://open.spotify.com/embed/playlist/${pid}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    timeoutMs: 20000,
  });
  const state = nextData(html) as {
    props?: { pageProps?: { state?: { data?: { entity?: Record<string, unknown> } } } };
  };
  const entity = state.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error("Unexpected embed JSON schema.");

  const raw = (entity.trackList ?? []) as Array<{
    title?: string;
    subtitle?: string;
    uri?: string;
    duration?: number;
    image?: string;
  }>;

  const tracks: Track[] = [];
  for (const t of raw.slice(0, MAX_TRACKS)) {
    const trackId = typeof t.uri === "string" ? t.uri.split(":").pop() : undefined;
    if (!t.title || !trackId) continue;
    tracks.push({
      id: `spotify-${trackId}`,
      title: t.title,
      artist: t.subtitle ?? "",
      duration: t.duration && t.duration > 0 ? Math.round(t.duration / 1000) : 0,
      artwork: t.image ?? "",
      source: "spotify",
      url: `https://open.spotify.com/track/${trackId}`,
    });
  }
  if (!tracks.length) throw new Error("This playlist has no importable songs or is not public.");

  return {
    name: (entity.name as string) ?? "Imported playlist",
    owner: ((entity.subtitle as string) ?? "").trim() || null,
    description: (entity.description as string) ?? null,
    source: "embed",
    tracks,
  };
}

/** auto = pathfinder, then embed fallback. */
export async function importSpotifyPlaylist(url: string): Promise<SpotifyImport> {
  const pid = extractPlaylistId(url.trim());
  let lastError: unknown = null;
  for (const method of [fetchViaPathfinder, fetchViaEmbed]) {
    try {
      return await method(pid);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    lastError instanceof Error ? `Spotify import failed: ${lastError.message}` : "Spotify import failed.",
  );
}
