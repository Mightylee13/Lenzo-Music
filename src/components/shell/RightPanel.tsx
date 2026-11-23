"use client";

import Link from "next/link";
import { ChevronDown, ListMusic, Mic2, Radio, User } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { LyricsView, QueueView } from "@/components/shell/LyricsQueue";
import { usePlayerStore } from "@/lib/store/player";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";

/* ============================================================
   RIGHT PANEL — desktop now-playing dock: artwork, artist follow,
   lyrics and queue. Collapsible. The tab comes from the player
   store so the player-bar Lyrics/Queue buttons drive it too.
   ============================================================ */

export default function RightPanel() {
  const tab = usePlayerStore((s) => s.panelTab);
  const setTab = usePlayerStore((s) => s.setPanelTab);
  const current = usePlayerStore((s) => s.current);
  const resolved = usePlayerStore((s) => s.resolved);
  const session = useSession();
  const store = usePlayerStore.getState();

  return (
    <aside className="relative hidden h-full w-[340px] shrink-0 flex-col border-l border-hairline bg-sidebar/60 xl:flex" aria-label="Now playing panel">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-3">
        {(
          [
            { key: "now", label: "Playing", icon: Radio },
            { key: "lyrics", label: "Lyrics", icon: Mic2 },
            { key: "queue", label: "Queue", icon: ListMusic },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
              tab === key ? "bg-white/10 text-ink" : "text-muted hover:bg-white/5 hover:text-ink"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Collapse panel"
          onClick={() => useUi.getState().toggleRightPanel()}
          className="ml-auto grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-ink"
        >
          <ChevronDown className="size-4 -rotate-90" />
        </button>
      </div>

      {/* NowPlaying tab */}
      {tab === "now" && (
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5">
          {current ? (
            <>
              <Artwork
                src={resolved?.artwork ?? current.artwork}
                seed={current.id}
                label={current.title}
                alt=""
                className="aspect-square w-full rounded-xl object-cover shadow-2xl shadow-black/50"
              />
              <p className="mt-4 truncate text-base font-extrabold tracking-tight text-ink">{current.title}</p>
              <p className="mt-0.5 truncate text-sm text-muted">{current.artist}</p>
              {current.album && <p className="mt-1 truncate text-xs text-faint">From · {current.album}</p>}

              {resolved && (
                <p className="mt-3 text-[11px] text-faint">
                  Audio via <span className="font-semibold text-cyan">{resolved.provider}</span>
                  {resolved.quality ? ` · ${resolved.quality}` : ""}
                </p>
              )}

              {session.user && current.artistId && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await session.toggleFollowArtist({
                        id: current.artistId!,
                        name: current.artist.split(",")[0],
                        image: current.artwork,
                        source: current.source,
                      });
                      useUi.getState().showToast(session.isFollowingArtist(current.artistId!) ? "Unfollowed" : "Following", "success");
                    } catch (err) {
                      useUi.getState().showToast(err instanceof Error ? err.message : "Failed", "error");
                    }
                  }}
                  className={`mt-4 flex w-full items-center justify-center gap-2 rounded-pill border py-2.5 text-xs font-bold transition-colors ${
                    session.isFollowingArtist(current.artistId)
                      ? "border-hairline text-muted hover:text-ink"
                      : "border-electric/60 bg-electric/15 text-cyan hover:bg-electric/25"
                  }`}
                >
                  <User className="size-3.5" />
                  {session.isFollowingArtist(current.artistId) ? "Following" : "Follow artist"}
                </button>
              )}

              {current.artistId && (
                <Link
                  href={`/artists/${current.artistId}`}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-pill border border-hairline py-2.5 text-xs font-bold text-ink transition-colors hover:bg-white/6"
                >
                  Go to artist page
                </Link>
              )}

              <Link
                href="/lyrics"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-pill border border-hairline py-2.5 text-xs font-bold text-muted transition-colors hover:bg-white/6 hover:text-ink"
              >
                <Mic2 className="size-3.5" />
                Open full lyrics view
              </Link>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="grid size-14 place-items-center rounded-full bg-card text-faint">
                <Radio className="size-6" />
              </div>
              <p className="text-sm font-semibold text-ink">Nothing playing</p>
              <p className="max-w-[220px] text-xs text-muted">Pick any song, album or station and it will appear here with lyrics and the queue.</p>
            </div>
          )}
        </div>
      )}

      {tab === "lyrics" && <LyricsView className="flex-1" />}
      {tab === "queue" && <QueueView standalone />}
    </aside>
  );
}
