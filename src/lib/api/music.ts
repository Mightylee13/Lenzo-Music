import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { ApiError, callUpstream } from "@/lib/api/client";
import { backupResolve, backupSearchTracks } from "@/lib/api/backup";
import { decorateWithItunesReleases } from "@/lib/api/itunes";
import { deezerSearchTitles } from "@/lib/api/deezer";
import {
  albumsFromTracks,
  isSoundCloudSet,
  mergeAlbums,
  normalizeSoundCloudTracks,
  normalizeSpotifyArtists,
  normalizeSpotifyTracks,
  normalizeYouTubeTracks,
  slug,
} from "@/lib/api/normalizers";
import { probeAudioUrl } from "@/lib/api/probe";
import { isPrimaryDisabled } from "@/lib/config/api-config";
import { rememberTrack } from "@/lib/server/trackRegistry";
import {
  engineAlbumToAlbum,
  engineArtistToArtist,
  engineResolve,
  engineSearchRaw,
  engineTrackToTrack,
  type EngineAlbum,
  type EngineArtist,
  type EngineResolution,
  type EngineSearchOutcome,
  type EngineTrack,
} from "@/lib/server/spotifyEngine";
import type { Album, ApiStatus, ResolvedAudio, ResolvableSource, SearchResults, SearchSource, Track } from "@/types";

/* ============================================================
   MUSIC SERVICE — search + audio resolution
   ------------------------------------------------------------
   Search   : SoundCloud (primary, per your configuration),
              with Spotify and YouTube as secondary sources.
   Playback : Spotify v2 first, then the classic Spotify
              converter, then YouTube (ytmp3). No 30-second
              previews are ever played — only full-track audio.
   ============================================================ */

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();

function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
  opts: { skipIf?: (v: T) => boolean } = {},
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);
  // Share one upstream request between concurrent identical calls
  // (e.g. a fan-out section and a user search for the same query).
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  // L2: Next's Data Cache. The in-memory map above dies with each
  // serverless invocation (on Vercel every request can be a cold lambda),
  // which made the deployed app re-fetch every search and re-convert every
  // song from scratch. The Data Cache survives across invocations and
  // regions, so repeat searches/requests come back in milliseconds.
  //
  // skipIf: when the produced value is degraded (e.g. an all-source
  // search that lost the catalogue leg to an engine blip), it must NOT
  // be kept — the Data Cache survives redeploys, so a cover-only result
  // captured during a 90s outage would otherwise poison that query for
  // the whole TTL. The degraded value is re-produced fresh (outside the
  // Data Cache) and stored nowhere; good results cache as before.
  const revalidate = Math.max(1, Math.round(ttlMs / 1000));
  const produce = unstable_cache(producer, [key, "music-v3"], { revalidate, tags: ["music"] });
  const promise = Promise.resolve()
    .then(() => produce() as Promise<T>)
    .then(async (value) => {
      if (opts.skipIf?.(value)) {
        inflight.delete(key);
        return producer();
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, promise);
  return promise;
}

const inflight = new Map<string, Promise<unknown>>();

/* ------------------------------------------------------------------ */
/* Suggestion pool                                                     */
/* ------------------------------------------------------------------ */

/**
 * A bounded pool of every title/artist ever pulled from the upstream
 * catalogue. Typing suggestions are served as a local filter against it
 * (sub-millisecond) — the upstream search endpoint is only hit when the
 * pool has nothing to offer yet.
 */
const SUGGESTION_POOL_LIMIT = 4000;
const suggestionPool = new Map<string, { text: string; hits: number }>();

function noteSuggestion(text: string): void {
  const t = text.trim();
  if (!t || t === "Unknown track" || t === "Unknown artist" || t.length > 60) return;
  const key = t.toLowerCase();
  const existing = suggestionPool.get(key);
  if (existing) {
    existing.hits += 1;
    return;
  }
  suggestionPool.set(key, { text: t, hits: 1 });
  if (suggestionPool.size > SUGGESTION_POOL_LIMIT) {
    // Evict a small slice of the least-seen entries.
    const evict = [...suggestionPool.entries()].sort((a, b) => a[1].hits - b[1].hits).slice(0, 200);
    for (const [k] of evict) suggestionPool.delete(k);
  }
}

function poolSuggestions(query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  const starts: string[] = [];
  const includes: string[] = [];
  for (const { text } of suggestionPool.values()) {
    const lower = text.toLowerCase();
    if (lower.startsWith(q)) starts.push(text);
    else if (lower.includes(q)) includes.push(text);
    if (starts.length >= limit) break;
  }
  return [...starts, ...includes].slice(0, limit);
}

// Seed the suggestion pool with major artist names so partial queries like
// "davi" can expand toward "Davido" on a cold server, instead of ranking
// whatever junk the sources return for the literal text.
const SEEDED_ARTISTS = [
  "Davido", "Wizkid", "Burna Boy", "Rema", "Asake", "Ayra Starr", "Tems", "CKay",
  "Fireboy DML", "Olamide", "Tiwa Savage", "Yemi Alade", "Kizz Daniel", "Ruger",
  "BNXN", "Joeboy", "Omah Lay", "Shallipopi", "ODUMODUBLVCK", "Seyi Vibez",
  "Pheelz", "Adekunle Gold", "Simi", "Mr Eazi", "Tekno", "Phyno", "Flavour",
  "Fela Kuti", "2Baba", "P-Square", "Timaya", "Wande Coal", "Davolee",
  "Drake", "The Weeknd", "Taylor Swift", "Ariana Grande", "Ed Sheeran",
  "Billie Eilish", "Rihanna", "Travis Scott", "Kendrick Lamar", "J. Cole",
  "David Guetta", "Calvin Harris", "Post Malone", "Dua Lipa", "SZA",
];
for (const n of SEEDED_ARTISTS) suggestionPool.set(n.toLowerCase(), { text: n, hits: 60 });

function invalidate(prefix: string) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

// Search results live 5 min; resolved-audio lookups 20 min (tracks rarely
// move, and skipping the resolve chain on replay is a big win). Both are
// in-memory, so a dev-server module reload or a restart resets them.
const SEARCH_TTL = 5 * 60 * 1000;
const RESOLVE_TTL = 20 * 60 * 1000;

/**
 * 0..130 — how strongly a text matches the query (slug-normalised).
 * Used to rank merged search results so the list reads like a real
 * search: exact matches first, related second, unrelated last.
 */
function relevance(text: string, q: string): number {
  const t = slug(text);
  const n = slug(q);
  if (!t || !n) return 0;
  // A title equal to a MULTI-token query ("Water TylA" for "water tyla")
  // is usually a spam re-upload that absorbed the artist name — the real
  // song ranks above it via split-match (title + artist tokens).
  if (t === n) return n.split("-").length > 1 ? 120 : 130;
  // Uploader titles like "water - Tyla (Victoria Secret Live show
  // version) cover" start with the whole query and used to outrank the
  // real song. A clean prefix/suffix (≤2 extra words) stays strong; a
  // long one is demoted below the split-match score.
  const extra = t.split("-").filter(Boolean).length - n.split("-").filter(Boolean).length;
  if (t.startsWith(n) || t.endsWith(n)) return extra <= 2 ? 110 : 95;
  if (t.includes(n)) return 90;
  const tokens = n.split("-").filter(Boolean);
  if (tokens.length > 1 && tokens.every((tk) => t.includes(tk))) return 70;
  return 10;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Shared post-processing for engine search payloads (remote or in-lambda). */
function buildEngineSearchResults(found: EngineSearchOutcome, label: string, sinceMs: number, q: string): SearchResults {
  const tracks = found.tracks.map(engineTrackToTrack);
  // The same recording often surfaces several times (single +
  // album + compilation appearances) — keep the first, most
  // relevant catalogue hit per title + primary artist so the
  // list does not show "Awuke" three times.
  const seenTrack = new Set<string>();
  const dedupedTracks = tracks.filter((t) => {
    const key = `${slug(t.title)}|${slug(t.artist.split(",")[0]?.trim() ?? "")}`;
    if (seenTrack.has(key)) return false;
    seenTrack.add(key);
    return true;
  });
  for (const t of dedupedTracks) noteSuggestion(t.title);
  for (const a of found.artists) noteSuggestion(a.name);
  for (const a of found.albums) noteSuggestion(a.name);
  const grouped = albumsFromTracks(dedupedTracks);
  const native = found.albums.map(engineAlbumToAlbum);
  // The catalogue's native album nodes know the REAL release
  // type and year — fold them over the search-window inference
  // so cards stop being mislabeled ("everything is an EP").
  const nativeById = new Map(native.map((a) => [a.id, a]));
  for (const g of grouped) {
    const n = nativeById.get(g.id);
    if (!n) continue;
    if (n.type) g.type = n.type;
    if (n.year) {
      g.year = n.year;
      g.releaseDate = String(n.year);
    }
    for (const t of g.tracks ?? []) {
      if (n.type === "album" || n.type === "single" || n.type === "ep") t.albumType = n.type;
      t.releaseDate = n.releaseDate;
    }
  }
  const albums = mergeAlbums(grouped, native);
  const artists = found.artists.map(engineArtistToArtist);
  console.log(`[search] ${label} ${Date.now() - sinceMs}ms q=${q}`);
  return { tracks: dedupedTracks, albums, artists, playlists: [], podcasts: [], total: dedupedTracks.length + albums.length + artists.length };
}

/** True when the payload has anything usable (otherwise the caller falls through). */
function engineFoundSomething(found: EngineSearchOutcome): boolean {
  return found.tracks.length > 0 || found.albums.length > 0;
}

export async function searchSpotifyViaEngine(q: string): Promise<SearchResults | null> {
  // REMOTE engine host first (warm, ~1-2s) — the in-lambda engine cold
  // boot (TOTP + hash discovery, ~20s measured) is the slow fallback.
  // One retry after a short pause: Railway redeploys drop the host for
  // a minute, and without the retry a search landing in that window
  // lost the whole real-artist catalogue and shipped covers instead.
  if (REMOTE_ENGINE) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const t0 = Date.now();
        const found = await remoteEngineSearch(q, 24);
        if (engineFoundSomething(found)) return buildEngineSearchResults(found, "remote-engine", t0, q);
        break; // engine answered, genuinely no data — stop retrying
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        console.error(`[search] remote engine failed x2 q=${q}: ${err instanceof Error ? err.message : err} — in-lambda engine next`);
      }
    }
  }
  if (!isPrimaryDisabled()) {
    try {
      const t0 = Date.now();
      // Cold-lambda bootstrap (TOTP + hash discovery) can run 20-40s and
      // blow the route's 60s budget together with the other legs — cap it.
      const found = await withTimeout(engineSearchRaw(q, 24), 20000, "in-lambda engine window exceeded");
      if (engineFoundSomething(found)) return buildEngineSearchResults(found, "engine", t0, q);
    } catch (engineErr) {
      console.error(
        `[search] engine did not answer q=${q}: ${engineErr instanceof Error ? engineErr.message : engineErr} — mirror API takes over`,
      );
    }
  }
  return null;
}

export async function searchTracks(query: string, source: SearchSource): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { tracks: [], artists: [], albums: [], playlists: [], podcasts: [], total: 0 };

  return cached(`search:${source}:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    try {
      if (source === "soundcloud") {
        const raw = await callUpstream({ endpoint: "search.soundcloud", params: { query: q } });
        const { tracks, artists, albums } = normalizeSoundCloudTracks(raw);
        for (const t of tracks) noteSuggestion(t.title);
        for (const a of artists) noteSuggestion(a.name);
        for (const a of albums) noteSuggestion(a.title);
        return {
          tracks,
          artists,
          albums,
          playlists: [],
          podcasts: [],
          total: tracks.length + artists.length + albums.length,
        };
      }

      if (source === "spotify") {
        // THE ENGINE FIRST — remote Railway host when configured (warm,
        // ~1-2s), then the in-lambda engine. Only ENGINE results are
        // cached: a mirror/backup answer captured during an engine blip
        // must never outlive the blip in the cache.
        const key = `search:spotify:${q.toLowerCase()}`;
        const viaEngine = await cached(key, SEARCH_TTL, async () => {
          const r = await searchSpotifyViaEngine(q);
          // Throwing keeps the null out of the cache — the next request
          // retries the engine instead of serving stale fallback rows.
          if (!r) throw new Error("engine unavailable");
          return r;
        }).catch(() => null);
        if (viaEngine) {
          for (const t of viaEngine.tracks) noteSuggestion(t.title);
          for (const a of viaEngine.albums) noteSuggestion(a.title);
          for (const a of viaEngine.artists) noteSuggestion(a.name);
          return viaEngine;
        }
        const raw = await callUpstream({ endpoint: "search.spotify", params: { query: q } });
        const tracks = normalizeSpotifyTracks(raw);
        // The upstream sends no releaseDate/albumType — fill them from
        // iTunes so "New ·" and real EP/Single/Album labels work.
        await decorateWithItunesReleases(tracks);
        for (const t of tracks) noteSuggestion(t.title);
        // Group the tracks into real albums so source tabs (and searchAll)
        // all surface clickable album cards backed by playable tracks.
        const albums = albumsFromTracks(tracks);
        return { tracks, albums, artists: [], playlists: [], podcasts: [], total: tracks.length + albums.length };
      }

      const raw = await callUpstream({ endpoint: "search.youtube", params: { query: q } });
      const tracks = normalizeYouTubeTracks(raw);
      for (const t of tracks) noteSuggestion(t.title);
      return { tracks, artists: [], albums: [], playlists: [], podcasts: [], total: tracks.length };
    } catch (err) {
      // Primary unavailable (down or switched off) — run on the backup
      // engine, which returns relevance-ranked full-track results.
      const tracks = await backupSearchTracks(q, source === "spotify");
      for (const t of tracks) noteSuggestion(t.title);
      if (source === "spotify") {
        const albums = albumsFromTracks(tracks);
        return { tracks, albums, artists: [], playlists: [], podcasts: [], total: tracks.length + albums.length };
      }
      return { tracks, artists: [], albums: [], playlists: [], podcasts: [], total: tracks.length };
    }
  });
}

/** Fan out across every configured source and merge the results. */
export async function searchAll(query: string): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { tracks: [], artists: [], albums: [], playlists: [], podcasts: [], total: 0 };

  return cached(
    `search:all:${q.toLowerCase()}`,
    SEARCH_TTL,
    async () => {
    const settled = await Promise.allSettled([
      searchTracks(q, "soundcloud"),
      searchTracks(q, "spotify"),
      searchTracks(q, "youtube"),
    ]);

    const tracks: Track[] = [];
    const artists: SearchResults["artists"] = [];
    const albums: SearchResults["albums"] = [];

    // If the Spotify leg died (engine blip, mirror down), the merge would
    // rank SoundCloud covers with uploader names over nothing — retry it
    // once before merging so real catalogue rows get their chance.
    const spotifyLeg = settled[1];
    const spotifyEmpty = spotifyLeg.status === "rejected" || (spotifyLeg.status === "fulfilled" && spotifyLeg.value.tracks.length === 0);
    if (spotifyEmpty) {
      try {
        settled[1] = { status: "fulfilled", value: await searchTracks(q, "spotify") };
      } catch {
        /* both attempts failed — merge whatever the other sources found */
      }
    }

    // Spotify (engine) rows first: their artist names come from the real
    // catalogue, and the stable dedupe below gives first-wins — so the
    // same recording uploaded elsewhere (SoundCloud/YouTube uploader
    // channels) can never knock the true artist name off a row.
    for (const result of [settled[1], settled[0], settled[2]]) {
      if (result.status !== "fulfilled") continue;
      tracks.push(...result.value.tracks);
      artists.push(...result.value.artists);
      albums.push(...result.value.albums);
    }

    // De-duplicate by normalised title+artist so the same song from two
    // providers does not appear twice in the list.
    const seen = new Set<string>();
    const deduped = tracks.filter((t) => {
      const key = `${slug(t.title)}::${slug(t.artist)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Same-recording collapse: non-catalogue rows whose artist is really
    // an uploader channel ("NaijaVibes", "X TV") used to surface the song
    // a second time with that name under it. A row that shares a title
    // with a kept catalogue row, is within ~4s of its length, and has a
    // related artist (one name containing the other or a shared word) is
    // the same recording — drop it, the catalogue row already represents it.
    const artistWords = (name: string) => slug(name).split("-").filter((w) => w.length >= 3);
    const artistsRelated = (a: string, b: string) => {
      const as = slug(a);
      const bs = slug(b);
      if (!as || !bs) return false;
      if (as === bs || as.includes(bs) || bs.includes(as)) return true;
      return artistWords(a).some((w) => artistWords(b).includes(w));
    };
    const keptCatalogue: Track[] = [];
    const collapsed: Track[] = [];
    for (const t of deduped) {
      if (t.source === "spotify") {
        keptCatalogue.push(t);
        collapsed.push(t);
        continue;
      }
      const sameRecording = keptCatalogue.some(
        (k) =>
          slug(k.title) === slug(t.title) &&
          Math.abs((k.duration ?? 0) - (t.duration ?? 0)) <= 4 &&
          artistsRelated(k.artist, t.artist),
      );
      if (!sameRecording) collapsed.push(t);
    }

    // Artists derived from the actual song hits — far more reliable than
    // trusting SoundCloud profile results, which include fan accounts,
    // repost channels and unrelated uploaders. Only SoundCloud profiles
    // whose name matches the query on top of that survive.
    // Relevance ranking — exact title first, then artist-name matches,
    // then loose includes; stable on ties (provider order preserved).
    // Split-match scoring: "water tyla" must rank the REAL "Water" by
    // Tyla (title hits one token, artist the other) above covers whose
    // long titles happen to contain both words.
    const qn = slug(q);
    const qTokens = qn.split("-").filter((w) => w.length >= 2);
    const missAllowed = qTokens.length > 3 ? 1 : 0;
    const splitScore = (t: Track) => {
      if (!qTokens.length) return 0;
      const ts = slug(t.title);
      const as = slug(t.artist);
      const covered = qTokens.filter((tk) => ts.includes(tk) || as.includes(tk)).length;
      if (qTokens.length - covered > missAllowed) return 0;
      // Every query token is covered by title+artist — that is what the
      // user searched for. A title that is exactly one query token
      // ("Water" for "water tyla") with the artist carrying the rest is
      // the REAL song; a title equal to the WHOLE query ("Water TylA")
      // is typically a spam re-upload and ranks just below it.
      if (qTokens.some((tk) => ts === tk)) return 125;
      if (ts === qn) return 120;
      return 100;
    };
    const scored = collapsed.map((t, i) => ({
      t,
      i,
      score: Math.max(
        relevance(t.title, q),
        relevance(t.artist, q) - 5,
        relevance(t.album ?? "", q) - 5,
        splitScore(t),
      ),
    }));

    // Album rows come from two places: albums grouped out of the ranked
    // track hits, and provider-native album objects collected from the
    // source branches (e.g. SoundCloud sets — releases we could not group).
    // Merge both, letting track-backed releases win over trackless sets
    // that share a title.
    const rankedAlbums = mergeAlbums(albumsFromTracks(scored.map((s) => s.t)), albums);

    const profileArtists = artists.filter((a) => {
      const an = slug(a.name);
      return an && (an === qn || an.includes(qn) || qn.includes(an));
    });

    const scores = new Map<string, number>();
    const derived = new Map<string, SearchResults["artists"][number]>();
    for (const t of collapsed) {
      const names = t.artist?.split(",").map((n) => n.trim()).filter(Boolean) ?? [];
      for (const [i, name] of names.entries()) {
        const id = `ar_${slug(name)}`;
        if (id === "ar_") continue;
        // Times 3 so a matching artist outranks the song rows on top.
        const weight = (i === 0 ? 4 : 2) + relevance(name, q) * 3;
        scores.set(id, (scores.get(id) ?? 0) + weight);
        const existing = derived.get(id);
        if (!existing) {
          derived.set(id, {
            id,
            name,
            image: t.artwork,
            source: t.source,
            // Verified signal: the artist actually appears on these songs.
            verified: slug(name) === qn || slug(name).includes(qn),
          });
        }
      }
    }
    for (const a of profileArtists) {
      if (derived.has(a.id)) continue;
      derived.set(a.id, a);
      scores.set(a.id, (scores.get(a.id) ?? 0) + Math.max(1, relevance(a.name, q) * 3));
    }

    // ---- Query expansion --------------------------------------------
    // Partial queries like "davi" never reach "Davido" songs upstream —
    // the sources only match the literal text. If the suggestion pool (or
    // an artist already derived from weak hits) knows a full name that
    // starts with the typed text, fetch one extra search for it and merge
    // the results back in so the real artist and their songs appear.
    const known = [poolSuggestions(q, 30).map((s) => ({ name: s, popularity: suggestionPool.get(s.toLowerCase())?.hits ?? 0 }))];
    // Derived artists whose name begins with the typed text are also
    // worth one query — their popularity is how many songs carried them.
    for (const a of derived.values()) {
      const ns = slug(a.name);
      if (ns && ns.startsWith(qn) && ns !== qn) {
        known.push([{ name: a.name, popularity: (scores.get(a.id) ?? 0) / 100 }]);
      }
    }
    const candidates = new Map<string, { name: string; popularity: number }>();
    for (const c of known.flat()) {
      const cs = slug(c.name);
      if (!cs || cs === qn || !cs.startsWith(qn)) continue;
      const prev = candidates.get(cs);
      if (!prev || c.popularity > prev.popularity) candidates.set(cs, c);
    }
    const expansion = [...candidates.values()]
      .sort((a, b) => b.popularity - a.popularity || a.name.length - b.name.length)[0];

    // When the direct hits already match the query well (a real title/artist
    // match), the extra expansion round-trips only add latency for results
    // nobody needed. They exist for partial queries like "davi" → "Davido".
    const strongHit = scored.some((s) => s.score >= 90);

    if (expansion && !strongHit) {
      try {
        const extra = await Promise.allSettled([
          searchTracks(expansion.name, "soundcloud"),
          searchTracks(expansion.name, "spotify"),
        ]);
        for (const r of extra) {
          if (r.status !== "fulfilled" || r.value.tracks.length < 3) continue;
          for (const t of r.value.tracks) {
            const key2 = `${slug(t.title)}::${slug(t.artist)}`;
            if (seen.has(key2)) continue;
            seen.add(key2);
            // Expansion songs sit just below direct hits of the typed text.
            scored.push({ t, i: Number.MAX_SAFE_INTEGER, score: Math.max(relevance(t.title, q), relevance(t.artist, q) - 5) + 10 });
          }
          for (const t of r.value.tracks) {
            const names = t.artist?.split(",").map((n) => n.trim()).filter(Boolean) ?? [];
            for (const [i, name] of names.entries()) {
              const id = `ar_${slug(name)}`;
              if (id === "ar_") continue;
              const ns = slug(name);
              // The name the user was typing toward gets a large boost so
              // it leads the artist list (only when it really prefix-matches).
              const artistBoost = ns.startsWith(qn) ? 800 : 0;
              if (artistBoost) scores.set(id, (scores.get(id) ?? 0) + (i === 0 ? 6 : 3) + artistBoost);
              else if (!derived.has(id)) scores.set(id, (scores.get(id) ?? 0) + (i === 0 ? 2 : 1));
              if (!derived.has(id)) {
                derived.set(id, { id, name, image: t.artwork, source: t.source, verified: ns.startsWith(qn) });
              }
            }
          }
        }
      } catch {
        /* expansion is best-effort — the base results still stand */
      }
    }

    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    const ranked = scored.map((s) => s.t);
    const uniqueArtists = [...derived.values()]
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
      .slice(0, 12);

    return {
      tracks: ranked,
      artists: uniqueArtists,
      albums: rankedAlbums,
      playlists: [],
      podcasts: [],
      total: ranked.length + uniqueArtists.length + rankedAlbums.length,
    };
    },
    // A merge with zero catalogue rows means the engine leg failed —
    // serve it once but leave it uncached so the next request retries.
    { skipIf: (r) => !r.tracks.some((t) => t.source === "spotify") },
  );
}

/** Lightweight type-ahead suggestions (cheap, cached aggressively). */
export async function suggest(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const local = poolSuggestions(q);
  if (local.length >= 6) return local;
  // Deezer serves suggestion strings in ~300ms with no per-key serialisation —
  // the upstream search endpoints queue every request behind the previous one,
  // which made typing feel broken. They stay the fallback.
  return cached(`suggest:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    try {
      const titles = await deezerSearchTitles(q, 8);
      const merged = Array.from(new Set([...local, ...titles, q]));
      return merged.slice(0, 10);
    } catch {
      return local.length ? local : [q];
    }
  });
}

/** Artist / album detail lookups fall back to a targeted search. */
export async function lookupArtist(name: string): Promise<{ tracks: Track[]; albums: Album[]; artists: ReturnType<typeof normalizeSpotifyArtists> }> {
  return cached(`artist:${name.toLowerCase()}`, SEARCH_TTL, async () => {
    const [byName, albumsRaw] = await Promise.allSettled([
      searchAll(name),
      callUpstream({ endpoint: "search.spotify", params: { query: name } }),
    ]);

    const tracks = byName.status === "fulfilled" ? byName.value.tracks : [];
    const spotifyAlbums = albumsRaw.status === "fulfilled"
      ? albumsFromTracks(normalizeSpotifyTracks(albumsRaw.value))
      : [];
    // Include albums surfaced by the fan-out search too (SoundCloud sets
    // and any releases the targeted query missed).
    const albums = mergeAlbums(spotifyAlbums, byName.status === "fulfilled" ? byName.value.albums : []);
    const artists = byName.status === "fulfilled" ? byName.value.artists : [];
    return { tracks, albums, artists };
  });
}

/* ------------------------------------------------------------------ */
/* Audio resolution                                                    */
/* ------------------------------------------------------------------ */

const ALLOWED_HOSTS = [
  "open.spotify.com",
  "spotify.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
];

export function isAllowedProviderUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function providerFor(url: string): "spotify-v2" | "ytmp3" | "soundcloud" | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("spotify.com")) return "spotify-v2";
    if (host.includes("youtube.com") || host.endsWith("youtu.be")) return "ytmp3";
    if (host.endsWith("soundcloud.com")) return "soundcloud";
  } catch {
    /* not a url */
  }
  return null;
}

/** How long an attempt gets as sole runner before the next joins (hedged start). */
const HEDGE_HEADSTART_MS = 3500;
/**
 * One hung/slow converter can never hold the whole resolve: every attempt
 * is raced against this per-attempt ceiling, and the whole hedge is raced
 * against RESOLVE_DEADLINE_MS so the user gets an honest error quickly
 * instead of a 45s spinner (measured failure before this: 45s + FAIL).
 */
const ATTEMPT_TIMEOUT_MS = 12000;
const RESOLVE_DEADLINE_MS = 24000;

class AttemptRejected extends Error {}

/**
 * First-success race where later attempts only start if the earlier ones
 * haven't won within head starts. Measured on this upstream: parallel
 * resolves for different tracks/scripts do NOT serialise (two resolves
 * finished in ~6s total), so hedging genuinely shortens starts — instead
 * of a dead converter blocking every fallback behind a 45s timeout.
 * Rejections of losing racers are swallowed.
 */
function firstSuccess<T>(race: Array<Promise<T>>): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = race.length;
    if (!pending) {
      reject(new Error("No resolution paths"));
      return;
    }
    let firstError: unknown = null;
    for (const p of race) {
      p.then(
        (v) => resolve(v),
        (e) => {
          if (firstError === null) firstError = e;
          pending -= 1;
          if (pending === 0) reject(firstError);
        },
      );
    }
  });
}

async function hedgedResolve(
  track: Track,
  attempts: Array<{ label: string; run: () => Promise<ResolvedAudio> }>,
): Promise<ResolvedAudio> {
  // Attempt i joins the race after i head starts — and never after a
  // winner landed (its post-delay check throws immediately).
  const startedAt = Date.now();
  let settled = false;
  const runners = attempts.map((attempt, i) => {
    const run = (async () => {
      if (i > 0) await new Promise((r) => setTimeout(r, i * HEDGE_HEADSTART_MS));
      if (settled) throw new AttemptRejected("settled");
      const attemptStart = Date.now();
      try {
        const result = await withTimeout(attempt.run(), ATTEMPT_TIMEOUT_MS, `${attempt.label} timed out`);
        if (!result?.audioUrl || !identityMatches(track, result)) throw new AttemptRejected("identity/empty");
        return result;
      } catch (err) {
        if (!(err instanceof AttemptRejected)) {
          console.error(`[resolve] path ${attempt.label} failed after ${Date.now() - attemptStart}ms: ${err instanceof Error ? err.message : err}`);
        } else {
          console.error(`[resolve] path ${attempt.label} rejected after ${Date.now() - attemptStart}ms (no streamable match)`);
        }
        throw err;
      }
    })();
    void run.catch(() => undefined); // losing racers are silent
    return run;
  });
  const race = runners.map((run) =>
    run.then(
      (v) => {
        settled = true;
        return v;
      },
      (e) => {
        throw e;
      },
    ),
  );
  try {
    const winner = await firstSuccess(race);
    const ms = Date.now() - startedAt;
    console.log(`[resolve] ${ms}ms track=${track.id} ${track.title}`);
    return winner;
  } catch (err) {
    console.error(`[resolve] FAILED ${Date.now() - startedAt}ms track=${track.id} ${track.title}: ${err instanceof Error ? err.message : err}`);
    throw err;
  } finally {
    settled = true;
  }
}

/* ------------------------------------------------------------------ */
/* THE ENGINE — primary playback path                                  */
/* ------------------------------------------------------------------ */

/** Reject after `ms` so one hung engine fetch cannot hold the whole resolve.
 *  The timer is deliberately NOT unref'd: an unref'd timer does not keep a
 *  frozen serverless lambda alive, so the rejection (and cleanup of the hung
 *  attempt) can be postponed for minutes — seen live as
 *  "path youtube-judged failed after 299897ms". */
function withTimeout<T>(p: Promise<T>, ms: number, label = "engine window exceeded"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

const REMOTE_ENGINE = (process.env.ENGINE_URL ?? "").replace(/\/+$/, "");
const REMOTE_ENGINE_TOKEN = process.env.ENGINE_TOKEN ?? "";

/**
 * Search through the REMOTE engine host (Railway) when configured.
 * The in-lambda engine must bootstrap a whole anonymous Spotify session
 * (TOTP + client token + hash discovery = several MB of JS on cold start,
 * ~20s measured) per cold instance; the standalone host stays warm, so its
 * /search answers in ~1-2s. Returns the same shape as engineSearchRaw.
 */
async function remoteEngineSearch(query: string, limit: number): Promise<EngineSearchOutcome> {
  const url = `${REMOTE_ENGINE}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const r = await fetch(url, {
    headers: REMOTE_ENGINE_TOKEN ? { "x-engine-token": REMOTE_ENGINE_TOKEN } : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`engine search HTTP ${r.status}`);
  const j = (await r.json()) as { tracks?: Record<string, unknown>[]; albums?: Record<string, unknown>[]; artists?: Record<string, unknown>[] };
  const tracks: EngineTrack[] = (j.tracks ?? []).map((t) => {
    const id = String(t.id ?? "");
    const rawType = typeof t.albumType === "string" ? t.albumType.toLowerCase() : null;
    const rawYear = Number(t.year);
    return {
      id,
      title: String(t.title ?? ""),
      artist: String(t.artist ?? ""),
      album: (t.album as string) ?? null,
      durationMs: Number(t.durationMs) || 0,
      explicit: !!t.explicit,
      thumb: (t.thumb as string) ?? null,
      url: (t.url as string) || (id ? `https://open.spotify.com/track/${id}` : ""),
      albumType: rawType === "album" || rawType === "single" || rawType === "ep" ? rawType : null,
      year: rawYear > 1900 ? rawYear : null,
    } satisfies EngineTrack;
  }).filter((t) => t.id && t.title).slice(0, limit);
  const albums: EngineAlbum[] = (j.albums ?? []).map((a) => {
    const artists = Array.isArray(a.artists) ? a.artists : [];
    const mainArtist = String((artists[0] as Record<string, unknown>)?.name ?? "");
    const uri = String((artists[0] as Record<string, unknown>)?.uri ?? "");
    const rawType = typeof a.type === "string" ? a.type.toLowerCase() : null;
    const rawYear = Number(a.year);
    return {
      id: String(a.id ?? ""),
      name: String(a.name ?? ""),
      type: rawType === "album" || rawType === "single" || rawType === "ep" || rawType === "compilation" ? rawType : null,
      year: rawYear > 1900 ? rawYear : null,
      image: (a.image as string) ?? null,
      mainArtist,
      artistId: `ar_${slug(mainArtist)}`,
      url: `https://open.spotify.com/album/${String(a.id ?? "")}`,
    } satisfies EngineAlbum;
  }).filter((a) => a.id && a.name).slice(0, limit);
  const artists: EngineArtist[] = (j.artists ?? []).map((a) => {
    const id = String(a.id ?? "");
    return {
      id,
      name: String(a.name ?? ""),
      verified: !!a.verified,
      image: (a.image as string) ?? null,
      url: `https://open.spotify.com/artist/${id}`,
    } satisfies EngineArtist;
  }).filter((a) => a.id && a.name).slice(0, limit);
  return { ok: true, tracks, albums, artists };
}

function engineStreamUrl(res: EngineResolution, track: Track): string {
  // With a standalone engine host (Railway — stable IP) the googlevideo
  // url the engine fetched is locked to THAT host's IP: only the engine
  // itself can pipe the bytes. Hand the client the engine's stream
  // endpoint directly in that setup; same-instance semantics stay true.
  if (REMOTE_ENGINE) {
    const params = new URLSearchParams({ tid: track.id });
    // <audio> cannot send headers — carry the token in the query string.
    if (REMOTE_ENGINE_TOKEN) params.set("k", REMOTE_ENGINE_TOKEN);
    if (track.title) params.set("t", track.title);
    if (track.artist) params.set("a", track.artist);
    return `${REMOTE_ENGINE}/stream/${res.videoId}?${params.toString()}`;
  }
  // No signed url is ever handed to the client — just the video id. The
  // stream route re-resolves the (IP-locked) googlevideo url inside the
  // streaming instance itself, so every request always works and never
  // expires the way signed CDN links do.
  const params = new URLSearchParams({ yt: res.videoId, tid: track.id });
  if (track.title) params.set("t", track.title);
  if (track.artist) params.set("a", track.artist);
  return `/api/music/stream?${params.toString()}`;
}

async function resolveViaEngine(track: Track, force = false): Promise<ResolvedAudio> {
  // Standalone engine host (Railway, stable IP) first — direct googlevideo
  // playback works there, which is the whole point of running one. Its
  // response is identity-guarded exactly like a local engine answer.
  if (REMOTE_ENGINE) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (REMOTE_ENGINE_TOKEN) headers["x-engine-token"] = REMOTE_ENGINE_TOKEN;
    const remote = await withTimeout(
      (async () => {
        // YouTube-sourced tracks already carry their video id — the engine
        // then skips search+judging entirely (channel-named listings like
        // "Alakori - Falz, Dice Ailes" can never be found by search again).
        const videoId = track.id.startsWith("tr_yt_") ? track.providerId || track.id.replace(/^tr_yt_/, "") : undefined;
        const r = await fetch(`${REMOTE_ENGINE}/resolve`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: track.title, artist: track.artist, force, videoId }),
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`engine host ${r.status}`);
        return (await r.json()) as { videoId: string; title: string; durationSec: number | null };
      })(),
      ATTEMPT_TIMEOUT_MS,
      "engine host timed out",
    );
    const resolved: ResolvedAudio = {
      audioUrl: engineStreamUrl({ videoId: remote.videoId, youtubeTitle: remote.title, watchUrl: `https://www.youtube.com/watch?v=${remote.videoId}`, durationSec: remote.durationSec }, track),
      title: remote.title,
      quality: "YouTube audio",
      provider: "ytmp3",
      duration: remote.durationSec ? Math.round(remote.durationSec) : undefined,
      engineHost: true,
    };
    // tr_yt_ tracks ARE their video id — the user tapped that exact listing,
    // so playback is correct by definition; the title guard is for
    // search-matched picks only.
    if (!track.id.startsWith("tr_yt_") && !identityMatches(track, resolved)) throw new Error("engine audio identity mismatch");
    return resolved;
  }
  const res = await engineResolve({ title: track.title, artist: track.artist }, force, { prove: true });
  if (!res) throw new Error("engine found no full-length audio");
  const resolved: ResolvedAudio = {
    audioUrl: engineStreamUrl(res, track),
    title: res.youtubeTitle,
    quality: "YouTube audio",
    provider: "ytmp3",
    duration: res.durationSec ? Math.round(res.durationSec) : undefined,
  };
  // The engine's judge already enforces title coverage; this double-checks
  // the handed-back YouTube title against the listed track before it plays.
  if (!identityMatches(track, resolved)) throw new Error("engine audio identity mismatch");
  return resolved;
}

/**
 * Resolve a track into a directly streamable audio URL.
 *
 * Resolution order (per project requirements — engine primary, mirror API
 * only when the engine is down; full tracks, never 30s previews):
 *   0. THE ENGINE — Spotify anonymous search canonicalises the song, a
 *      judged YouTube pick proves full-length audio, playback streams
 *      from the same instance via /api/music/stream?yt=<videoId>.
 *   1..n Mirror-API attempts (hedged) — only reached when the engine
 *      failed, was too slow, or returned nothing usable.
 *   n+1. The local backup engine (yt-dlp), last resort.
 *
 * Throws a real error when nothing can serve the track; the UI surfaces
 * it honestly instead of faking playback.
 */
export async function resolveTrack(track: Track, force = false): Promise<ResolvedAudio> {
  // Registry for the stream route: lets /api/music/stream re-resolve by
  // track id when a signed url expires without any client JS (iOS PWA
  // control-center resume; see server/trackRegistry.ts).
  rememberTrack(track);
  const identity = track.id || `${track.artist}-${track.title}`;
  const key = `resolve:${identity}`;
  if (force) invalidate(key);

  return cached<ResolvedAudio>(key, RESOLVE_TTL, async () => {
    // A SoundCloud set (EP/album upload) is a release, not a song: there is
    // no single audio file to stream, and title-matching it against Spotify
    // would play a completely different song. Refuse honestly instead.
    if (track.url && isSoundCloudSet(track.url)) {
      throw new ApiError(
        `"${track.title}" is an EP/collection, not a song — open it from the results instead`,
        400,
        "resolve",
      );
    }

    // 0. THE ENGINE, as the sole runner. When Google bot-blocks this IP
    // the direct googlevideo path dies, but engineYtAudio falls back to
    // trusted public instance proxies (engine-validated video id, THEIR
    // IP) — so the engine attempt stays alive even on datacenter hosts.
    const attempts: Array<{ label: string; run: () => Promise<ResolvedAudio> }> = [];
    if (track.title) {
      // The engine runs in the same hedge race as the mirrors (head start
      // 0) instead of owning a solo 6s window: when it is healthy it still
      // answers first (~1-2s judge), and when it is bot-blocked its fast
      // "no audio" verdict no longer delays the mirror attempts.
      attempts.push({ label: "engine", run: () => resolveViaEngine(track, force) });
    }

    const sourceUrl = track.url && isAllowedProviderUrl(track.url) ? track.url : undefined;
    const provider = sourceUrl ? providerFor(sourceUrl) : null;

    if (provider === "soundcloud") {
      // Direct SoundCloud conversion first (~2-5s when its CDN serves),
      // then the judged YouTube path (search+judge is ours; conversion is
      // the mirror's), then the much slower Spotify matching chain.
      attempts.push({ label: "soundcloud-direct", run: () => resolveSoundcloud(sourceUrl!) });
      attempts.push({ label: "youtube-judged", run: () => resolveYouTubeJudged(track) });
      attempts.push({ label: "youtube-fallback", run: () => resolveYouTubeFallback(track) });
      attempts.push({ label: "spotify-fallback", run: () => resolveSpotifyFallback(track) });
    } else if (provider === "spotify-v2") {
      attempts.push({ label: "spotify-v2", run: () => resolveSpotify(sourceUrl!) });
      attempts.push({ label: "youtube-judged", run: () => resolveYouTubeJudged(track) });
      attempts.push({ label: "youtube-fallback", run: () => resolveYouTubeFallback(track) });
    } else if (provider === "ytmp3") {
      attempts.push({ label: "ytmp3", run: () => resolveYouTube(sourceUrl!) });
      attempts.push({ label: "youtube-judged", run: () => resolveYouTubeJudged(track) });
      attempts.push({ label: "spotify-fallback", run: () => resolveSpotifyFallback(track) });
    } else {
      // No usable provider link (e.g. a SoundCloud-only search hit):
      // judge YouTube first (best identity), then the Spotify match.
      attempts.push({ label: "youtube-judged", run: () => resolveYouTubeJudged(track) });
      attempts.push({ label: "spotify-fallback", run: () => resolveSpotifyFallback(track) });
      attempts.push({ label: "youtube-fallback", run: () => resolveYouTubeFallback(track) });
    }
    // Last resort for every path — the local backup engine (yt-dlp),
    // which streams directly from YouTube/SoundCloud with no converter.
    attempts.push({ label: "backup", run: () => backupResolve(track) });

    // Hedged race: the best path starts alone; if it hasn't landed within
    // a head start, the next path joins, and so on. First identity-verified
    // success wins — a dead/slow converter no longer blocks every fallback
    // behind it, which is what made starts take 30-60s. The whole race is
    // also hard-capped so all-paths-dead resolves fail in ~24s, not 45s+.
    return await withTimeout(
      hedgedResolve(track, attempts),
      RESOLVE_DEADLINE_MS,
      "resolve deadline exceeded",
    ).then((resolved) => {
      // The catalogue artwork is the song's real cover. A converter's
      // thumbnail is the YouTube video's image (often a lyric/visualiser
      // frame or a single's cover) — never let it replace the real one.
      if (track.artwork && resolved.artwork !== track.artwork) resolved.artwork = track.artwork;
      return resolved;
    }).catch((err: unknown) => {
      throw new ApiError(
        `Could not find streamable audio: ${err instanceof Error ? err.message : "unknown"}`,
        404,
        "resolve",
      );
    });
  });
}

/**
 * Final playback guarantee: the audio that reaches the player must be the
 * song that was listed. A resolver that returns a clearly different song
 * (a remix standing in for the original, an unrelated upload, sped-up
 * re-uploads) is rejected here, which sends resolution on to the next
 * attempt instead of silently playing the wrong audio.
 */
function identityMatches(track: Track, resolved: ResolvedAudio): boolean {
  if (!resolved.title) return true;
  const resolvedSlug = slug(resolved.title);
  const wantSlug = slug(track.title);
  const wantTokens = wantSlug.split("-").filter((t) => t.length > 1);
  if (!wantTokens.length || !resolvedSlug) return true;
  const covered =
    wantTokens.filter((t) => resolvedSlug.includes(t)).length / wantTokens.length;
  if (covered < 0.6) return false;
  // Variant trap: the resolved title announces a different cut of the song
  // (remix, sped up…) than the one the catalogue listed — and the artist
  // field belongs to someone else entirely (a re-uploader).
  // ("lyric video" stays allowed — it is the same recording; covers and
  // karaoke are different recordings of the words, so they are rejected.)
  if (/\b(remix(es)?|bootleg|sped\s*up|slowed|nightcore|8d\s*audio|performance|cover|karaoke)\b/.test(resolvedSlug) && !wantSlug.includes("remix")) {
    return false;
  }
  return true;
}

/**
 * Fast path for the app's primary search source: a SoundCloud permalink
 * converts to a permanent direct-link MP3 in ~2-3s — much faster than the
 * old chain that first matched the song on Spotify and converted there.
 * duration arrives in seconds, not ms.
 */
/** How long to wait before re-asking the (caching) converter for a link. */
const CONVERT_RETRY_WAIT_MS = 2000;

/**
 * Convert + probe. When a conversion finishes, its CDN file sometimes
 * needs a few extra seconds before it answers — and a failed probe used
 * to throw away a perfectly good conversion, sending the listener down
 * the whole fallback chain (~25s). The upstream caches finished
 * conversions, so re-asking once (cheap, ~2s) usually returns a link
 * that is ready.
 */
async function probeConverted(
  label: string,
  getRaw: () => Promise<Record<string, unknown>>,
  pickAudioUrl: (raw: Record<string, unknown>) => string | undefined,
): Promise<{ audioUrl: string; range: boolean; raw: Record<string, unknown> }> {
  const raw = await getRaw();
  const audioUrl = pickAudioUrl(raw);
  if (!audioUrl) throw new Error(`${label} converter returned no audio URL`);
  const first = await probeAudioUrl(audioUrl);
  if (first.ok) return { audioUrl, range: first.range, raw };

  // Freshly created files on the upstream's CDN sometimes 502 for a few
  // seconds while the file settles. Wait once and re-probe the SAME link
  // (other hedged racers run in parallel, so this costs no wall clock).
  await new Promise((r) => setTimeout(r, CONVERT_RETRY_WAIT_MS));
  const settle = await probeAudioUrl(audioUrl);
  if (settle.ok) return { audioUrl, range: settle.range, raw };

  await new Promise((r) => setTimeout(r, CONVERT_RETRY_WAIT_MS));
  const raw2 = await getRaw();
  const audioUrl2 = pickAudioUrl(raw2) ?? audioUrl;
  const second = await probeAudioUrl(audioUrl2);
  if (!second.ok) throw new Error(`${label} audio CDN is not responding`);
  return { audioUrl: audioUrl2, range: second.range, raw: raw2 };
}

async function resolveSoundcloud(url: string): Promise<ResolvedAudio> {
  const call = async () =>
    (await callUpstream({ endpoint: "download.soundcloud", params: { url }, timeoutMs: 30000 })) as Record<string, unknown>;
  const { audioUrl, range, raw } = await probeConverted("SoundCloud", call, (r) => {
    const result = (r.result ?? r) as Record<string, unknown>;
    return str(result.download_url) || str(result.direct_url) || str(result.stream_url) || undefined;
  });
  const result = (raw.result ?? raw) as Record<string, unknown>;
  return {
    audioUrl: range ? audioUrl : streamProxyUrl(audioUrl),
    duration: typeof result.duration === "number" && result.duration > 0 ? Math.round(result.duration) : undefined,
    artwork: typeof result.thumbnail === "string" ? result.thumbnail : undefined,
    title: typeof result.title === "string" ? result.title : undefined,
    artist: typeof result.artist === "string" ? result.artist : undefined,
    quality: "MP3",
    provider: "soundcloud",
  };
}

/**
 * Engine judge → converter hand-off. The judge needs only the YouTube
 * SEARCH api (works from serverless/datacenter IPs — verified), so the
 * WRONG-SONG defence survives on Vercel even while Google bot-blocks
 * direct googlevideo playback there. The judged watch url goes to the
 * mirror's ytmp3 converter, whose own probe guarantees playable bytes.
 */
async function resolveYouTubeJudged(track: Track): Promise<ResolvedAudio> {
  const res = await engineResolve({ title: track.title, artist: track.artist }, false, { prove: false });
  if (!res?.watchUrl) throw new Error("engine judged no YouTube match");
  return resolveYouTube(res.watchUrl);
}

async function resolveYouTube(url: string): Promise<ResolvedAudio> {
  const call = async () =>
    (await callUpstream({ endpoint: "download.ytmp3", params: { url }, timeoutMs: 25000 })) as Record<string, unknown>;
  const { audioUrl, range, raw } = await probeConverted("YouTube", call, (r) => str(r.download_url) || undefined);
  return {
    audioUrl: range ? audioUrl : streamProxyUrl(audioUrl),
    duration: typeof raw.duration_sec === "number" ? raw.duration_sec : undefined,
    artwork: typeof raw.thumbnail === "string" ? raw.thumbnail : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    artist: typeof raw.channel === "string" ? raw.channel : undefined,
    lyrics: typeof raw.lyrics === "string" && raw.lyrics.trim() ? raw.lyrics : undefined,
    quality: "MP3",
    provider: "ytmp3",
  };
}

async function resolveYouTubeFallback(track: Track): Promise<ResolvedAudio> {
  const query = `${track.title} ${track.artist}`.trim();
  const raw = (await callUpstream({ endpoint: "search.youtube", params: { query } })) as Record<string, unknown>;
  const list = Array.isArray(raw?.data) ? (raw.data as Array<Record<string, unknown>>) : [];

  // Pick the video that best looks like the SAME song — the raw top hit is
  // often a mix, interview or unrelated upload, and converting that would
  // serve the listener the wrong audio after a long wait.
  const titleTokens = slug(track.title).split("-").filter((tk) => tk.length > 2);
  const artistTokens = slug(track.artist.split(",")[0] ?? "").split("-").filter((tk) => tk.length > 2);
  const JUNK = [
    "interview", "reaction", "instrumental", "karaoke", "type beat", "full album",
    "megamix", "performance", "remix", "lyric video", "sped up", "slowed", "reverb",
  ];
  // Only penalize junk words the requested track does NOT itself carry —
  // the official "…" (Remix) upload is what the user asked for when the
  // track is a remix, but a remix must never stand in for the original.
  const want = slug(track.title);
  const junkWords = JUNK.filter((w) => !want.includes(slug(w)));

  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const [idx, v] of list.entries()) {
    const hit = slug(str(v?.title));
    if (!hit) continue;
    const tHit = titleTokens.length ? titleTokens.filter((tk) => hit.includes(tk)).length / titleTokens.length : 0;
    const channel = slug(str(v.channel));
    const aHit = artistTokens.some((tk) => channel.includes(tk) || hit.includes(tk)) ? 0.5 : 0;
    const junk = junkWords.some((w) => hit.includes(slug(w)));
    if (titleTokens.length === 0 && !aHit) continue;
    const score = tHit + aHit - (junk ? 0.6 : 0) - idx * 0.001;
    if (score > bestScore) {
      bestScore = score;
      bestUrl =
        typeof v.url === "string"
          ? v.url
          : typeof v.videoId === "string"
            ? `https://www.youtube.com/watch?v=${v.videoId}`
            : null;
    }
  }

  // Full title coverage required; a single-word title leans on the artist
  // match too when we have one.
  const threshold = titleTokens.length > 1 || artistTokens.length > 0 ? 1.0 : 0.5;
  if (!bestUrl || bestScore < threshold) {
    throw new Error(`No YouTube match for "${query}"`);
  }
  return resolveYouTube(bestUrl);
}


/**
 * Verifies a resolver's audio URL actually serves bytes before handing
 * it to the player. Implemented in @/lib/api/probe and shared with the
 * backup engine.
 */

/** Serve a range-hostile audio URL through our range-aware stream proxy. */
function streamProxyUrl(url: string): string {
  return `/api/music/stream?url=${encodeURIComponent(url)}`;
}

async function resolveSpotify(url: string): Promise<ResolvedAudio> {
  const endpoints = ["download.spotifyV2", "download.spotify"] as const;
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const raw = (await callUpstream({ endpoint, params: { url }, timeoutMs: 20000 })) as Record<string, unknown>;
      const result = (raw?.result ?? {}) as Record<string, unknown>;
      const downloads = (result.downloads ?? {}) as Record<string, unknown>;
      const audioUrl = str(downloads.mp3) || str((result as Record<string, unknown>).download_url) || findMp3Url(raw);
      if (!audioUrl) throw new Error("Spotify converter returned no audio URL");
      const probe = await probeAudioUrl(audioUrl);
      if (!probe.ok) throw new Error("Spotify audio CDN is not responding");

      const meta = (result.metadata ?? result) as Record<string, unknown>;
      return {
        // Sources that ignore Range requests break forward seeking — serve
        // those through our own range-aware proxy instead.
        audioUrl: probe.range ? audioUrl : streamProxyUrl(audioUrl),
        duration: parseTime(str(result.duration) || str(meta.duration)) || numOrUndefined(meta.duration),
        artwork: str(result.cover) || str(meta.thumbnail) || undefined,
        title: str(result.title) || str(meta.title) || undefined,
        artist: str(result.artist) || str(meta.artist) || undefined,
        quality: str(meta.quality, "320kbps"),
        provider: "spotify-v2",
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Spotify converters failed");
}

/** Deep-searches a converter payload for any usable mp3/audio URL. */
function findMp3Url(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === "string") {
    return /^https?:\/\/\S+/.test(value) && (/\.(mp3|m4a|aac)(\?|$)/i.test(value) || value.includes("download"))
      ? value
      : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findMp3Url(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = findMp3Url(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** "4:09" | "1:02:30" | 249 → seconds. */
function parseTime(value: string): number | undefined {
  if (!value.includes(":")) return undefined;
  const parts = value.split(":").map((p) => Number(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function resolveSpotifyFallback(track: Track): Promise<ResolvedAudio> {
  const query = `${track.title} ${track.artist}`.trim();
  const results = await searchTracks(query, "spotify");
  const hit = results.tracks.find((t) => t.url && isAllowedProviderUrl(t.url));
  if (!hit?.url) throw new Error(`No Spotify match for "${query}"`);
  return resolveSpotify(hit.url);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Lyrics on demand — used by the lyrics views when the primary resolution
 * did not include synced lyrics. Primary source is LRCLIB (community
 * lyrics database with timestamped LRC); the ytmp3 full-text lookup is
 * the fallback when nothing matched there.
 */
export interface FetchedLyrics {
  /** LRC-formatted timed lyrics (preferred) */
  synced: string | null;
  /** Untimed plain-text lyrics */
  plain: string | null;
  source: "lrclib" | "ytmp3" | null;
}

interface LrcLibHit {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

async function lrclibRequest(path: string, params: Record<string, string>): Promise<LrcLibHit[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://lrclib.net/api${path}?${qs}`, {
    headers: { "User-Agent": "LenzoMusic/1.0 (https://lenzo.music)" },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`lrclib ${res.status}`);
  const body: unknown = await res.json();
  return Array.isArray(body) ? (body as LrcLibHit[]) : body ? [body as LrcLibHit] : [];
}

async function lookupLrclib(title: string, artist: string, durationSec?: number): Promise<FetchedLyrics> {
  try {
    const hits = await lrclibRequest("/search", { track_name: title, artist_name: artist });
    const usable = hits.filter((h) => !h.instrumental && (h.syncedLyrics || h.plainLyrics));
    if (usable.length) {
      // Prefer tracks with synced lyrics; then the closest duration match.
      usable.sort((a, b) => {
        const syncScore = (h: LrcLibHit) => (h.syncedLyrics ? 0 : 1);
        if (syncScore(a) !== syncScore(b)) return syncScore(a) - syncScore(b);
        if (durationSec && Number.isFinite(durationSec)) {
          const da = Math.abs((a.duration ?? 0) - durationSec);
          const db = Math.abs((b.duration ?? 0) - durationSec);
          return da - db;
        }
        return 0;
      });
      const hit = usable[0];
      return { synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null, source: "lrclib" };
    }
  } catch {
    // LRCLIB unreachable — fall through to ytmp3.
  }

  return { synced: null, plain: null, source: null };
}

async function fetchYtmp3Lyrics(title: string, artist: string): Promise<string | null> {
  const q = `${title} ${artist}`.trim();
  const raw = (await callUpstream({ endpoint: "search.youtube", params: { query: q }, timeoutMs: 15000 })) as Record<string, unknown>;
  const list = Array.isArray(raw?.data) ? (raw.data as Array<Record<string, unknown>>) : [];
  const videoUrl =
    typeof list[0]?.url === "string"
      ? list[0].url
      : typeof list[0]?.videoId === "string"
        ? `https://www.youtube.com/watch?v=${list[0].videoId}`
        : null;
  if (!videoUrl) return null;

  const conv = (await callUpstream({ endpoint: "download.ytmp3", params: { url: videoUrl }, timeoutMs: 45000 })) as Record<string, unknown>;
  return str(conv.lyrics) || null;
}

/** Returns synced (LRC) lyrics when available, plain otherwise. */
export async function fetchLyrics(title: string, artist: string, durationSec?: number): Promise<FetchedLyrics> {
  if (!title.trim()) return { synced: null, plain: null, source: null };
  const q = `${title}|${artist}`.trim().toLowerCase();

  return cached(`lyrics:${q}`, 60 * 60 * 1000, async () => {
    const lrclib = await lookupLrclib(title, artist, durationSec);
    if (lrclib.synced || lrclib.plain) return lrclib;

    try {
      const plain = await fetchYtmp3Lyrics(title, artist);
      if (plain) return { synced: null, plain, source: "ytmp3" };
    } catch {
      // No lyrics anywhere — callers render an honest "not available".
    }
    return { synced: null, plain: null, source: null };
  });
}

/* ------------------------------------------------------------------ */
/* Connection test + diagnostics                                        */
/* ------------------------------------------------------------------ */

export async function testConnection(): Promise<ApiStatus> {
  const started = Date.now();
  if (isPrimaryDisabled()) {
    return {
      ok: false,
      message: "Primary API is switched off (backup mode) — the app is running on the backup engine",
      checkedAt: Date.now(),
    };
  }
  try {
    const raw = (await callUpstream({
      endpoint: "search.soundcloud",
      params: { query: "test" },
      timeoutMs: 12000,
      silent: true,
    })) as Record<string, unknown>;
    const ok = raw?.status === true || Array.isArray(raw?.result);
    return {
      ok,
      latencyMs: Date.now() - started,
      message: ok ? "Connected — search endpoint responded successfully" : "Endpoint responded but returned an unexpected payload",
      checkedAt: Date.now(),
      version: typeof raw?.creator === "string" ? "Theresav" : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : "Connection failed",
      checkedAt: Date.now(),
    };
  }
}

export function clearMusicCache(): void {
  store.clear();
  inflight.clear();
  // Expire the persistent (Vercel Data Cache) layer too — expire: 0 means
  // the next read is a blocking revalidate, never stale audio.
  try {
    revalidateTag("music", { expire: 0 });
  } catch {
    /* outside a request scope (e.g. build) — nothing to revalidate */
  }
}
