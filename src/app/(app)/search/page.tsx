"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, Play, TrendingUp, X } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { EmptyState, ErrorState, TrackListSkeleton } from "@/components/ui/skeletons";
import { useApi, useDebounced } from "@/lib/client/hooks";
import { albumTypeLabel } from "@/lib/labels";
import { usePlayerStore } from "@/lib/store/player";
import type { SearchResults, Track } from "@/types";

/* ============================================================
   SEARCH — debounced instant search with suggestions, recent
   history and artist/album cards, all sources merged into one list.
   ============================================================ */

const RECENT_KEY = "lenzo.search.recent";
// All sources (SoundCloud + Spotify + YouTube) are merged into one unified
// catalogue — the UI never splits results by provider.

const TRENDING_SEARCHES = ["Burna Boy", "afrobeats 2025", "Amapiano mix", "lo-fi chill", "Wizkid", "gospel songs"];

export default function SearchPage() {
  return (
    <Suspense fallback={<TrackListSkeleton count={6} />}>
      <SearchInner />
    </Suspense>
  );
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [recent, setRecent] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const debounced = useDebounced(query.trim(), 200);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
    } catch {
      setRecent([]);
    }
  }, []);

  const suggest = useApi<{ suggestions: string[] }>(debounced.length >= 2 ? `/api/music/suggest?q=${encodeURIComponent(debounced)}` : null);

  // Debounced navigation keeps /search?q= shareable.
  useEffect(() => {
    if (debounced.length >= 2) {
      router.replace(`/search?q=${encodeURIComponent(debounced)}`, { scroll: false });
    }
  }, [debounced, router]);

  const results = useApi<{ results: SearchResults }>(
    debounced.length >= 2 ? `/api/music/search?q=${encodeURIComponent(debounced)}&limit=50` : null
  );

  const commit = (q: string) => {
    setQuery(q);
    if (q.trim().length >= 2) {
      const next = [q, ...recent.filter((r) => r !== q)].slice(0, 8);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    }
  };

  const searching = Boolean(debounced.length >= 2 && results.loading);
  // Never re-render the dropdown while the last keystroke is still in flight:
  // stale suggestions remain visible until fresh ones arrive.
  const suggestions = suggest.data?.suggestions?.filter((s) => s.toLowerCase() !== debounced.toLowerCase()) ?? [];

  // Instant local suggestions — recent searches and trending chips that
  // match what's typed, shown while the server suggestion call is in flight.
  const localSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pool = new Set<string>();
    for (const t of TRENDING_SEARCHES) if (t.toLowerCase().includes(q)) pool.add(t);
    for (const r of recent) if (r !== q && r.toLowerCase().includes(q)) pool.add(r);
    return [...pool].slice(0, 5);
  }, [query, recent]);

  const dropdownItems = Array.from(new Set([...localSuggestions, ...suggestions]))
    .filter((s) => s.toLowerCase() !== debounced.toLowerCase())
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Search bar */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 bg-gradient-to-b from-bg via-bg/95 to-transparent px-4 pb-3 pt-4 md:static md:mx-0 md:mt-0 md:bg-none md:px-0 md:pt-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFocused(false);
            commit(query);
          }}
          role="search"
        >
          <div className="flex items-center gap-2.5 rounded-pill border border-hairline bg-card px-4 py-3 focus-within:border-cyan/60">
            <SearchIcon className="size-5 shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Songs, artists, albums or moods…"
              className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink outline-none placeholder:text-faint"
              aria-label="Search query"
              autoFocus
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); router.replace("/search", { scroll: false }); }} className="grid size-6 place-items-center rounded-full bg-white/8 text-muted hover:text-ink">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </form>

        {/* Dropdown: local + server suggestions while typing; trending chips
            only when the query is empty — never covering live results. */}
        {focused && dropdownItems.length > 0 && (
          <div className="absolute inset-x-4 z-30 mt-2 rounded-2xl border border-white/8 glass-strong p-2 shadow-2xl shadow-black/60 md:inset-x-0 md:mt-1 md:max-w-2xl">
            {showSuggestions(dropdownItems, query, (s) => commit(s))}
          </div>
        )}
        {focused && query.trim().length < 2 && suggestions.length === 0 && (
          <div className="absolute inset-x-4 z-30 mt-2 rounded-2xl border border-white/8 glass-strong p-2 shadow-2xl shadow-black/60 md:inset-x-0 md:mt-1 md:max-w-2xl">
            <TrendingChips onPick={commit} />
          </div>
        )}
      </div>

      {/* Empty states */}
      {debounced.length < 2 && !searching && <SearchLanding recent={recent} onPick={commit} onClear={() => { setRecent([]); localStorage.removeItem(RECENT_KEY); }} />}

      {/* Results */}
      {(searching || results.data) && (
        <>
          {searching && (results.data ? <TrackListSkeleton count={5} /> : <TrackListSkeleton count={10} />)}
          {results.error && <ErrorState message={`${results.error} — try another source.`} onRetry={results.reload} />}

          {results.data?.results && <SearchResultsView results={results.data.results} query={debounced} tracks={results.data.results.tracks} />}
        </>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function showSuggestions(suggestions: string[], query: string, onPick: (q: string) => void) {
  return (
    <div className="flex flex-col">
      {suggestions.map((s) => {
        // Spotify highlights just the part of the suggestion you typed.
        const i = query ? s.toLowerCase().indexOf(query.toLowerCase()) : -1;
        return (
          <button key={s} type="button" onClick={() => onPick(s)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/6">
            <SearchIcon className="size-4 shrink-0 text-muted" />
            <span className="truncate text-ink">
              {i === 0 ? (
                <>
                  <span className="font-bold underline decoration-ink/40 underline-offset-2">{s.slice(0, query.length)}</span>
                  {s.slice(query.length)}
                </>
              ) : (
                <span className="font-semibold">{s}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TrendingChips({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="px-3 pb-2 pt-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Trending searches</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TRENDING_SEARCHES.map((t) => (
          <button key={t} type="button" onClick={() => onPick(t)} className="rounded-pill bg-white/6 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/10">
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchLanding({ recent, onPick, onClear }: { recent: string[]; onPick: (q: string) => void; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">Recent searches</h2>
            <button type="button" onClick={onClear} className="text-xs font-semibold text-muted hover:text-ink">Clear all</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <button key={q} type="button" onClick={() => onPick(q)} className="flex items-center gap-2 rounded-pill bg-card px-3.5 py-2 text-xs font-semibold text-ink hover:bg-elevated">
                <X className="size-3 text-faint" aria-hidden />
                {q}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-ink">
          <TrendingUp className="size-4 text-cyan" /> Trending searches
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {TRENDING_SEARCHES.map((t) => (
            <button key={t} type="button" onClick={() => onPick(t)} className="rounded-card surface-gradient px-4 py-3.5 text-left text-sm font-bold text-ink shadow-md shadow-black/25 transition-transform hover:-translate-y-0.5">
              {t}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold text-ink">Browse all</h2>
        <GenreGrid />
      </section>
    </div>
  );
}

export function GenreGrid({ genres }: { genres?: { id: string; name: string; gradient: string }[] }) {
  const data = useApi<{ genres: { id: string; name: string; gradient: string }[] }>("/api/genres");
  const items = genres ?? data.data?.genres ?? [];
  if (data.loading && !genres) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-card" />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((g) => (
        <Link
          key={g.id}
          href={`/explore/${g.id}`}
          className="flex h-20 items-end rounded-card p-3 shadow-md shadow-black/30 transition-transform hover:-translate-y-0.5"
          style={{ background: g.gradient }}
        >
          <span className="text-sm font-extrabold text-white drop-shadow">{g.name}</span>
        </Link>
      ))}
    </div>
  );
}

function SearchResultsView({ results, query, tracks }: { results: SearchResults; query: string; tracks: Track[] }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const current = usePlayerStore((s) => s.current);

  if (results.total === 0) {
    return <EmptyState icon={<SearchIcon className="size-5" />} title={`No results for "${query}"`} description="Check the spelling or try different wording." />;
  }

  type Row = {
    kind: "song" | "artist" | "album" | "playlist";
    id: string;
    title: string;
    subtitle: string;
    artwork: string;
    round?: boolean;
    href?: string;
    track?: Track;
    score: number;
    order: number;
  };

  const rows: Row[] = [];
  const q = query.trim();

  // Spotify-style subtitles: what a thing IS first (Song/Album/EP/Single/
  // Artist/Playlist), "New · " in front when it dropped within ~4 weeks.
  const isNew = (iso?: string) => {
    if (!iso) return false;
    const then = Date.parse(iso);
    return Number.isFinite(then) && Date.now() - then < 28 * 864e5;
  };

  // Same scoring idea as the server: exact match > includes > loose.
  const rel = (text: string) => {
    const t = text.toLowerCase();
    const n = q.toLowerCase();
    if (!text) return 0;
    if (t === n) return 130;
    if (t.startsWith(n) || t.endsWith(n)) return 110;
    if (t.includes(n)) return 90;
    const tokens = n.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every((tk) => t.includes(tk))) return 70;
    return 10;
  };

  let order = 0;
  for (const t of tracks.slice(0, 25)) {
    rows.push({
      kind: "song",
      id: t.id,
      title: t.title,
      subtitle: `${isNew(t.releaseDate) ? "New · " : ""}Song · ${t.artist}`,
      artwork: t.artwork,
      track: t,
      score: Math.max(rel(t.title), rel(t.artist) - 5, rel(t.album ?? "") - 5),
      order: order++,
    });
  }
  for (const al of results.albums.slice(0, 10)) {
    rows.push({
      kind: "album",
      id: `al-${al.id}`,
      title: al.title,
      subtitle: `${isNew(al.releaseDate) ? "New · " : ""}${albumTypeLabel(al.type)} · ${al.artist}`,
      artwork: al.artwork,
      // Sets we could not open in-app (SoundCloud releases) carry their own
      // URL — link out rather than dead-ending on an album route.
      href: al.url ?? `/albums/${al.id}`,
      score: Math.max(rel(al.title), rel(al.artist) - 5),
      order: order++,
    });
  }
  for (const a of results.artists.slice(0, 10)) {
    rows.push({
      kind: "artist",
      id: `ar-${a.id}`,
      title: a.name,
      subtitle: "Artist",
      artwork: a.image,
      round: true,
      href: `/artists/${a.id}`,
      // Times 2 so the matching artist lands at the top of the list.
      score: rel(a.name) * 2,
      order: order++,
    });
  }
  for (const pl of results.playlists.slice(0, 8)) {
    rows.push({
      kind: "playlist",
      id: `pl-${pl.id}`,
      title: pl.name,
      subtitle: `Playlist · ${pl.owner}`,
      artwork: pl.artwork,
      href: `/playlists/${pl.id}`,
      score: Math.max(rel(pl.name), rel(pl.owner) - 5),
      order: order++,
    });
  }

  // One natural mixed list: strongest matches first, grouped segments gone.
  rows.sort((a, b) => b.score - a.score || a.order - b.order);
  // When there are strong matches, drop the fully unrelated tail.
  const best = rows[0]?.score ?? 0;
  const visible = best >= 90 ? rows.filter((r) => r.score > 10) : rows;

  return (
    <div className="flex flex-col">
      <h2 className="mb-1 px-1 text-lg font-bold text-ink">Results</h2>
      <div className="flex flex-col">
        {visible.map((row) => {
          const isCurrent = row.kind === "song" && current?.id === row.track?.id;
          const isCurrentPlaying = isCurrent && usePlayerStore.getState().isPlaying;
          const inner = (
            <>
              <Artwork
                src={row.artwork}
                seed={row.kind === "song" ? row.track!.id : row.id}
                label={row.title}
                alt=""
                className={`size-12 shrink-0 object-cover ${row.round ? "rounded-full" : "rounded-lg"}`}
                loading="lazy"
              />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${isCurrent ? "text-cyan" : "text-ink"}`}>{row.title}</span>
                <span className="block truncate text-xs text-muted">{row.subtitle}</span>
              </span>
              {row.kind === "song" && (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/8 text-ink">
                  {isCurrent && isCurrentPlaying ? <EqualizerIcon /> : <Play className="size-4 fill-current" />}
                </span>
              )}
            </>
          );

          if (row.kind === "song" && row.track) {
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => (isCurrent ? toggle() : playTrack(row.track!, tracks))}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/4"
              >
                {inner}
              </button>
            );
          }
          const external = /^https?:\/\//.test(row.href ?? "");
          if (external) {
            return (
              <a
                key={row.id}
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/4"
              >
                {inner}
              </a>
            );
          }
          return (
            <Link key={row.id} href={row.href ?? "#"} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/4">
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Tiny animated bar indicator for the currently playing song row. */
function EqualizerIcon() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] animate-equalizer rounded-full bg-cyan" style={{ height: "100%", animationDelay: `${i * 0.18}s` }} />
      ))}
    </span>
  );
}
