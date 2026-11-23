"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, ChevronLeft, Heart, UserRound, Play, Shuffle } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import MediaCard from "@/components/ui/MediaCard";
import Section from "@/components/ui/Section";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState, ErrorState, BannerSkeleton } from "@/components/ui/skeletons";
import { formatCount } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { albumTypeLabel } from "@/lib/labels";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { slug } from "@/lib/api/normalizers";
import type { Album, Artist, Track } from "@/types";

type Payload = { artist: Artist | null; tracks: Track[]; albums: Album[]; related: Artist[] };

export default function ArtistPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, loading, error, reload } = useApi<Payload>(id ? `/api/music/artist/${encodeURIComponent(id)}` : null);
  const session = useSession();
  const ui = useUi();

  if (loading) return <div className="animate-fade-in"><BannerSkeleton /></div>;
  if (error)
    return (
      <div className="animate-fade-in">
        <ErrorState message={error} onRetry={reload} />
        <div className="mt-4 text-center">
          <Link href="/search" className="text-xs font-bold text-cyan hover:underline">Try a search instead</Link>
        </div>
      </div>
    );

  const artist: Artist | null =
    data?.artist ?? (data && data.tracks.length > 0
      ? {
          id: id.startsWith("ar_") ? id : `ar_${slug(id)}`,
          name: decodeURIComponent(id.startsWith("ar_") ? id.slice(3) : id).replace(/-/g, " "),
          image: "",
          source: "soundcloud",
        }
      : null);

  if (!artist)
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={<UserRound className="size-5" />}
          title="Artist not found"
          description="We could not pull a profile for that artist."
          action={<Link href="/search" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Search music</Link>}
        />
      </div>
    );

  const following = session.isFollowingArtist(artist.id);
  const tracks = data?.tracks ?? [];
  const shuffleOn = usePlayerStore((s) => s.shuffle);
  const albums = data?.albums ?? [];

  // Real collaborators: other artist names credited on this artist's tracks.
  const collaborators: string[] = (() => {
    const main = slug(artist.name);
    const seen = new Map<string, string>();
    const note = (raw: string) => {
      const name = raw.trim();
      if (!name || slug(name) === main || seen.has(name.toLowerCase())) return;
      if (seen.size >= 6) return;
      seen.set(name.toLowerCase(), name);
    };
    for (const t of tracks) {
      for (const part of t.artist.split(/,|feat\.|&/)) note(part);
      const feat = t.title.match(/feat\.?\s+([^)]+)/i)?.[1];
      if (feat) note(feat);
    }
    return [...seen.values()];
  })();

  return (
    <div className="flex flex-col gap-7 animate-fade-in">
      <BackButton />
      {/* Banner */}
      <header className="relative -mx-4 -mt-4 overflow-hidden rounded-b-card md:-mx-6 md:-mt-6" style={{ marginInline: "-1rem", marginTop: "-1rem" }}>
        <div className="absolute inset-0">
          <Artwork src={artist.image} seed={artist.id} label={artist.name} alt="" className="size-full object-cover opacity-40 blur-2xl" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        </div>
        <div className="relative flex flex-col gap-4 px-4 pb-6 pt-16 md:flex-row md:items-end md:px-6 md:pb-8 md:pt-24">
          <Artwork
            src={artist.image}
            seed={artist.id}
            label={artist.name}
            alt=""
            className="size-28 rounded-full object-cover shadow-2xl shadow-black/60 md:size-40"
            loading="eager"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-cyan">
              {artist.verified && <BadgeCheck className="size-4" />}
              <span>{artist.verified ? "Verified artist" : "Artist"}</span>
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-6xl">{artist.name}</h1>
            {artist.monthlyListeners !== undefined && (
              <p className="mt-1 text-xs text-muted">{formatCount(artist.monthlyListeners)} monthly listeners{artist.genre ? ` · ${artist.genre}` : ""}</p>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {tracks.length > 0 && (
              <button
                type="button"
                onClick={() => usePlayerStore.getState().playQueue(tracks, 0)}
                className="flex items-center gap-2 rounded-pill bg-electric px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-cyan"
              >
                <Play className="size-4 fill-current" /> Play
              </button>
            )}
            {tracks.length > 1 && (
              <button
                type="button"
                aria-label={shuffleOn ? "Shuffle on" : "Shuffle artist"}
                aria-pressed={shuffleOn}
                onClick={() => usePlayerStore.getState().toggleShuffle()}
                className={`grid size-11 place-items-center rounded-full border transition ${
                  shuffleOn ? "border-cyan/60 bg-cyan/10 text-cyan" : "border-hairline text-ink hover:bg-white/6"
                }`}
              >
                <Shuffle className="size-4" />
              </button>
            )}
            {session.user && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await session.toggleFollowArtist(artist);
                    useUi.getState().showToast(following ? `Unfollowed ${artist.name}` : `Following ${artist.name}`, "success");
                  } catch (err) {
                    useUi.getState().showToast(err instanceof Error ? err.message : "Sign in first", "error");
                  }
                }}
                className={`flex items-center gap-2 rounded-pill border px-4 py-2.5 text-xs font-bold transition ${
                  following ? "border-electric bg-electric/12 text-cyan" : "border-hairline text-muted hover:text-ink"
                }`}
              >
                <Heart className={`size-3.5 ${following ? "fill-current" : ""}`} />
                {following ? "Following" : "Follow"}
              </button>
            )}
          </div>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-xl font-extrabold text-ink">Popular tracks</h2>
        <TrackList
          tracks={tracks}
          showIndex
          showAlbum
          compact={false}
          emptyMessage="No tracks found for this artist yet."
        />
      </section>

      {albums.length > 0 && (
        <Section title="Albums & singles" href={undefined}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {albums.map((al) => (
              <MediaCard
                key={al.id}
                artwork={al.artwork}
                seed={al.id}
                label={al.title}
                title={al.title}
                subtitle={`${albumTypeLabel(al.type)}${al.year ? ` · ${al.year}` : ""}${al.trackCount ? ` · ${al.trackCount} tracks` : ""}`}
                badge={albumTypeLabel(al.type)}
                href={`/albums/${al.id}`}
              />
            ))}
          </div>
        </Section>
      )}

      {data && data.related.length > 0 && (
        <Section title="Fans also like">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data.related.slice(0, 12).map((a) => (
              <MediaCard
                key={a.id}
                artwork={a.image}
                seed={a.id}
                label={a.name}
                title={a.name}
                subtitle="Artist"
                badge="Artist"
                href={`/artists/${a.id}`}
                round
              />
            ))}
          </div>
        </Section>
      )}

      <section className="max-w-3xl rounded-card bg-card/60 p-5">
        <h2 className="text-sm font-bold text-ink">About</h2>
        {artist.bio && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{artist.bio}</p>
        )}
        {/* Facts derived from the real catalogue — never fabricated. */}
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {artist.name} has {tracks.length} track{tracks.length === 1 ? "" : "s"}
          {albums.length > 0 ? ` across ${albums.length} release${albums.length === 1 ? "" : "s"}` : ""} available on Lenzo Music.
          {tracks.length > 0 && (
            <> Currently popular on the platform: {tracks.slice(0, 3).map((t) => `“${t.title}”`).join(", ")}.</>
          )}
        </p>
        {collaborators.length > 0 && (
          <>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Appears with</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {collaborators.map((name) => (
                <Link
                  key={name}
                  href={`/artists/${`ar_${slug(name)}`}`}
                  className="rounded-pill bg-white/6 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/10"
                >
                  {name}
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (history.length > 1 ? router.back() : router.push("/"))}
      aria-label="Go back"
      className="flex w-fit items-center gap-1.5 text-xs font-semibold text-muted transition hover:text-ink"
    >
      <span className="grid size-9 place-items-center rounded-full border border-hairline bg-card">
        <ChevronLeft className="size-4" />
      </span>
      Back
    </button>
  );
}
