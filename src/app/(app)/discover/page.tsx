"use client";

import { useState } from "react";
import { Flame, Globe2, TrendingUp, Zap } from "lucide-react";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState, ErrorState, TrackListSkeleton } from "@/components/ui/skeletons";
import { useApi } from "@/lib/client/hooks";
import { usePlayerStore } from "@/lib/store/player";
import MediaCard from "@/components/ui/MediaCard";
import Section from "@/components/ui/Section";

/* ============================================================
   DISCOVER — global + regional charts, viral tracks, trending.
   Every chip switches to a real catalogue search.
   ============================================================ */

const CHARTS = [
  { id: "global", label: "Global Top 50", query: "top 50 songs", source: "spotify" as const, icon: Globe2 },
  { id: "viral", label: "Viral right now", query: "viral hits", source: "soundcloud" as const, icon: Zap },
  { id: "nigeria", label: "Nigeria Top", query: "nigerian top songs", source: "spotify" as const, icon: Flame },
  { id: "trends", label: "Trending artists", query: "new artist hits", source: "soundcloud" as const, icon: TrendingUp },
];

export default function DiscoverPage() {
  const [chart, setChart] = useState(CHARTS[0]);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Discover</h1>
        <p className="mt-1 text-sm text-muted">Charts, viral tracks and what the world is streaming right now.</p>
      </header>

      {/* Chart chips */}
      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist">
        {CHARTS.map(({ id, label, icon: Icon }) => {
          const active = chart.id === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setChart(CHARTS.find((c) => c.id === id)!)}
              role="tab"
              aria-selected={active}
              className={`flex shrink-0 items-center gap-2 rounded-pill px-4 py-2.5 text-xs font-bold transition-colors ${
                active ? "bg-electric text-white shadow-lg shadow-brand/30" : "bg-card text-muted hover:text-ink"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>

      <ChartView key={chart.id} query={chart.query} source={chart.source} />
    </div>
  );
}

function ChartView({ query, source }: { query: string; source: "spotify" | "soundcloud" }) {
  const results = useApi<{ results: { tracks: import("@/types").Track[] } }>(
    `/api/music/search?q=${encodeURIComponent(query)}&source=${source}&limit=50`
  );

  if (results.loading) return <TrackListSkeleton count={10} />;
  if (results.error) return <ErrorState message={results.error} onRetry={results.reload} />;
  const tracks = results.data?.results.tracks ?? [];
  if (!tracks.length) return <EmptyState icon={<Globe2 className="size-5" />} title="No chart data right now" description="The upstream chart source returned nothing. Try another chip." />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold text-muted">{tracks.length} tracks</p>
        <button
          type="button"
          onClick={() => usePlayerStore.getState().playQueue(tracks, 0)}
          className="rounded-pill bg-electric px-4 py-2 text-xs font-bold text-white shadow-lg shadow-brand/30 hover:bg-cyan"
        >
          Play all
        </button>
      </div>
      <TrackList tracks={tracks} showIndex />
    </div>
  );
}

export function TrackCardRow({ tracks, title }: { tracks: import("@/types").Track[]; title?: string }) {
  if (!tracks.length) return null;
  return (
    <Section title={title}>
      {tracks.map((track) => (
        <MediaCard
          key={track.id}
          artwork={track.artwork}
          seed={track.id}
          label={track.title}
          title={track.title}
          subtitle={track.artist}
          onPlay={() => usePlayerStore.getState().playTrack(track, tracks)}
          className="w-[150px] shrink-0 snap-start md:w-[176px]"
        />
      ))}
    </Section>
  );
}
