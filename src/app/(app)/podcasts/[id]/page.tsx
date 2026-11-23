"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Mic, Play } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { EmptyState } from "@/components/ui/skeletons";
import { formatDuration } from "@/lib/client/fetcher";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { PODCASTS_SEED as PODCASTS_SOURCE } from "@/lib/data/demo";
import type { Episode, Podcast } from "@/types";

/* Deterministic demo episodes — no fabricated audio: streams are
   absent, and the play button says so honestly. */
function episodeList(pod: Podcast): Episode[] {
  return Array.from({ length: Math.min(8, Math.max(4, pod.episodeCount)) }, (_, i) => {
    const n = pod.episodeCount - i;
    const day = new Date(Date.UTC(2024, 10 - i, 4 + i));
    return {
      id: `${pod.id}_ep_${n}`,
      podcastId: pod.id,
      title: `Episode ${n} — ${["The making of a wave", "Studio culture", "Under the log drum", "Sounds that raised us", "Roads and royalties", "Blue notes", "Signal and noise", "The long game"][i % 8]}`,
      description: `${pod.publisher} unpacks another angle on ${pod.title.replace(/^The /, "")} — a demo listing for Lenzo Music.`,
      artwork: pod.artwork,
      duration: 1800 + ((i * 761) % 2400),
      publishedAt: day.toISOString(),
    };
  });
}

export default function PodcastDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const pod = PODCASTS_SOURCE.find((p) => p.id === id);
  const session = useSession();
  const ui = useUi();

  if (!pod)
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={<Mic className="size-5" />}
          title="Podcast not found"
          action={<Link href="/podcasts" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Browse podcasts</Link>}
        />
      </div>
    );

  const episodes = episodeList(pod);
  const following = session.isFollowingPodcast(pod.id);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header className="flex flex-col gap-5 md:flex-row md:items-end">
        <Artwork
          src={pod.artwork}
          seed={pod.id}
          label={pod.title}
          alt={pod.title}
          className="size-40 rounded-2xl object-cover shadow-2xl shadow-black/50 md:size-52"
          loading="eager"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Show · {pod.publisher}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-5xl">{pod.title}</h1>
          {pod.description && <p className="mt-2 max-w-2xl text-sm text-muted">{pod.description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => ui.showToast("Episodes are a demo preview for now — audio streams land with podcast support in the catalogue.", "info")}
              className="flex items-center gap-2 rounded-pill bg-electric px-6 py-3 text-sm font-bold text-white transition hover:bg-cyan"
            >
              <Play className="size-4 fill-current" /> Latest episode
            </button>
            {session.user && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await session.toggleFollowPodcast(pod.id);
                    useUi.getState().showToast(following ? `Unfollowed ${pod.title}` : `Following ${pod.title}`, "success");
                  } catch (err) {
                    useUi.getState().showToast(err instanceof Error ? err.message : "Sign in first", "error");
                  }
                }}
                className={`flex items-center gap-2 rounded-pill border px-4 py-2.5 text-xs font-bold transition ${
                  following ? "border-electric bg-electric/12 text-cyan" : "border-hairline text-muted hover:text-ink"
                }`}
              >
                <Mic className={`size-3.5 ${following ? "fill-current" : ""}`} />
                {following ? "Following" : "Follow show"}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="flex flex-col">
        <h2 className="mb-2 text-lg font-extrabold text-ink">Episodes</h2>
        {episodes.map((ep) => (
          <div
            key={ep.id}
            className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/4 md:px-3"
          >
            <div className="relative size-12 shrink-0">
              <Artwork src={ep.artwork} seed={ep.id} label={ep.title} alt="" className="size-12 rounded-lg object-cover" />
              <button
                type="button"
                aria-label={`Play ${ep.title}`}
                onClick={() => ui.showToast("Episodes are a demo preview for now — playback arrives with the podcast catalogue.", "info")}
                className="absolute inset-0 grid place-items-center rounded-lg bg-black/55 opacity-0 transition group-hover:opacity-100"
              >
                <Play className="size-4 fill-current text-white" />
              </button>
            </div>
            <button type="button" onClick={() => ui.showToast("Episodes are a demo preview for now.", "info")} className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold text-ink">{ep.title}</span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-muted">{ep.description}</span>
            </button>
            <span className="flex items-center gap-2 text-xs tabular-nums text-faint">
              <CalendarDays className="size-3.5" />
              {new Date(ep.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              · {formatDuration(ep.duration)}
            </span>
          </div>
        ))}
      </section>

      <p className="rounded-card bg-card/50 px-4 py-3 text-[11px] text-faint">
        This show is part of the Lenzo demo catalogue — listings display here, while real episode search streams in once the feed service is connected.
      </p>
    </div>
  );
}
