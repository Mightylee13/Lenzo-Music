"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { usePlayerStore } from "@/lib/store/player";

/* ============================================================
   MEDIA CARD — the standard artwork card used in every grid and
   horizontal carousel (tracks, albums, playlists, artists, charts).
   ============================================================ */

interface MediaCardProps {
  artwork: string;
  seed: string;
  label?: string;
  title: string;
  subtitle?: string;
  /** Small identity pill on the artwork, e.g. "Album", "Artist", "Playlist". */
  badge?: string;
  href?: string;
  round?: boolean;
  onPlay?: () => void;
  className?: string;
}

export default function MediaCard({ artwork, seed, label, title, subtitle, badge, href, round, onPlay, className = "" }: MediaCardProps) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = usePlayerStore((s) => s.current);
  // Simple visual accent while this card's context is playing.
  const active = onPlay && isPlaying && current?.title === title;

  const inner = (
    <>
      <div className={`relative overflow-hidden rounded-card shadow-lg shadow-black/40 ${round ? "rounded-full" : ""}`}>
        <Artwork src={artwork} seed={seed} label={label} alt={title} loading="lazy" className={`aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${round ? "rounded-full" : ""}`} />
        {badge && (
          <span className="absolute left-2 top-2 rounded-full bg-bg/70 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-ink backdrop-blur">
            {badge}
          </span>
        )}
        {onPlay && (
          <button
            type="button"
            aria-label={`Play ${title}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlay();
            }}
            className={`absolute right-2.5 bottom-2.5 grid size-11 place-items-center rounded-full bg-electric text-white shadow-xl shadow-black/50 transition-all duration-200 hover:scale-105 hover:bg-cyan active:scale-95 ${
              active ? "opacity-100" : "translate-y-1.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 md:opacity-0"
            } focus-visible:translate-y-0 focus-visible:opacity-100`}
            style={active ? undefined : undefined}
          >
            <Play className="size-5 fill-current" />
          </button>
        )}
      </div>
      <div className="min-w-0 px-0.5 pt-2.5">
        <p className={`truncate text-sm font-semibold leading-snug ${active ? "text-cyan" : "text-ink"}`}>{title}</p>
        {subtitle && <p className="mt-0.5 truncate text-xs leading-snug text-muted">{subtitle}</p>}
      </div>
    </>
  );

  const cls = `group block w-full text-left transition-transform duration-200 hover:-translate-y-0.5 ${className}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={cls}>
      {inner}
    </div>
  );
}
