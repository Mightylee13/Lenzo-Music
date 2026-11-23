"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Clock3, Flame, Heart, Sparkles } from "lucide-react";
import MediaCard from "@/components/ui/MediaCard";
import Section from "@/components/ui/Section";
import { CardSkeleton } from "@/components/ui/skeletons";
import { useApi } from "@/lib/client/hooks";
import { greeting } from "@/lib/client/fetcher";
import { albumTypeLabel } from "@/lib/labels";
import { useSession } from "@/lib/store/session";
import { usePlayerStore } from "@/lib/store/player";
import type { Album, Artist, Playlist, Track } from "@/types";

/* ============================================================
   HOME — greeting, hero, then every admin-enabled section.
   Sections load "small small": local shelves render instantly
   from the shell response and every remote shelf fetches on
   its own via /api/home/section, appearing as soon as it is
   ready — a slow shelf never blocks the rest of the page.
   ============================================================ */

interface SectionPayload {
  id: string;
  title: string;
  kind: string;
  tracks?: Track[];
  playlists?: Playlist[];
  albums?: Album[];
  artists?: Artist[];
}
interface SectionDescriptor {
  id: string;
  title: string;
  kind: string;
  payload: SectionPayload | null;
}
interface HomePayload {
  sections: SectionDescriptor[];
  featured: Playlist | null;
}

export default function HomePage() {
  const user = useSession((s) => s.user);
  const shell = useApi<HomePayload>("/api/home");
  const hello = useMemo(greeting, []);

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      {/* Greeting + quick access — instant, no data needed */}
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-4xl">
          {hello}{user ? `, ${user.username}` : ""}.
        </h1>
        <p className="mt-1 text-sm text-muted">Fresh finds and your favourites, in one place.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <QuickTile href="/liked" icon={<Heart className="size-5" />} title="Liked Songs" note="Your collection" />
        <QuickTile href="/recently-played" icon={<Clock3 className="size-5" />} title="Recently played" note="Pick up where you left off" />
        <QuickTile href="/discover" icon={<Flame className="size-5" />} title="Discover" note="Charts and viral tracks" />
        <QuickTile href="/radio" icon={<Sparkles className="size-5" />} title="Radio" note="Endless stations" />
      </div>

      {/* Hero featured playlist */}
      {shell.data?.featured && <FeaturedHero playlist={shell.data.featured} />}

      {/* Sections, in admin order, each loading independently */}
      {shell.data?.sections.map((descriptor) =>
        descriptor.payload ? (
          <HomeSection key={descriptor.id} payload={descriptor.payload} />
        ) : (
          <RemoteSection key={descriptor.id} id={descriptor.id} title={descriptor.title} />
        )
      )}
    </div>
  );
}

/* ---------- per-section loading ---------- */

function RemoteSection({ id, title }: { id: string; title: string }) {
  const section = useApi<SectionPayload>(`/api/home/section?id=${encodeURIComponent(id)}`);
  if (section.data) {
    return <HomeSection payload={section.data} />;
  }
  if (section.loading) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-bold text-ink">{title}</h2>
        <div className="flex gap-3 overflow-hidden">
          <CardSkeleton count={5} />
        </div>
      </section>
    );
  }
  // Failed or empty — silently skip this shelf; a reload of the page retries.
  return null;
}

function HomeSection({ payload }: { payload: SectionPayload }) {
  if (payload.kind === "tracks" && payload.tracks?.length) {
    return (
      <RenderSection title={payload.title}>
        {payload.tracks.map((track) => (
          <MediaCard
            key={track.id}
            artwork={track.artwork}
            seed={track.id}
            label={track.title}
            title={track.title}
            subtitle={track.artist}
            onPlay={() => usePlayerStore.getState().playTrack(track, payload.tracks ?? [])}
            className="w-[150px] shrink-0 snap-start md:w-[176px]"
          />
        ))}
      </RenderSection>
    );
  }
  if ((payload.kind === "playlists" || payload.kind === "genres") && payload.playlists?.length) {
    return (
      <RenderSection title={payload.title} href="/playlists">
        {payload.playlists.map((pl) => (
          <MediaCard
            key={pl.id}
            artwork={pl.artwork}
            seed={pl.id}
            label={pl.name}
            title={pl.name}
            subtitle={`Playlist · ${pl.owner}`}
            badge="Playlist"
            href={`/playlists/${pl.id}`}
            className="w-[150px] shrink-0 snap-start md:w-[176px]"
          />
        ))}
      </RenderSection>
    );
  }
  if (payload.kind === "albums" && payload.albums?.length) {
    return (
      <RenderSection title={payload.title} href="/explore">
        {payload.albums.map((al) => (
          <MediaCard
            key={al.id}
            artwork={al.artwork}
            seed={al.id}
            label={al.title}
            title={al.title}
            subtitle={`${al.artist}${al.year ? ` · ${al.year}` : ""}`}
            badge={albumTypeLabel(al.type)}
            href={`/albums/${al.id}`}
            className="w-[150px] shrink-0 snap-start md:w-[176px]"
          />
        ))}
      </RenderSection>
    );
  }
  if (payload.kind === "artists" && payload.artists?.length) {
    return (
      <RenderSection title={payload.title} href="/discover">
        {payload.artists.map((ar) => (
          <MediaCard
            key={ar.id}
            artwork={ar.image}
            seed={ar.id}
            label={ar.name}
            title={ar.name}
            subtitle="Artist"
            badge="Artist"
            round
            href={`/artists/${ar.id}`}
            className="w-[132px] shrink-0 snap-start md:w-[156px]"
          />
        ))}
      </RenderSection>
    );
  }
  if (payload.kind === "charts" && payload.tracks?.length) {
    return (
      <RenderSection title={payload.title} href="/discover">
        {payload.tracks.slice(0, 14).map((track, i, arr) => (
          <MediaCard
            key={track.id}
            artwork={track.artwork}
            seed={track.id}
            title={`#${i + 1} ${track.title}`}
            subtitle={track.artist}
            onPlay={() => usePlayerStore.getState().playTrack(track, arr)}
            className="w-[150px] shrink-0 snap-start md:w-[176px]"
          />
        ))}
      </RenderSection>
    );
  }
  return null;
}

function RenderSection({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <Section title={title} href={href}>
      {children}
    </Section>
  );
}

/* ---------- pieces ---------- */

function QuickTile({ href, icon, title, note }: { href: string; icon: React.ReactNode; title: string; note: string }) {
  return (
    <Link href={href} className="group flex min-h-[64px] items-center gap-3 rounded-card surface-gradient px-3.5 py-3 shadow-md shadow-black/25 transition-all hover:-translate-y-0.5 hover:shadow-lg md:min-h-[76px] md:px-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/8 text-cyan md:size-10">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-ink">{title}</span>
        <span className="hidden truncate text-[11px] text-muted sm:block">{note}</span>
      </span>
    </Link>
  );
}

function FeaturedHero({ playlist }: { playlist: Playlist }) {
  return (
    <Link
      href={`/playlists/${playlist.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-white/8 surface-gradient shadow-xl shadow-black/40"
    >
      <div className="flex items-center gap-4 p-4 md:gap-6 md:p-6">
        <img
          src={playlist.artwork}
          alt=""
          loading="lazy"
          className="size-24 shrink-0 rounded-xl object-cover shadow-lg shadow-black/50 md:size-36"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Featured playlist</p>
          <h2 className="mt-1 truncate text-xl font-extrabold tracking-tight text-ink md:text-3xl">{playlist.name}</h2>
          <p className="mt-1 line-clamp-2 text-xs text-muted md:text-sm">{playlist.description || `${playlist.tracks.length} hand-picked tracks`}</p>
          <div className="mt-3 flex items-center gap-2">
            <span
              role="button"
              tabIndex={0}
              aria-label={`Play ${playlist.name}`}
              onClick={(e) => {
                e.preventDefault();
                usePlayerStore.getState().playQueue(playlist.tracks, 0);
              }}
              onKeyDown={(e) => e.key === "Enter" && usePlayerStore.getState().playQueue(playlist.tracks, 0)}
              className="grid size-11 place-items-center rounded-full bg-electric text-white shadow-lg transition hover:scale-105 hover:bg-cyan"
            >
              <svg viewBox="0 0 24 24" className="ml-0.5 size-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span className="text-xs font-semibold text-muted">{playlist.tracks.length} songs</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
