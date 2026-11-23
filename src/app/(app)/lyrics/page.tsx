"use client";

import { LyricsView } from "@/components/shell/LyricsQueue";
import { usePlayerStore } from "@/lib/store/player";
import Artwork from "@/components/ui/Artwork";
import { EmptyState } from "@/components/ui/skeletons";

export default function LyricsPage() {
  const current = usePlayerStore((s) => s.current);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Lyrics</h1>
      {current ? (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Artwork src={current.artwork} seed={current.id} alt={current.title} className="size-16 rounded-xl" />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{current.title}</p>
              <p className="truncate text-sm text-muted">{current.artist}</p>
            </div>
          </div>
          <LyricsView className="max-h-[55vh]" />
        </div>
      ) : (
        <EmptyState title="No lyrics yet" description="Lyrics appear here for whatever you are playing." />
      )}
    </div>
  );
}
