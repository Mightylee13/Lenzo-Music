"use client";

import { create } from "zustand";
import { apiGet, apiSend } from "@/lib/client/fetcher";
import type { Album, Artist, FeatureFlag, PublicUser, Track } from "@/types";

/* ============================================================
   SESSION STORE — the signed-in user + their library, mirrored
   on the client so the UI can update optimistically and hit
   /api/library PATCH in the background.
   ============================================================ */

interface MeResponse {
  user: PublicUser | null;
  app: { appName: string; tagline: string; features: FeatureFlag[] };
}

interface FullUser extends PublicUser {
  likedTracks: Track[];
  savedAlbums: Album[];
  followedArtists: Artist[];
  followedPodcasts: string[];
  recentlyPlayed: Track[];
  downloads: Track[];
}

interface SessionState {
  ready: boolean;
  user: PublicUser | null;
  app: MeResponse["app"] | null;
  library: {
    likedTracks: Track[];
    savedAlbums: Album[];
    followedArtists: Artist[];
    followedPodcasts: string[];
    recentlyPlayed: Track[];
    downloads: Track[];
  };

  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: { username?: string; avatar?: string; bio?: string }) => Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;

  isLiked: (trackId: string) => boolean;
  toggleLike: (track: Track) => Promise<void>;
  isSavedAlbum: (albumId: string) => boolean;
  toggleSaveAlbum: (album: Album) => Promise<void>;
  isFollowingArtist: (artistId: string) => boolean;
  toggleFollowArtist: (artist: Artist) => Promise<void>;
  isFollowingPodcast: (podcastId: string) => boolean;
  toggleFollowPodcast: (podcastId: string) => Promise<void>;
  pushRecent: (track: Track) => void;
  isDownloaded: (trackId: string) => boolean;
  toggleDownload: (track: Track) => Promise<void>;
}

function feature(this_: SessionState | null, key: string): boolean {
  return this_?.app?.features.find((f) => f.key === key)?.enabled ?? true;
}

let lastRecentPushId = "";

export const useSession = create<SessionState>((set, get) => ({  ready: false,
  user: null,
  app: null,
  library: {
    likedTracks: [],
    savedAlbums: [],
    followedArtists: [],
    followedPodcasts: [],
    recentlyPlayed: [],
    downloads: [],
  },

  bootstrap: async () => {
    try {
      const me = await apiGet<MeResponse>("/api/auth/me");
      set({ user: me.user, app: me.app });
      if (me.user) {
        const library = await apiGet<FullUser>("/api/library").catch(() => null);
        if (library) {
          set((s) => ({
            library: {
              likedTracks: library.likedTracks ?? [],
              savedAlbums: library.savedAlbums ?? [],
              followedArtists: library.followedArtists ?? [],
              followedPodcasts: library.followedPodcasts ?? [],
              recentlyPlayed: library.recentlyPlayed ?? [],
              downloads: library.downloads ?? [],
            },
          }));
        }
      }
    } finally {
      set({ ready: true });
    }
  },

  login: async (identifier, password) => {
    const { user } = await apiSend<{ user: PublicUser }>("/api/auth/login", "POST", { identifier, password });
    set({ user });
    await get().bootstrap();
  },

  register: async (username, email, password) => {
    const { user } = await apiSend<{ user: PublicUser }>("/api/auth/register", "POST", { username, email, password });
    set({ user });
    await get().bootstrap();
  },

  logout: async () => {
    await apiSend("/api/auth/logout", "POST").catch(() => undefined);
    set({
      user: null,
      library: {
        likedTracks: [],
        savedAlbums: [],
        followedArtists: [],
        followedPodcasts: [],
        recentlyPlayed: [],
        downloads: [],
      },
    });
  },

  updateProfile: async (patch) => {
    const { user } = await apiSend<{ user: PublicUser }>("/api/settings", "PATCH", patch);
    set({ user });
  },

  updateSettings: async (patch) => {
    const { user } = await apiSend<{ user: PublicUser }>("/api/settings", "PATCH", { settings: patch });
    set({ user });
  },

  isLiked: (trackId) => feature(get(), "social") && get().library.likedTracks.some((t) => t.id === trackId),

  toggleLike: async (track) => {
    if (!get().user) throw new Error("Sign in to save songs");
    const add = !get().isLiked(track.id);
    set((s) => ({
      library: {
        ...s.library,
        likedTracks: add
          ? [track, ...s.library.likedTracks]
          : s.library.likedTracks.filter((t) => t.id !== track.id),
      },
    }));
    try {
      await apiSend("/api/library", "PATCH", { op: add ? "like" : "unlike", track });
    } catch (err) {
      // Revert on failure.
      set((s) => ({
        library: {
          ...s.library,
          likedTracks: add
            ? s.library.likedTracks.filter((t) => t.id !== track.id)
            : [track, ...s.library.likedTracks],
        },
      }));
      throw err;
    }
  },

  isSavedAlbum: (albumId) => get().library.savedAlbums.some((a) => a.id === albumId),

  toggleSaveAlbum: async (album) => {
    if (!get().user) throw new Error("Sign in to save albums");
    const add = !get().isSavedAlbum(album.id);
    set((s) => ({
      library: {
        ...s.library,
        savedAlbums: add ? [album, ...s.library.savedAlbums] : s.library.savedAlbums.filter((a) => a.id !== album.id),
      },
    }));
    try {
      await apiSend("/api/library", "PATCH", { op: add ? "save-album" : "unsave-album", album });
    } catch (err) {
      set((s) => ({
        library: {
          ...s.library,
          savedAlbums: add
            ? s.library.savedAlbums.filter((a) => a.id !== album.id)
            : [album, ...s.library.savedAlbums],
        },
      }));
      throw err;
    }
  },

  isFollowingArtist: (artistId) => get().library.followedArtists.some((a) => a.id === artistId),

  toggleFollowArtist: async (artist) => {
    if (!get().user) throw new Error("Sign in to follow artists");
    const add = !get().isFollowingArtist(artist.id);
    set((s) => ({
      library: {
        ...s.library,
        followedArtists: add
          ? [artist, ...s.library.followedArtists]
          : s.library.followedArtists.filter((a) => a.id !== artist.id),
      },
    }));
    try {
      await apiSend("/api/library", "PATCH", { op: add ? "follow-artist" : "unfollow-artist", artist });
    } catch (err) {
      set((s) => ({
        library: {
          ...s.library,
          followedArtists: add
            ? s.library.followedArtists.filter((a) => a.id !== artist.id)
            : [artist, ...s.library.followedArtists],
        },
      }));
      throw err;
    }
  },

  isFollowingPodcast: (podcastId) => get().library.followedPodcasts.includes(podcastId),

  toggleFollowPodcast: async (podcastId) => {
    if (!get().user) throw new Error("Sign in to follow podcasts");
    const add = !get().isFollowingPodcast(podcastId);
    set((s) => ({
      library: {
        ...s.library,
        followedPodcasts: add
          ? [...s.library.followedPodcasts, podcastId]
          : s.library.followedPodcasts.filter((id) => id !== podcastId),
      },
    }));
    try {
      await apiSend("/api/library", "PATCH", { op: add ? "follow-podcast" : "unfollow-podcast", podcastId });
    } catch (err) {
      set((s) => ({
        library: {
          ...s.library,
          followedPodcasts: add
            ? s.library.followedPodcasts.filter((id) => id !== podcastId)
            : [...s.library.followedPodcasts, podcastId],
        },
      }));
      throw err;
    }
  },

  pushRecent: (track) => {
    // Fire-and-forget, without spamming the endpoint for the same track.
    if (!get().user || lastRecentPushId === track.id) return;
    lastRecentPushId = track.id;
    set((s) => ({
      library: {
        ...s.library,
        recentlyPlayed: [track, ...s.library.recentlyPlayed.filter((t) => t.id !== track.id)].slice(0, 200),
      },
    }));
    void apiSend("/api/library", "PATCH", { op: "recent", track }).catch(() => undefined);
  },

  isDownloaded: (trackId) => get().library.downloads.some((t) => t.id === trackId),

  toggleDownload: async (track) => {
    if (!get().user) throw new Error("Sign in to manage downloads");
    const add = !get().isDownloaded(track.id);
    set((s) => ({
      library: {
        ...s.library,
        downloads: add
          ? [track, ...s.library.downloads]
          : s.library.downloads.filter((t) => t.id !== track.id),
      },
    }));
    try {
      await apiSend("/api/library", "PATCH", { op: add ? "add-download" : "remove-download", track });
    } catch (err) {
      set((s) => ({
        library: {
          ...s.library,
          downloads: add
            ? s.library.downloads.filter((t) => t.id !== track.id)
            : [track, ...s.library.downloads],
        },
      }));
      throw err;
    }
  },
}));

export function featureEnabled(key: string): boolean {
  return useSession.getState().app?.features.find((f) => f.key === key)?.enabled ?? true;
}
