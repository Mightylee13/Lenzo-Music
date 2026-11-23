"use client";

import { useEffect } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import AudioEngine from "@/components/shell/AudioEngine";
import Sidebar from "@/components/shell/Sidebar";
import BottomPlayer from "@/components/shell/BottomPlayer";
import { MiniPlayer, BottomNav } from "@/components/shell/MobileDock";
import FullPlayer from "@/components/shell/FullPlayer";
import RightPanel from "@/components/shell/RightPanel";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";

/* ============================================================
   APP SHELL — sidebar + scrolling main + right panel (desktop),
   bottom player everywhere, mini player + dock on mobile.
   Playback state survives navigation because this shell never
   unmounts.
   ============================================================ */

export default function AppShell({ children }: { children: React.ReactNode }) {
  const bootstrap = useSession((s) => s.bootstrap);
  const ready = useSession((s) => s.ready);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <AudioEngine />

      <div className="flex min-h-0 flex-1">
        <SidebarBridge />

        {/* Main column */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Scroll container */}
          <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-40 pt-4 md:px-6 md:pb-8 md:pt-6">{children}</div>
          </main>

          {/* Desktop right-panel toggle floats at the panel edge */}
          <RightPanelToggle />
        </div>

        <RightPanelBridge />
      </div>

      <BottomPlayer />
      <MiniPlayer />
      <BottomNav />
      <FullPlayer />
      <Toast />
      {!ready && <BootVeil />}
    </div>
  );
}

/* Wires zustand state into plain props so the shell re-renders
   only when the visible pieces change. */
function SidebarBridge() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  return <Sidebar collapsed={collapsed} />;
}

function RightPanelBridge() {
  const visible = useUi((s) => s.rightPanelVisible);
  return visible ? <RightPanel /> : null;
}

function RightPanelToggle() {
  const visible = useUi((s) => s.rightPanelVisible);
  return (
    <button
      type="button"
      aria-label="Toggle now-playing panel"
      onClick={() => useUi.getState().toggleRightPanel()}
      className="absolute right-4 top-4 z-30 hidden size-9 place-items-center rounded-full glass text-muted shadow-lg hover:text-ink xl:grid"
    >
      {visible ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
    </button>
  );
}

/** Tiny splash until the session check resolves — prevents auth flicker. */
function BootVeil() {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-bg" aria-hidden>
      <span className="size-8 animate-spin rounded-full border-2 border-brand border-b-transparent" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-[140px] left-1/2 z-[90] -translate-x-1/2 rounded-pill px-4 py-2.5 text-sm font-semibold shadow-xl shadow-black/50 md:bottom-24 ${
        toast.tone === "error"
          ? "bg-danger text-white"
          : toast.tone === "success"
            ? "bg-success text-bg"
            : "glass-strong border border-white/10 text-ink"
      }`}
    >
      {toast.message}
    </div>
  );
}
