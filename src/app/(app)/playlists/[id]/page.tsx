"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, MoreVertical, Music4, Pencil, Play, Shuffle } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState, ErrorState, TrackListSkeleton } from "@/components/ui/skeletons";
import { apiSend, formatDuration } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { usePlayerStore } from "@/lib/store/player";
import { useUi } from "@/lib/store/ui";
import type { Playlist } from "@/types";

type Payload = { playlist: Playlist; isOwner: boolean };

export default function PlaylistDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, loading, error, reload } = useApi<Payload>(id ? `/api/playlists/${id}` : null);
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", public: false, collaborative: false });
  const shuffleOn = usePlayerStore((s) => s.shuffle);

  const playlist = data?.playlist;
  const isOwner = data?.isOwner ?? false;

  async function patch(op: string, body?: Record<string, unknown>) {
    try {
      await apiSend(`/api/playlists/${id}`, "PATCH", { op, patch: body });
      reload();
    } catch (err) {
      useUi.getState().showToast(err instanceof Error ? err.message : "Action failed", "error");
    }
  }

  if (loading) return <div className="animate-fade-in"><TrackListSkeleton /></div>;
  if (error)
    return (
      <div className="animate-fade-in">
        <ErrorState message={error} onRetry={reload} />
        <div className="mt-4 text-center">
          <Link href="/playlists" className="text-xs font-bold text-cyan hover:underline">Back to playlists</Link>
        </div>
      </div>
    );
  if (!playlist) return null;

  const totalSeconds = playlist.tracks.reduce((acc, t) => acc + t.duration, 0);
  const owning = isOwner;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Back */}
      <button
        type="button"
        onClick={() => (history.length > 1 ? router.back() : router.push("/playlists"))}
        aria-label="Go back"
        className="flex w-fit items-center gap-1.5 text-xs font-semibold text-muted transition hover:text-ink"
      >
        <span className="grid size-9 place-items-center rounded-full border border-hairline bg-card">
          <ChevronLeft className="size-4" />
        </span>
        Back
      </button>

      {/* Header */}
      <header className="relative flex flex-col gap-5 md:flex-row md:items-end">
        <Artwork
          src={playlist.artwork}
          seed={playlist.id}
          label={playlist.name}
          alt=""
          className="size-40 rounded-2xl object-cover shadow-2xl shadow-black/50 md:size-52"
          loading="eager"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">
            {playlist.public ? "Public playlist" : "Private playlist"} · {playlist.collaborative ? "Collaborative" : "Playlist"}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-5xl">{playlist.name}</h1>
          {playlist.description && <p className="mt-2 max-w-2xl text-sm text-muted">{playlist.description}</p>}
          <p className="mt-2 text-xs text-muted">
            Made by <span className="font-semibold text-ink">{playlist.owner}</span> · {playlist.tracks.length} songs ·{" "}
            {Math.floor(totalSeconds / 3600)}h {Math.round((totalSeconds % 3600) / 60)}m
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {playlist.tracks.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    usePlayerStore.getState().playQueue(playlist.tracks, 0)
                  }
                  className="flex items-center gap-2 rounded-pill bg-white px-6 py-3 text-sm font-bold text-bg shadow-lg transition hover:scale-[1.02]"
                >
                  <Play className="size-4 fill-current" /> Play
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Shuffle only flips the MODE (colour shows it's on).
                    // Pressing Play then starts a random song.
                    usePlayerStore.getState().toggleShuffle();
                  }}
                  className={`flex items-center gap-2 rounded-pill border px-5 py-3 text-sm font-bold transition ${
                    shuffleOn
                      ? "border-cyan/60 bg-cyan/10 text-cyan"
                      : "border-hairline text-ink hover:bg-white/6"
                  }`}
                  aria-pressed={shuffleOn}
                >
                  <Shuffle className="size-4" /> Shuffle{shuffleOn ? " on" : ""}
                </button>
              </>
            )}
            {owning && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Playlist options"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="grid size-10 place-items-center rounded-pill border border-hairline text-muted transition hover:text-ink"
                >
                  <MoreVertical className="size-4" />
                </button>
                {menuOpen && (
                  <div className="absolute left-0 top-11 z-20 w-44 overflow-hidden rounded-card bg-card py-1 shadow-2xl shadow-black/50 ring-1 ring-white/5">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-ink hover:bg-white/5"
                      onClick={() => {
                        setForm({
                          name: playlist.name,
                          description: playlist.description,
                          public: playlist.public,
                          collaborative: playlist.collaborative,
                        });
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                    >
                      <Pencil className="size-3.5" /> Edit details
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-ink hover:bg-white/5"
                      onClick={async () => {
                        setMenuOpen(false);
                        try {
                          const res = await apiSend<{ playlist: Playlist }>(`/api/playlists/${id}`, "PATCH", { op: "duplicate" });
                          useUi.getState().showToast("Playlist duplicated", "success");
                          router.push(`/playlists/${res.playlist.id}`);
                        } catch (err) {
                          useUi.getState().showToast(err instanceof Error ? err.message : "Duplicate failed", "error");
                        }
                      }}
                    >
                      <Music4 className="size-3.5" /> Make a copy
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-danger hover:bg-white/5"
                      onClick={async () => {
                        setMenuOpen(false);
                        try {
                          await apiSend(`/api/playlists/${id}`, "DELETE");
                          useUi.getState().showToast("Playlist deleted", "success");
                          router.push("/playlists");
                        } catch (err) {
                          useUi.getState().showToast(err instanceof Error ? err.message : "Delete failed", "error");
                        }
                      }}
                    >
                      Delete playlist
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Edit sheet */}
      {editing && (
        <div className="flex max-w-lg flex-col gap-3 rounded-card bg-card p-4">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Playlist name"
            className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm font-semibold text-ink outline-none focus:border-electric"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Add an optional description"
            rows={2}
            className="w-full resize-none rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} className="accent-[#398CFF]" />
            Public
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={form.collaborative} onChange={(e) => setForm({ ...form, collaborative: e.target.checked })} className="accent-[#398CFF]" />
            Collaborative
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await patch("edit", {
                  name: form.name.trim(),
                  description: form.description,
                  public: form.public,
                  collaborative: form.collaborative,
                });
                setEditing(false);
              }}
              className="rounded-pill bg-electric px-5 py-2 text-xs font-bold text-white hover:bg-cyan"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-pill border border-hairline px-5 py-2 text-xs font-bold text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      <TrackList
        tracks={playlist.tracks}
        showIndex
        showAlbum
        playlistId={playlist.id}
        onPlaylistMutated={reload}
        emptyMessage={owning ? 'Use any song\'s "..." menu → "Add to this playlist" to fill it up.' : "This playlist is waiting for its first song."}
      />
      {playlist.tracks.length > 0 && (
        <p className="text-[11px] text-faint">Total run time {formatDuration(totalSeconds)}</p>
      )}
    </div>
  );
}
