"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3, Download, Heart, ListMusic, Mic2, Podcast, User } from "lucide-react";
import { FilterChips, ViewToggle, MiniSearch, AlbumGridOrList, ArtistGridOrList, type LibraryFilter } from "@/components/library/LibraryBits";
import ImportSpotifyButton from "@/components/library/ImportSpotify";
import { EmptyState } from "@/components/ui/skeletons";
import { useSession } from "@/lib/store/session";
import { useApi } from "@/lib/client/hooks";
import type { Playlist } from "@/types";

/* ============================================================
   LIBRARY — everything a listener owns or follows, filterable.
   Playlists load via /api/playlists (server, synced across
   devices); liked/albums/downloads come from the session store.
   ============================================================ */

export default function LibraryPage() {
  const session = useSession();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [grid, setGrid] = useState(true);
  const [query, setQuery] = useState("");

  const playlistsApi = useApi<{ mine: Playlist[] }>("/api/playlists");
  const playlists = playlistsApi.data?.mine ?? [];

  const available: LibraryFilter[] = ["all", "playlists", "artists", "albums", "downloads"];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Your Library</h1>
          <p className="mt-1 text-sm text-muted">{session.user ? `${session.user.username}'s collection` : "Sign in to build your collection"}</p>
        </div>
        <div className="flex items-center gap-2">
          {session.user && <ImportSpotifyButton onImported={playlistsApi.reload} />}
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

      <LibraryContent
        filter={filter}
        grid={grid}
        query={query}
        signedIn={Boolean(session.user)}
        playlists={playlists}
      />
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

function LibraryContent({
  filter,
  grid,
  query,
  signedIn,
  playlists,
}: {
  filter: LibraryFilter;
  grid: boolean;
  query: string;
  signedIn: boolean;
  playlists: Playlist[];
}) {
  const session = useSession();

  if (!signedIn) return null;

  const needle = query.trim().toLowerCase();
  const match = (title: string | undefined) => Boolean(!needle || title?.toLowerCase().includes(needle));

  const playlistsFiltered = playlists.filter((pl) => match(pl.name));
  const artists = session.library.followedArtists.filter((a) => match(a.name));
  const albums = session.library.savedAlbums.filter((a) => match(a.title));
  const downloads = session.library.downloads.filter((t) => match(t.title) || match(t.artist));

  const show = (f: LibraryFilter) => filter === "all" || filter === f;

  // Emptiness considers EVERY source — playlists included (before, users
  // with only imported playlists got the "nothing saved yet" state and
  // never saw them here).
  const nothingAtAll = playlists.length === 0 && session.library.followedArtists.length === 0 && session.library.savedAlbums.length === 0 && session.library.downloads.length === 0;
  const nothingMatching =
    playlistsFiltered.length === 0 &&
    artists.length === 0 &&
    albums.length === 0 &&
    downloads.length === 0;

  if (nothingAtAll) {
    return (
      <EmptyState
        title="Nothing saved yet"
        description="Import a Spotify playlist, like songs, follow artists and save albums — they will all show up here."
        action={<ImportSpotifyButton />}
      />
    );
  }
  if (nothingMatching) {
    return <EmptyState title="No matches" description={`Nothing in your library matches "${query}".`} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {show("playlists") && playlistsFiltered.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-[0.12em] text-faint">Your playlists</h2>
          <div className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-6">
            {playlistsFiltered.map((pl) => (
              <Link key={pl.id} href={`/playlists/${pl.id}`} className="group">
                <img src={pl.artwork} alt="" loading="lazy" className="aspect-square w-full rounded-card object-cover shadow-lg shadow-black/30 transition-transform group-hover:scale-[1.03]" />
                <p className="mt-2 truncate text-sm font-semibold text-ink">{pl.name}</p>
                <p className="truncate text-xs text-muted">{pl.tracks.length} songs</p>
              </Link>
            ))}
          </div>
        </section>
      )}
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
          <AlbumGridOrList
            albums={downloads.map((t) => ({ id: t.albumId ?? t.id, title: t.title, artist: t.artist, artwork: t.artwork, type: t.albumType }))}
            grid={grid}
          />
        </section>
      )}
    </div>
  );
}
