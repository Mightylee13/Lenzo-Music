"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, HardDrive } from "lucide-react";
import TrackList from "@/components/tracks/TrackList";
import { EmptyState } from "@/components/ui/skeletons";
import { TrackCollectionHeader } from "@/app/(app)/liked/page";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { formatDuration } from "@/lib/client/fetcher";

/* ============================================================
   DOWNLOADS — saved-for-offline tracks with storage estimate.
   Downloads bookmark tracks (metadata + instant re-resolve);
   the audio itself is re-streamed, keeping this compliant.
   ============================================================ */

export default function DownloadsPage() {
  const session = useSession();
  const tracks = session.library.downloads;

  const totalSeconds = useMemo(() => tracks.reduce((acc, t) => acc + (t.duration || 210), 0), [tracks]);
  // ~128 kbps MP3 ≈ 0.96 MB per minute.
  const mbEstimate = Math.round((totalSeconds / 60) * 0.96);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <TrackCollectionHeader
        title="Downloads"
        subtitle={tracks.length ? `${tracks.length} tracks · about ${mbEstimate} MB` : "Save songs to jump back in instantly"}
        tracks={tracks}
        accent="bg-gradient-to-br from-cyan to-brand"
        icon={<ArrowDownToLine className="size-14" />}
      />

      {!session.user ? (
        <EmptyState
          icon={<ArrowDownToLine className="size-5" />}
          title="Not signed in"
          description="Downloads are tied to your account."
          action={<Link href="/login" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Sign in</Link>}
        />
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<HardDrive className="size-5" />}
          title="No downloads yet"
          description={'Open any song\'s "..." menu and choose "Save to downloads".'}
          action={<Link href="/" className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white hover:bg-cyan">Find music</Link>}
        />
      ) : (
        <>
          <div className="flex items-center gap-2.5 rounded-card bg-card/70 px-4 py-3">
            <HardDrive className="size-4 text-cyan" />
            <p className="text-xs text-muted">
              Local storage estimate: <span className="font-bold text-ink">{mbEstimate} MB</span> · {Math.floor(totalSeconds / 3600)}h {Math.round((totalSeconds % 3600) / 60)}m of audio
            </p>
          </div>
          <TrackList tracks={tracks} showIndex />
          <button
            type="button"
            onClick={async () => {
              for (const t of [...tracks]) {
                await session.toggleDownload(t).catch(() => undefined);
              }
              useUi.getState().showToast("All downloads removed", "success");
            }}
            className="w-fit rounded-pill border border-hairline px-4 py-2 text-xs font-bold text-muted transition hover:border-danger hover:text-danger"
          >
            Remove all downloads
          </button>
          <p className="text-[11px] text-faint">
            Audio is streamed through the server on demand; downloads re-resolve with priority
            {tracks[0] ? ` (${formatDuration(totalSeconds)} total)` : ""}.
          </p>
        </>
      )}
    </div>
  );
}
