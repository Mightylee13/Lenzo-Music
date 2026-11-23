"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Bookmark, BookmarkCheck, ChevronLeft, Clock3, Play, Shuffle } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState, ErrorState, BannerSkeleton } from "@/components/ui/skeletons";
import { formatDuration } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { albumTypeLabel } from "@/lib/labels";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import type { Album, Track } from "@/types";

type Payload = { album: Album & { tracks: Track[] } };

export default function AlbumPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, loading, error, reload } = useApi<Payload>(id ? `/api/music/album/${encodeURIComponent(id)}` : null);
  const session = useSession();

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

  const album = data?.album;
  if (!album)
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={<Clock3 className="size-5" />}
          title="Album not found"
          description="That release is no longer in the catalogue."
          action={<Link href="/search" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Search music</Link>}
        />
      </div>
    );

  const tracks = album.tracks ?? [];
  const totalSeconds = tracks.reduce((acc, t) => acc + t.duration, 0) || album.duration;
  const saved = session.isSavedAlbum(album.id);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <BackButton />
      <header className="flex flex-col gap-5 md:flex-row md:items-end">
        <Artwork
          src={album.artwork}
          seed={album.id}
          label={album.title}
          alt={album.title}
          className="size-40 rounded-2xl object-cover shadow-2xl shadow-black/50 md:size-52"
          loading="eager"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">{albumTypeLabel(album.type)}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-5xl">{album.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {album.artistId ? (
              <Link href={`/artists/${album.artistId}`} className="font-semibold text-ink hover:underline">{album.artist}</Link>
            ) : (
              <span className="font-semibold text-ink">{album.artist}</span>
            )}
            {album.year ? ` · ${album.year}` : ""} · {album.trackCount} songs
            {totalSeconds ? ` · ${Math.floor(totalSeconds / 3600)}h ${Math.round((totalSeconds % 3600) / 60)}m` : ""}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {tracks.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => usePlayerStore.getState().playQueue(tracks, 0)}
                  className="flex items-center gap-2 rounded-pill bg-white px-6 py-3 text-sm font-bold text-bg shadow-lg transition hover:scale-[1.02]"
                >
                  <Play className="size-4 fill-current" /> Play
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const store = usePlayerStore.getState();
                    if (!store.shuffle) store.toggleShuffle();
                    store.playQueue(tracks, Math.floor(Math.random() * tracks.length));
                  }}
                  className="flex items-center gap-2 rounded-pill border border-hairline px-5 py-3 text-sm font-bold text-ink transition hover:bg-white/6"
                >
                  <Shuffle className="size-4" /> Shuffle
                </button>
              </>
            )}
            {session.user && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await session.toggleSaveAlbum(album);
                    useUi.getState().showToast(saved ? "Removed from your library" : "Saved to your library", "success");
                  } catch (err) {
                    useUi.getState().showToast(err instanceof Error ? err.message : "Sign in first", "error");
                  }
                }}
                className={`flex items-center gap-2 rounded-pill border px-4 py-2.5 text-xs font-bold transition ${
                  saved ? "border-electric bg-electric/12 text-cyan" : "border-hairline text-muted hover:text-ink"
                }`}
              >
                {saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
                {saved ? "In your library" : "Save album"}
              </button>
            )}
          </div>
        </div>
      </header>

      <TrackList tracks={tracks} showIndex showAlbum={false} emptyMessage="This album has no streamable tracks right now." />
      {totalSeconds > 0 && <p className="text-[11px] text-faint">Total run time {formatDuration(totalSeconds)}</p>}
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
