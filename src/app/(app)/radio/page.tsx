"use client";

import { useState } from "react";
import { Play, Radio as RadioIcon, Sparkles } from "lucide-react";
import MediaCard from "@/components/ui/MediaCard";
import Section from "@/components/ui/Section";
import { TrackListSkeleton } from "@/components/ui/skeletons";
import TrackList from "@/components/tracks/TrackList";
import { useApi } from "@/lib/client/hooks";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { GENRES } from "@/lib/data/demo";
import type { Track } from "@/types";

/* ============================================================
   RADIO — endless stations. A station = a themed catalogue
   search shuffled into the queue. Song/artist radio seeds from
   any track/artist you pick.
   ============================================================ */

const MOOD_STATIONS = [
  { id: "workout", name: "Workout Energy", query: "workout motivation", seedArtwork: "radio-workout" },
  { id: "chill", name: "Chill Wave", query: "chill vibe mix", seedArtwork: "radio-chill" },
  { id: "focus", name: "Deep Focus", query: "focus instrumental", seedArtwork: "radio-focus" },
  { id: "party", name: "Party Mode", query: "party club bangers", seedArtwork: "radio-party" },
  { id: "sleep", name: "Late Night", query: "sleep ambient calm", seedArtwork: "radio-sleep" },
  { id: "road", name: "Road Trip", query: "road trip anthems", seedArtwork: "radio-road" },
];

export default function RadioPage() {
  const session = useSession();
  const [openStation, setOpenStation] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink md:text-3xl">
          <RadioIcon className="size-7 text-cyan" /> Radio
        </h1>
        <p className="mt-1 text-sm text-muted">Live stations built from the catalogue — always something playing.</p>
      </header>

      {/* Mood stations */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-ink">Mood stations</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {MOOD_STATIONS.map((station) => (
            <StationCard key={station.id} station={station} onOpen={() => setOpenStation(openStation === station.id ? null : station.id)} open={openStation === station.id} />
          ))}
        </div>
      </section>

      {/* Genre stations */}
      <Section title="Genre stations">
        {GENRES.slice(0, 12).map((g) => (
          <StationCard
            key={g.id}
            station={{ id: g.id, name: g.name, query: `${g.name} radio`, seedArtwork: g.id }}
            onOpen={() => setOpenStation(openStation === g.id ? null : g.id)}
            open={openStation === g.id}
            round
            className="w-[150px] shrink-0 snap-start md:w-[176px]"
          />
        ))}
      </Section>

      {/* Artist radio from followed artists */}
      {session.library.followedArtists.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-ink">Artist radio</h2>
          <ArtistRadio artists={session.library.followedArtists} />
        </section>
      )}

      {openStation && <StationPlayback station={MOOD_STATIONS.concat(GENRES.map((g) => ({ id: g.id, name: g.name, query: `${g.name} radio`, seedArtwork: g.id }))).find((s) => s.id === openStation)!} onDone={() => setOpenStation(null)} />}
    </div>
  );
}

function StationCard({ station, onOpen, open, round, className }: { station: { id: string; name: string; query: string; seedArtwork: string }; onOpen: () => void; open: boolean; round?: boolean; className?: string }) {
  return (
    <MediaCard
      artwork={generateRadioArt(station.seedArtwork)}
      seed={station.seedArtwork}
      label={station.name}
      title={station.name}
      subtitle={open ? "Now tuned in" : "Radio station"}
      round={round}
      className={className ?? "w-full"}
      onPlay={() => {
        onOpen();
      }}
    />
  );
}

function ArtistRadio({ artists }: { artists: { id: string; name: string; image: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {artists.slice(0, 8).map((a) => (
        <MediaCard
          key={a.id}
          artwork={a.image}
          seed={a.id}
          label={a.name}
          title={`${a.name} Radio`}
          subtitle="Mix of similar sound"
          round
          onPlay={async () => {
            const res = await fetch(`/api/music/search?q=${encodeURIComponent(a.name)}&source=soundcloud&limit=50`).then((r) => r.json()).catch(() => null);
            const tracks: Track[] = res?.results?.tracks ?? [];
            if (tracks.length) {
              usePlayerStore.getState().setShuffle(true);
              usePlayerStore.getState().playQueue(tracks, Math.floor(Math.random() * Math.min(tracks.length, 10)));
            }
          }}
          className="w-full"
        />
      ))}
    </div>
  );
}

function StationPlayback({ station, onDone }: { station: { id: string; name: string; query: string }; onDone: () => void }) {
  const data = useApi<{ results: { tracks: Track[] } }>(`/api/music/search?q=${encodeURIComponent(station.query)}&source=soundcloud&limit=30`);
  const tracks = data.data?.results.tracks ?? [];
  const started = usePlayerStore((s) => Boolean(s.current));

  return (
    <section className="rounded-card surface-gradient border border-white/8 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-electric/20 text-cyan"><Sparkles className="size-5" /></span>
          <div>
            <p className="text-sm font-bold text-ink">{station.name}</p>
            <p className="text-xs text-muted">{data.loading ? "Tuning the station…" : `${tracks.length} tracks from the live catalogue`}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!tracks.length) return;
            usePlayerStore.getState().setShuffle(true);
            usePlayerStore.getState().playQueue(tracks, Math.floor(Math.random() * Math.min(tracks.length, 10)));
            onDone();
          }}
          disabled={!tracks.length}
          className="flex items-center gap-1.5 rounded-pill bg-electric px-4 py-2 text-xs font-bold text-white transition hover:bg-cyan disabled:opacity-40"
        >
          {started ? <Play className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
          Tune in
        </button>
      </div>
      {data.loading ? <TrackListSkeleton count={4} /> : tracks.length > 0 && <TrackList tracks={tracks.slice(0, 8)} showIndex={false} compact />}
      {data.error && <p className="pt-3 text-xs text-danger">{data.error}</p>}
    </section>
  );
}

/* Radio card artwork: deterministic SVG in the app palette. */
import { generateArtwork } from "@/lib/artwork";
function generateRadioArt(seed: string): string {
  return generateArtwork(`radio-${seed}`, seed);
}
