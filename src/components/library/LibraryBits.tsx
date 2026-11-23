"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Grid3X3, List, Search } from "lucide-react";
import MediaCard from "@/components/ui/MediaCard";
import { albumTypeLabel } from "@/lib/labels";
import type { Album } from "@/types";

/* ============================================================
   LIBRARY GRID helpers — filter chips + view switching shared
   by /library, /podcasts and profile content.
   ============================================================ */

export type LibraryFilter = "all" | "playlists" | "artists" | "albums" | "podcasts" | "downloads";

export const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: "All",
  playlists: "Playlists",
  artists: "Artists",
  albums: "Albums",
  podcasts: "Podcasts",
  downloads: "Downloads",
};

export function FilterChips({
  active,
  onChange,
  available,
}: {
  active: LibraryFilter;
  onChange: (f: LibraryFilter) => void;
  available: LibraryFilter[];
}) {
  return (
    <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
      {available.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(f)}
          className={`shrink-0 rounded-pill px-3.5 py-2 text-xs font-bold transition-colors ${
            active === f ? "bg-ice text-bg" : "bg-card text-muted hover:text-ink"
          }`}
        >
          {FILTER_LABELS[f]}
        </button>
      ))}
    </div>
  );
}

export function ViewToggle({ grid, onToggle }: { grid: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={grid ? "Switch to list view" : "Switch to grid view"}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-card text-muted transition-colors hover:text-ink"
    >
      {grid ? <List className="size-4" /> : <Grid3X3 className="size-4" />}
    </button>
  );
}

export function MiniSearch({ value, onChange, placeholder = "Filter…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-pill border border-hairline bg-card px-3.5 py-2.5">
      <Search className="size-4 shrink-0 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        aria-label="Filter items"
      />
    </div>
  );
}

export function useLibraryFilter<T extends { name?: string; title?: string }>(items: T[], query: string): T[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.name ?? i.title ?? "").toLowerCase().includes(q));
  }, [items, query]);
}

export function ArtistGridOrList({ artists, grid }: { artists: { id: string; name: string; image: string; genre?: string }[]; grid: boolean }) {
  if (!grid) {
    return (
      <div className="flex flex-col">
        {artists.map((a) => (
          <Link key={a.id} href={`/artists/${a.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
            <img src={a.image} alt="" loading="lazy" className="size-11 rounded-full object-cover" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{a.name}</span>
              <span className="block text-xs text-muted">{a.genre ?? "Artist"}</span>
            </span>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-6">
      {artists.map((a) => (
        <MediaCard key={a.id} artwork={a.image} seed={a.id} label={a.name} title={a.name} subtitle="Artist" badge="Artist" round href={`/artists/${a.id}`} />
      ))}
    </div>
  );
}

export function AlbumGridOrList({
  albums,
  grid,
}: {
  albums: { id: string; title: string; artist: string; artwork: string; year?: number; type?: Album["type"] }[];
  grid: boolean;
}) {
  if (!grid) {
    return (
      <div className="flex flex-col">
        {albums.map((a) => (
          <Link key={a.id} href={`/albums/${a.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
            <img src={a.artwork} alt="" loading="lazy" className="size-11 rounded-lg object-cover" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{a.title}</span>
              <span className="block truncate text-xs text-muted">{albumTypeLabel(a.type)} · {a.artist}</span>
            </span>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-6">
      {albums.map((a) => (
        <MediaCard
          key={a.id}
          artwork={a.artwork}
          seed={a.id}
          label={a.title}
          title={a.title}
          subtitle={`${albumTypeLabel(a.type)} · ${a.artist}`}
          badge={albumTypeLabel(a.type)}
          href={`/albums/${a.id}`}
        />
      ))}
    </div>
  );
}
