"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Compass,
  Download,
  Heart,
  Home,
  Library,
  Mic2,
  Podcast,
  Radio,
  Search,
  Clock3,
} from "lucide-react";
import { useSession } from "@/lib/store/session";
import { usePlayerStore } from "@/lib/store/player";

/* ============================================================
   SIDEBAR — desktop navigation, collapsible.
   ============================================================ */

interface SidebarProps {
  collapsed: boolean;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1" aria-label="Lenzo Music home">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-electric to-brand shadow-lg shadow-brand/30">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
          <path d="M4 14.5c2.2-1 3.6-3.4 5.1-5.4 1.1-1.5 2.4-3 4.2-3 2.6 0 3.5 2.6 6.7 2.9" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M4 18.5c3-.4 4.6-2.4 6-4" stroke="#52C8FF" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-extrabold leading-tight tracking-tight text-ink">
            Lenzo<span className="text-gradient"> Music</span>
          </span>
          <span className="block truncate text-[10px] font-medium uppercase tracking-[0.16em] text-faint">Your sound. Your wave.</span>
        </span>
      )}
    </Link>
  );
}

const NAV_MAIN = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/explore", label: "Explore", icon: Activity },
  { href: "/radio", label: "Radio", icon: Radio },
];

const NAV_LIBRARY = [
  { href: "/library", label: "Your Library", icon: Library },
  { href: "/liked", label: "Liked Songs", icon: Heart },
  { href: "/recently-played", label: "Recently Played", icon: Clock3 },
  { href: "/downloads", label: "Downloads", icon: Download },
];

export default function Sidebar({ collapsed }: SidebarProps) {
  const pathname = usePathname();
  const user = useSession((s) => s.user);
  const app = useSession((s) => s.app);
  const likedCount = useSession((s) => s.library.likedTracks.length);
  const queue = usePlayerStore((s) => s.queue.length);

  const Item = ({ href, label, icon: Icon, badge }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(href));
    return (
      <Link
        href={href}
        title={label}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150 ${
          active ? "bg-white/8 text-ink" : "text-muted hover:bg-white/4 hover:text-ink"
        } ${collapsed ? "justify-center px-0" : ""}`}
      >
        <Icon className={`size-5 shrink-0 ${active ? "text-cyan" : ""}`} />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {!collapsed && badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-brand/25 px-1.5 py-0.5 text-[10px] font-bold text-cyan">{badge}</span>
        )}
      </Link>
    );
  };

  return (
    <nav
      className={`scrollbar-thin hidden h-full shrink-0 flex-col gap-5 overflow-y-auto border-r border-hairline bg-sidebar px-3 py-5 transition-[width] duration-200 md:flex ${
        collapsed ? "w-[76px]" : "w-[248px]"
      }`}
      aria-label="Main navigation"
    >
      <div className={collapsed ? "flex justify-center" : ""}>
        <Logo compact={collapsed} />
      </div>

      <div className="flex flex-col gap-1">
        {NAV_MAIN.map((item) => (
          <Item key={item.href} {...item} />
        ))}
      </div>

      <div className="h-px bg-hairline" />

      <div className="flex flex-col gap-1">
        {NAV_LIBRARY.map((item) => (
          <Item key={item.href} {...item} badge={item.href === "/liked" ? likedCount : undefined} />
        ))}
        <Item href="/queue" label="Queue" icon={ListIcon} badge={queue} />
      </div>

      <div className="h-px bg-hairline" />

      <div className="flex flex-col gap-1">
        {app?.features.find((f) => f.key === "podcasts")?.enabled !== false && (
          <Item href="/podcasts" label="Podcasts" icon={Podcast} />
        )}
        <Item href="/lyrics" label="Lyrics" icon={Mic2} />
      </div>

      <div className="mt-auto flex flex-col gap-1">
        {user ? (
          <Link
            href="/profile"
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-white/6 ${collapsed ? "justify-center px-0" : ""}`}
          >
            {user.avatar ? (
              <img src={user.avatar} alt="" className="size-8 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-electric to-brand text-xs font-bold text-white">
                {user.username.charAt(0).toUpperCase()}
              </span>
            )}
            {!collapsed && <span className="min-w-0 flex-1 truncate">{user.username}</span>}
          </Link>
        ) : (
          !collapsed && (
            <div className="rounded-card surface-gradient p-3.5">
              <p className="text-sm font-bold text-ink">Join Lenzo Music</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">Keep your playlists, likes and downloads in sync.</p>
              <div className="mt-3 flex flex-col gap-1.5">
                <Link href="/signup" className="grid place-items-center rounded-pill bg-electric py-2 text-xs font-bold text-white transition hover:bg-cyan">
                  Create account
                </Link>
                <Link href="/login" className="grid place-items-center rounded-pill border border-hairline py-2 text-xs font-bold text-ink transition hover:bg-white/6">
                  Sign in
                </Link>
              </div>
            </div>
          )
        )}
      </div>
    </nav>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h12M4 12h8M4 18h8M18 10v8m4-6-4 4-4-4" />
    </svg>
  );
}
