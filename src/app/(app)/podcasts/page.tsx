"use client";

import { Mic, Radio } from "lucide-react";
import MediaCard from "@/components/ui/MediaCard";
import { EmptyState } from "@/components/ui/skeletons";
import { PODCASTS_SEED } from "@/lib/data/demo";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import type { Podcast } from "@/types";

export default function PodcastsPage() {
  const session = useSession();

  const podcasts: Podcast[] = PODCASTS_SEED.map((p) => ({
    ...p,
    artwork: p.artwork,
  }));

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Talk & audio</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-4xl">Podcasts</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          A demo catalogue while the pod service comes online — follow shows to slot them into your library.
        </p>
      </header>

      {podcasts.length === 0 ? (
        <EmptyState icon={<Radio className="size-5" />} title="No podcasts yet" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {podcasts.map((pod) => {
            const following = session.isFollowingPodcast(pod.id);
            return (
              <div key={pod.id} className="flex flex-col gap-2">
                <MediaCard
                  artwork={pod.artwork}
                  seed={pod.id}
                  label={pod.title}
                  title={pod.title}
                  subtitle={pod.publisher}
                  href={`/podcasts/${pod.id}`}
                />
                <button
                  type="button"
                  disabled={!session.user}
                  title={session.user ? undefined : "Sign in to follow"}
                  onClick={async () => {
                    try {
                      await session.toggleFollowPodcast(pod.id);
                      useUi.getState().showToast(following ? `Unfollowed ${pod.title}` : `Following ${pod.title}`, "success");
                    } catch (err) {
                      useUi.getState().showToast(err instanceof Error ? err.message : "Sign in first", "error");
                    }
                  }}
                  className={`mx-auto flex items-center gap-1.5 rounded-pill border px-3.5 py-1.5 text-[11px] font-bold transition ${
                    following ? "border-electric bg-electric/12 text-cyan" : "border-hairline text-muted hover:text-ink disabled:opacity-40"
                  }`}
                >
                  <Mic className={`size-3 ${following ? "fill-current" : ""}`} />
                  {following ? "Following" : "Follow"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
