"use client";

import { useEffect } from "react";
import FullPlayer from "@/components/shell/FullPlayer";
import { usePlayerStore } from "@/lib/store/player";
import { EmptyState } from "@/components/ui/skeletons";

export default function NowPlayingPage() {
  useEffect(() => {
    usePlayerStore.getState().setExpanded(true);
  }, []);

  return (
    <div className="min-h-[calc(100vh-11rem)] animate-fade-in">
      <FullPlayer />
      <NowPlayingFallback />
    </div>
  );
}

function NowPlayingFallback() {
  const current = usePlayerStore((s) => s.current);
  const expanded = usePlayerStore((s) => s.expanded);
  if (current && expanded) return null;
  return (
    <div className="grid place-items-center py-24">
      <EmptyState
        title={current ? "Player collapsed" : "Nothing is playing"}
        description={current ? "Tap the mini player at the bottom to reopen the full-screen view." : "Play any song to bring the Now Playing view to life."}
      />
    </div>
  );
}
