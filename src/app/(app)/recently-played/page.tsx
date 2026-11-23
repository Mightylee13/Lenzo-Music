"use client";

import Link from "next/link";
import { Clock3 } from "lucide-react";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState } from "@/components/ui/skeletons";
import { TrackCollectionHeader } from "@/app/(app)/liked/page";
import { useSession } from "@/lib/store/session";

export default function RecentlyPlayedPage() {
  const session = useSession();
  const tracks = session.library.recentlyPlayed;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <TrackCollectionHeader
        title="Recently Played"
        subtitle={tracks.length ? `${tracks.length} tracks in your history` : "Whatever you play lands here"}
        tracks={tracks}
        accent="bg-gradient-to-br from-[#1747a8] to-cyan"
        icon={<Clock3 className="size-14" />}
      />
      {!session.user ? (
        <EmptyState
          icon={<Clock3 className="size-5" />}
          title="Not signed in"
          description="Your listening history is private to your account."
          action={<Link href="/login" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Sign in</Link>}
        />
      ) : (
        <TrackList tracks={tracks} emptyMessage="Your listening history will appear here as you play music." />
      )}
    </div>
  );
}
