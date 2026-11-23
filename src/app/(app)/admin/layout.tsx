"use client";

import Link from "next/link";
import { Activity, Database, SlidersHorizontal, UsersRound, Waves } from "lucide-react";
import { useSession } from "@/lib/store/session";

/* ============================================================
   ADMIN SHELL — client-guarded (server routes enforce the real
   403); non-admins see a friendly locked state.
   ============================================================ */

const NAV = [
  { href: "/admin", label: "Overview", icon: Activity },
  { href: "/admin/api", label: "API & endpoints", icon: Database },
  { href: "/admin/users", label: "Users", icon: UsersRound },
  { href: "/admin/content", label: "Homepage & content", icon: Waves },
  { href: "/admin/settings", label: "App settings", icon: SlidersHorizontal },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = useSession();

  if (!session.ready)
    return (
      <div className="grid place-items-center py-32">
        <div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" aria-label="Loading" />
      </div>
    );

  if (!session.user || session.user.role !== "admin")
    return (
      <div className="mx-auto max-w-md rounded-card bg-card p-8 text-center animate-fade-in">
        <p className="text-3xl">🔒</p>
        <h1 className="mt-3 text-lg font-extrabold text-ink">Admin area</h1>
        <p className="mt-1 text-sm text-muted">This area is restricted to administrators.</p>
        <Link href="/" className="mt-5 inline-block rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">
          Back to the music
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-6 animate-fade-in lg:flex-row lg:gap-8">
      <nav className="flex shrink-0 gap-1.5 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-muted transition hover:bg-white/5 hover:text-ink"
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
