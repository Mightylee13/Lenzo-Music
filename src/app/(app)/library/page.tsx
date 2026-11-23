"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3, Download, Heart, ListMusic, Mic2, Podcast, User } from "lucide-react";
import { FilterChips, ViewToggle, MiniSearch, AlbumGridOrList, ArtistGridOrList, type LibraryFilter } from "@/components/library/LibraryBits";
import ImportSpotifyButton from "@/components/library/ImportSpotify";
import { EmptyState } from "@/components/ui/skeletons";
import { useSession } from "@/lib/store/session";
import { useApi } from "@/lib/client/hooks";

/* ============================================================
   LIBRARY — everything a listener owns or follows, filterable.
   ============================================================ */

export default function LibraryPage() {
  const session = useSession();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState("");

  const available: LibraryFilter[] = ["all", "playlists", "artists", "albums", "downloads"];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Your Library</h1>
          <p className="mt-1 text-sm text-muted">{session.user ? `${session.user.username}'s collection` : "Sign in to build your collection"}</p>
        </div>
        <div className="flex items-center gap-2">
          {session.user && <ImportSpotifyButton />}
          <ViewToggle grid={grid} onToggle={() => setGrid((g) => !g)} />
        </div>
      </header>

      {!session.user && (
        <EmptyState
          icon={<User className="size-5" />}
          title="Your library lives in your account"
          description="Sign in to keep liked songs, followed artists, playlists and downloads synced."
          action={<Link href="/login" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Sign in</Link>}
        />
      )}

      <FilterChips active={filter} onChange={setFilter} available={available} />
      <MiniSearch value={query} onChange={setQuery} placeholder="Search your library" />

      <QuickLinks />

      <LibraryContent filter={filter} grid={grid} query={query} signedIn={Boolean(session.user)} />
    </div>
  );
}

function QuickLinks() {
  const tiles = [
    { href: "/liked", label: "Liked songs", icon: Heart },
    { href: "/recently-played", label: "Recently played", icon: Clock3 },
    { href: "/queue", label: "Queue", icon: ListMusic },
    { href: "/lyrics", label: "Lyrics", icon: Mic2 },
    { href: "/podcasts", label: "Podcasts", icon: Podcast },
    { href: "/downloads", label: "Downloads", icon: Download },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {tiles.map((t) => (
        <Link key={t.href} href={t.href} className="flex items-center gap-3 rounded-card surface-gradient px-3.5 py-3 shadow-md shadow-black/25 transition-transform hover:-translate-y-0.5">
          <t.icon className="size-4 text-cyan" />
          <span className="truncate text-xs font-bold text-ink">{t.label}</span>
        </Link>
      ))}
    </div>
  );
}

function LibraryContent({ filter, grid, query, signedIn }: { filter: LibraryFilter; grid: boolean; query: string; signedIn: boolean }) {
  const session = useSession();
  void query;

  if (!signedIn) return null;

  const artists = session.library.followedArtists;
  const albums = session.library.savedAlbums;
  const downloads = session.library.downloads;

  const show = (f: LibraryFilter) => filter === "all" || filter === f;
  const empty = (!show("artists") || artists.length === 0) && (!show("albums") || albums.length === 0) && (!show("downloads") || downloads.length === 0);

  if (empty) {
    return (
      <EmptyState
        title="Nothing saved yet"
        description="Like songs, follow artists and save albums — they will all show up here."
        action={<Link href="/discover" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Start discovering</Link>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {show("playlists") && <PlaylistsSection />}
      {show("artists") && artists.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-[0.12em] text-faint">Followed artists</h2>
          <ArtistGridOrList artists={artists} grid={grid} />
        </section>
      )}
      {show("albums") && albums.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-[0.12em] text-faint">Saved albums</h2>
          <AlbumGridOrList albums={albums} grid={grid} />
        </section>
      )}
      {show("downloads") && downloads.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-[0.12em] text-faint">Downloads</h2>
          <AlbumGridOrList albums={downloads.map((t) => ({ id: t.albumId ?? t.id, title: t.title, artist: t.artist, artwork: t.artwork, type: t.albumType }))} grid={grid} />
        </section>
      )}
    </div>
  );
}

function PlaylistsSection() {
  const data = useApi<{ mine: import("@/types").Playlist[] }>("/api/playlists");
  if (!data.data?.mine.length) return null;
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-[0.12em] text-faint">Your playlists</h2>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-6">
        {data.data.mine.map((pl) => (
          <Link key={pl.id} href={`/playlists/${pl.id}`} className="group">
            <img src={pl.artwork} alt="" loading="lazy" className="aspect-square w-full rounded-card object-cover shadow-lg shadow-black/30 transition-transform group-hover:scale-[1.03]" />
            <p className="mt-2 truncate text-sm font-semibold text-ink">{pl.name}</p>
            <p className="truncate text-xs text-muted">{pl.tracks.length} songs</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
