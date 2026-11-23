"use client";

import Link from "next/link";
import Artwork from "@/components/ui/Artwork";

/* ============================================================
   AUTH SHELL — centered card, brand mark, no app chrome.
   ============================================================ */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 size-[560px] -translate-x-1/2 rounded-full opacity-25 blur-[120px]"
        style={{ background: "radial-gradient(circle,#398cff,transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <Artwork seed="lenzo-music-logo" label="Lenzo Music" alt="Lenzo Music" className="size-11 rounded-xl" loading="eager" />
          <span className="text-lg font-extrabold tracking-tight text-ink">
            Lenzo<span className="text-cyan">Music</span>
          </span>
        </Link>
        <div className="rounded-card bg-card/80 p-6 shadow-2xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-sm">{children}</div>
        <p className="mt-6 text-center text-[11px] text-faint">Your sound. Your wave.</p>
      </div>
    </div>
  );
}
