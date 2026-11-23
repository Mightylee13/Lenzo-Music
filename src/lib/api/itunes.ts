import "server-only";
import type { Track } from "@/types";
import { deezerReleaseLookup } from "@/lib/api/deezer";

/* ============================================================
   ITUNES RELEASE ENRICHMENT (server-only, no API key)

   The primary upstream's search.spotify results carry no
   releaseDate and no albumType — the app therefore could never
   show the "New · " badge and could only *guess* EP/Single from
   how many tracks a search window happened to surface.

   iTunes' open search fills both gaps: each matched collection
   carries a releaseDate and the authoritative trackCount, so
   release-shape rules (≤3 tracks = Single, ≤6 = EP, else Album)
   become real data instead of guesswork. Failures are silent —
   decoration is best-effort and must never slow or break search.
   ============================================================ */

interface ItunesCollection {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  trackCount?: number;
  releaseDate?: string;
}

/** TrackCount → release shape, mirroring Spotify's own rules. */
function shapeFromTrackCount(trackCount: number): Track["albumType"] {
  if (trackCount <= 3) return "single";
  if (trackCount <= 6) return "ep";
  return "album";
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Edition decorations ("(Expanded Edition)", "- 2003 Remaster") break exact
 *  title matching — compare on the bare album name too. */
function baseAlbumName(title: string): string {
  const base = title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s[-–]\s.*(remaster|deluxe|expanded|anniversary|edition|bonus|version|remixes?|mono|stereo).*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || title;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/* iTunes is a free service that rate-limits per IP (loosely ~20 req/min).
   Album metadata is effectively immutable, so results are cached in-memory
   for 24h, requests run through a tiny concurrency cap, and a 403/429 gets
   one backoff retry before giving up silently. */
const LOOKUP_CACHE = new Map<string, { expires: number; value: unknown }>();
const LOOKUP_TTL = 24 * 3600_000;
let activeLookups = 0;
const WAITERS: Array<() => void> = [];
/* When Apple answers 403/429 the wholeSource is cooling down — hammering it
   with retries just adds latency to every search. Breaker opens for 3 min. */
let itunesCooldownUntil = 0;

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeLookups >= 2) {
    await new Promise<void>((resolve) => WAITERS.push(resolve));
  }
  activeLookups++;
  try {
    return await run();
  } finally {
    activeLookups--;
    WAITERS.shift()?.();
  }
}

async function fetchItunes(path: string): Promise<unknown | null> {
  if (Date.now() < itunesCooldownUntil) return null;
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  try {
    let res = await fetch(`https://itunes.apple.com/${path}`, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
      headers,
    });
    if (res.status === 403 || res.status === 429) {
      // Rate-limited: open the breaker so nothing else pays this cost, and
      // give Apple one short-breathing retry before giving up.
      itunesCooldownUntil = Date.now() + 3 * 60_000;
      const retry = await fetch(`https://itunes.apple.com/${path}`, {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
        headers,
      });
      return retry.ok ? await retry.json() : null;
    }
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function lookupRelease(
  albumTitle: string,
  mainArtist: string,
): Promise<ItunesCollection | null> {
  const term = [baseAlbumName(albumTitle), mainArtist].filter(Boolean).join(" ").trim();
  if (!term) return null;
  const cacheKey = `album:${slug(term)}`;
  const cached = LOOKUP_CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value as ItunesCollection | null;

  const value = await withSlot(async () => {
    const body = (await fetchItunes(
      `search?entity=album&limit=8&term=${encodeURIComponent(term)}`,
    )) as { results?: ItunesCollection[] } | null;
    const collections = body?.results ?? [];
    const fullSlug = slug(albumTitle);
    const baseSlug = slug(baseAlbumName(albumTitle));
    const artistSlug = slug(mainArtist);
    // Eligibility first (never match a different artist's same-named album),
    // then preference among the eligible.
    const scored = collections
      .map((c) => {
        const name = slug(c.collectionName ?? "");
        const artist = slug(c.artistName ?? "");
        const nameSlug =
          name === fullSlug || name === baseSlug
            ? name
            : name.startsWith(baseSlug) || baseSlug.startsWith(name)
              ? name
              : name.startsWith(fullSlug) || fullSlug.startsWith(name)
                ? name
                : null;
        const eligible = nameSlug !== null && (artist === artistSlug || (artistSlug.length > 0 && artist.includes(artistSlug)));
        if (!eligible) return null;
        let score = 0;
        if (name === fullSlug) score += 30;
        else if (name === baseSlug) score += 28;
        if (artist === artistSlug) score += 20;
        if (c.trackCount && c.releaseDate) score += 5;
        return { c, score };
      })
      .filter((x): x is { c: ItunesCollection; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.c ?? null;
  });
  // A miss is not a truth: cache hits for a day, but a miss (e.g. a brief
  // 403 rate-limit) only for a minute so it is not baked in for 24h.
  const ttl = value ? LOOKUP_TTL : 60_000;
  LOOKUP_CACHE.set(cacheKey, { expires: Date.now() + ttl, value });
  return value;
}

/**
 * Fills `releaseDate` and `albumType` on every track of every album group
 * iTunes can identify. One iTunes request per unique album — parallel,
 * each bounded to 5s, and never fatal.
 */
export async function decorateWithItunesReleases(tracks: Track[]): Promise<Track[]> {
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const album = (t.album ?? "").trim();
    if (!album) continue;
    const mainArtist = (t.artist.split(",")[0] ?? t.artist).trim();
    const key = `${slug(album)}::${slug(mainArtist)}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  if (groups.size === 0) return tracks;

  const work = Promise.allSettled(
    [...groups.values()].map(async (group) => {
      const first = group[0];
      const mainArtist = (first.artist.split(",")[0] ?? first.artist).trim();
      let releaseDate: string | undefined;
      let shape: Track["albumType"] | undefined;

      const release = await lookupRelease(first.album as string, mainArtist);
      if (release) {
        releaseDate = release.releaseDate?.slice(0, 10);
        if (typeof release.trackCount === "number" && release.trackCount > 0) {
          shape = shapeFromTrackCount(release.trackCount);
        }
      }
      if (!releaseDate || !shape) {
        // Apple missed (not listed, or rate-limited) — Deezer is the second
        // catalogue with real track counts, no key, no throttle drama.
        const dz = await deezerReleaseLookup(first.album as string, mainArtist);
        if (dz) {
          releaseDate = releaseDate ?? dz.releaseDate;
          shape = shape ?? shapeFromTrackCount(dz.trackCount);
        }
      }
      if (!releaseDate && !shape) return;
      for (const t of group) {
        if (!t.releaseDate && releaseDate) t.releaseDate = releaseDate;
        if (!t.albumType && shape) t.albumType = shape;
      }
    }),
  );
  // Never let a slow/rate-limited iTunes stretch search out: answer with what
  // is decorated by the deadline. In-flight lookups keep running and land in
  // the 24h lookup cache, so the *next* search for the same things is instant.
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, 4000))]);

  return tracks;
}
