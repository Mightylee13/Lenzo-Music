"use client";

import { useState } from "react";
import Link from "next/link";
import { ListPlus, ListMusic } from "lucide-react";
import MediaCard from "@/components/ui/MediaCard";
import Section from "@/components/ui/Section";
import { EmptyState, ErrorState, CardSkeleton } from "@/components/ui/skeletons";
import { useApi } from "@/lib/client/hooks";
import { apiSend } from "@/lib/client/fetcher";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import type { Playlist } from "@/types";

export default function PlaylistsPage() {
  const { data, loading, error, reload } = useApi<{ mine: Playlist[]; discover: Playlist[] }>("/api/playlists");
  const session = useSession();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  async function create() {
    try {
      const res = await apiSend<{ playlist: Playlist }>("/api/playlists", "POST", {
        name: name.trim() || undefined,
        public: isPublic,
      });
      useUi.getState().showToast(`Created "${res.playlist.name}"`, "success");
      setCreating(false);
      setName("");
      reload();
    } catch (err) {
      useUi.getState().showToast(err instanceof Error ? err.message : "Could not create playlist", "error");
    }
  }

  const renderGrid = (playlists: Playlist[]) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {playlists.map((pl) => (
        <MediaCard
          key={pl.id}
          artwork={pl.artwork}
          seed={pl.id}
          label={pl.name}
          title={pl.name}
          subtitle={`${pl.tracks.length} songs · ${pl.owner}`}
          href={`/playlists/${pl.id}`}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-7 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Collections</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-4xl">Your Playlists</h1>
        </div>
        {session.user && (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex items-center gap-2 rounded-pill bg-electric px-5 py-2.5 text-sm font-bold text-white transition hover:bg-cyan"
          >
            <ListPlus className="size-4" /> New playlist
          </button>
        )}
      </div>

      {creating && (
        <div className="flex max-w-lg flex-col gap-3 rounded-card bg-card p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`My Playlist #${(data?.mine.length ?? 0) + 1}`}
            className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-[#398CFF]" />
            Public — anyone browsing Lenzo Music can find it
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={create} className="rounded-pill bg-electric px-5 py-2 text-xs font-bold text-white hover:bg-cyan">
              Create
            </button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-pill border border-hairline px-5 py-2 text-xs font-bold text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <CardSkeleton count={5} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          {data.mine.length === 0 ? (
            session.user ? (
              <EmptyState
                icon={<ListMusic className="size-5" />}
                title="No playlists yet"
                description="Hit “New playlist” and start stacking songs."
              />
            ) : (
              <EmptyState
                icon={<ListMusic className="size-5" />}
                title="Sign in to build playlists"
                action={<Link href="/login" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Sign in</Link>}
              />
            )
          ) : (
            renderGrid(data.mine)
          )}

          {data.discover.length > 0 && (
            <Section title="Public playlists from other listeners">
              {renderGrid(data.discover)}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
