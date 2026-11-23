import "server-only";

/* ============================================================
   DEEZER PUBLIC API (server-only, no API key)

   Second opinion for release metadata: track counts and release
   dates straight from Deezer's catalogue. Generous public limits,
   sub-second responses — used as backup when Apple's rate-limits
   and for instant suggestions.
   ============================================================ */

interface DeezerAlbum {
  id?: number;
  title?: string;
  artist?: { name?: string };
  nb_tracks?: number;
  release_date?: string;
  cover_big?: string;
  cover_medium?: string;
}

const CACHE = new Map<string, { expires: number; value: unknown }>();
const TTL = 24 * 3600_000;
const MISS_TTL = 90_000;
let cooldownUntil = 0;

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function deezerJson<T>(path: string, timeoutMs = 5000): Promise<T | null> {
  if (Date.now() < cooldownUntil) return null; // circuit breaker
  try {
    const res = await fetch(`https://api.deezer.com/${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (res.status === 403 || res.status === 429) {
      cooldownUntil = Date.now() + 5 * 60_000;
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);
  return run().then((value) => {
    CACHE.set(key, { expires: Date.now() + (value ? TTL : MISS_TTL), value });
    return value;
  });
}

/**
 * Release facts for an album: real track count (→ singleness/EP/album),
 * release date, cover. `null` when Deezer does not have the release.
 */
export async function deezerReleaseLookup(
  albumTitle: string,
  mainArtist: string,
): Promise<{ trackCount: number; releaseDate?: string; cover?: string } | null> {
  const album = albumTitle
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const term = [album, mainArtist].filter(Boolean).join(" ").trim();
  if (!term) return null;
  return cached(`album:${slug(term)}`, async () => {
    const body = await deezerJson<{ data?: DeezerAlbum[] }>(
      `search/album?limit=8&q=${encodeURIComponent(term)}`,
    );
    const albumSlug = slug(album);
    const artistSlug = slug(mainArtist);
    for (const a of body?.data ?? []) {
      const name = slug(a.title ?? "");
      const artist = slug(a.artist?.name ?? "");
      if (!name || !artist || !a.nb_tracks) continue;
      const nameOk = name === albumSlug || name.startsWith(albumSlug) || albumSlug.startsWith(name);
      const artistOk = artist.includes(artistSlug) || artistSlug.includes(artist);
      if (!nameOk || !artistOk) continue;
      return {
        trackCount: a.nb_tracks,
        releaseDate: a.release_date?.slice(0, 10),
        cover: a.cover_big ?? a.cover_medium,
      };
    }
    return null;
  });
}

/** Fast suggestion strings — sub-second, cached. */
export async function deezerSearchTitles(query: string, limit = 8): Promise<string[]> {
  return cached(`titles:${slug(query)}:${limit}`, async () => {
    const body = await deezerJson<{ data?: Array<{ title?: string; artist?: { name?: string } }> }>(
      `search?limit=${limit}&q=${encodeURIComponent(query)}`,
    );
    return (body?.data ?? [])
      .map((t) => [t.title, t.artist?.name].filter(Boolean).join(" - "))
      .filter((s): s is string => Boolean(s))
      .slice(0, limit);
  });
}
