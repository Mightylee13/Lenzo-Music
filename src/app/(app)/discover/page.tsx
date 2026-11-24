"use client";

import { useState } from "react";
import { Flame, Globe2, Music4, Sparkles } from "lucide-react";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState, ErrorState, TrackListSkeleton } from "@/components/ui/skeletons";
import { useApi } from "@/lib/client/hooks";
import { usePlayerStore } from "@/lib/store/player";
import MediaCard from "@/components/ui/MediaCard";
import Section from "@/components/ui/Section";
import type { Playlist } from "@/types";

/* ============================================================
   DISCOVER — real editorial charts, in sync with the rest of
   the app: the same Apple Music / Deezer charts the home chart
   shelves use, plus the engine catalogue for "hot right now".
   ============================================================ */

const CHARTS = [
  { id: "chart-apple-us", label: "Global Top", icon: Globe2 },
  { id: "chart-apple-ng", label: "Nigeria Top", icon: Flame },
  { id: "chart-dz-amapiano", label: "Amapiano", icon: Music4 },
  { id: "chart-apple-gb", label: "UK Top", icon: Sparkles },
] as const;

export default function DiscoverPage() {
  const [chartId, setChartId] = useState<string>(CHARTS[0].id);
  const active = CHARTS.find((c) => c.id === chartId) ?? CHARTS[0];

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Discover</h1>
        <p className="mt-1 text-sm text-muted">Real charts, updated weekly — the same hits the home shelves pull.</p>
      </header>

      {/* Chart chips */}
      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist">
        {CHARTS.map(({ id, label, icon: Icon }) => {
          const isActive = chartId === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setChartId(id)}
              role="tab"
              aria-selected={isActive}
              className={`flex shrink-0 items-center gap-2 rounded-pill px-4 py-2.5 text-xs font-bold transition-colors ${
                isActive ? "bg-electric text-white shadow-lg shadow-brand/30" : "bg-card text-muted hover:text-ink"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>

      <ChartView key={chartId} chartId={chartId} fallbackQuery={active.label + " hits"} />
    </div>
  );
}

function ChartView({ chartId, fallbackQuery }: { chartId: string; fallbackQuery: string }) {
  const chart = useApi<{ playlist: Playlist }>(`/api/music/charts/${encodeURIComponent(chartId)}`);
  const search = useApi<{ results: { tracks: import("@/types").Track[] } }>(
    chart.error ? `/api/music/search?q=${encodeURIComponent(fallbackQuery)}&source=spotify&limit=50` : null,
  );

  if (chart.loading) return <TrackListSkeleton count={10} />;
  if (chart.error) {
    if (search.loading) return <TrackListSkeleton count={10} />;
    if (search.error) return <ErrorState message={search.error} onRetry={search.reload} />;
    const tracks = search.data?.results.tracks ?? [];
    if (!tracks.length) return <EmptyState icon={<Globe2 className="size-5" />} title="No chart data right now" description="Try another chip." />;
    return <TracksBlock title={fallbackQuery} tracks={tracks} />;
  }

  const playlist = chart.data?.playlist;
  if (!playlist?.tracks?.length) {
    return <EmptyState icon={<Globe2 className="size-5" />} title="Chart is empty" description="Try another chip." />;
  }
  return <TracksBlock title={playlist.name} tracks={playlist.tracks} />;
}

function TracksBlock({ title, tracks }: { title: string; tracks: import("@/types").Track[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold text-muted">{title} · {tracks.length} tracks</p>
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
