"use client";

import { create } from "zustand";

/* ============================================================
   UI STORE — shell chrome state that must survive navigation
   (collapsed panels) plus transient overlays.
   ============================================================ */

interface UiState {
  sidebarCollapsed: boolean;
  rightPanelVisible: boolean;
  mobileSheet: { kind: "track" | "playlist" | "none"; trackId?: string } | null;
  toast: { message: string; tone: "info" | "error" | "success" } | null;

  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  openTrackSheet: (trackId: string) => void;
  closeSheet: () => void;
  showToast: (message: string, tone?: "info" | "error" | "success") => void;
}

export const useUi = create<UiState>((set, get) => ({
  sidebarCollapsed: false,
  rightPanelVisible: true,
  mobileSheet: null,
  toast: null,

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  toggleRightPanel: () => set({ rightPanelVisible: !get().rightPanelVisible }),
  openTrackSheet: (trackId) => set({ mobileSheet: { kind: "track", trackId } }),
  closeSheet: () => set({ mobileSheet: null }),
  showToast: (message, tone = "info") => {
    set({ toast: { message, tone } });
    setTimeout(() => {
      if (get().toast?.message === message) set({ toast: null });
    }, 3200);
  },
}));
