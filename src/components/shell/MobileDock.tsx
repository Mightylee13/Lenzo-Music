"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Pause, Play, SkipForward } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { usePlayerStore } from "@/lib/store/player";
import { useUi } from "@/lib/store/ui";
import { formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   MOBILE DOCK — mini player fixed above the bottom navigation.
   Tap anywhere (except controls) to open the full player.
   ============================================================ */

const TABS = [
  { href: "/", label: "Home", icon: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" },
  { href: "/search", label: "Search", icon: "M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zm5.9 12.4L21 20" },
  { href: "/discover", label: "Discover", icon: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm3.5 5.5-2.1 5-5 2.1 2.1-5z" },
  { href: "/library", label: "Library", icon: "M4 4h3v16H4zM10 4h3v16h-3zM17.2 4.9l2.8 14.5-2.9.6L14.3 5.5z" },
  { href: "/profile", label: "Profile", icon: "M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM4 21c0-3.6 3.6-6 8-6s8 2.4 8 6" },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-white/6 glass-strong pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile navigation"
    >
      {TABS.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            // Re-entering Search restores the last query straight into the
            // URL, so the results view is back before the first paint.
            onClick={() => {
              if (tab.href !== "/search") return;
              try {
                const last = sessionStorage.getItem("lenzo.search.last");
                if (last && !pathname.startsWith("/search")) {
                  router.push(`/search?q=${encodeURIComponent(last)}`);
                }
              } catch { /* private mode */ }
            }}
            className="flex flex-col items-center gap-1 py-2.5 active:scale-95 transition-transform"
          >
            <svg viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`size-[22px] ${active ? "text-cyan" : "text-muted"}`} aria-hidden>
              <path d={tab.icon} />
            </svg>
            <span className={`text-[10px] font-semibold ${active ? "text-ink" : "text-muted"}`}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MiniPlayer() {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const resolved = usePlayerStore((s) => s.resolved);
  const status = usePlayerStore((s) => s.status);
  const busy = status === "resolving";

  if (!current) return null;
  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="fixed inset-x-2 bottom-[70px] z-50 md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Open full player"
        onClick={() => usePlayerStore.getState().setExpanded(true)}
        onKeyDown={(e) => e.key === "Enter" && usePlayerStore.getState().setExpanded(true)}
        className="flex items-center gap-3 rounded-2xl border border-white/10 glass-strong p-2 pr-3 shadow-2xl shadow-black/60"
      >
        <Artwork src={resolved?.artwork ?? current.artwork} seed={current.id} label={current.title} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-tight text-ink">{current.title}</p>
          <p className="truncate text-[11px] leading-tight text-muted">
            {busy ? "Finding best source…" : `${current.artist} · ${formatDuration(progress)}`}
          </p>
        </div>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation();
            usePlayerStore.getState().toggle();
          }}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-bg active:scale-95"
        >
          {isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={(e) => {
            e.stopPropagation();
            usePlayerStore.getState().next();
          }}
          className="grid size-10 shrink-0 place-items-center rounded-full text-muted active:scale-95"
        >
          <SkipForward className="size-5 fill-current" />
        </button>
      </div>
      {/* Determinate progress line along the top of the mini player */}
      <div className="mx-2.5 h-[3px] overflow-hidden rounded-full bg-white/8">
        <div className="h-full bg-gradient-to-r from-cyan to-electric transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
