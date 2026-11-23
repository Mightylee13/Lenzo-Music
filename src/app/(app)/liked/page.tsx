"use client";

import Link from "next/link";
import { Heart, Play, Shuffle } from "lucide-react";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState } from "@/components/ui/skeletons";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";

export function TrackCollectionHeader({
  title,
  subtitle,
  tracks,
  accent = "bg-electric",
  icon,
}: {
  title: string;
  subtitle: string;
  tracks: import("@/types").Track[];
  accent?: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end">
      <div className={`grid size-40 place-items-center rounded-2xl shadow-2xl shadow-black/50 md:size-52 ${accent} text-white`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Collection</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-5xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
        {tracks.length > 0 && (
          <div className="mt-4 flex items-center gap-2.5">
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
                store.setShuffle(true);
                store.playQueue(tracks, Math.floor(Math.random() * tracks.length));
              }}
              className="flex items-center gap-2 rounded-pill border border-hairline px-5 py-3 text-sm font-bold text-ink transition hover:bg-white/6"
            >
              <Shuffle className="size-4" /> Shuffle
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default function LikedPage() {
  const session = useSession();
  const tracks = session.library.likedTracks;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <TrackCollectionHeader
        title="Liked Songs"
        subtitle={session.user ? `${tracks.length} songs you have loved` : "Sign in to build your loved collection"}
        tracks={tracks}
        accent="bg-gradient-to-br from-brand to-[#1747a8]"
        icon={<Heart className="size-14 fill-current" />}
      />
      {!session.user ? (
        <EmptyState
          icon={<Heart className="size-5" />}
          title="Not signed in"
          description="Your liked songs sync through your account."
          action={<Link href="/login" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Sign in</Link>}
        />
      ) : (
        <TrackList tracks={tracks} emptyMessage="Tap the heart on any song and it lands here." />
      )}
    </div>
  );
}
