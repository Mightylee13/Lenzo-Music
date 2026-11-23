"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, X } from "lucide-react";
import { useUi } from "@/lib/store/ui";

/* ============================================================
   SPOTIFY PLAYLIST IMPORT — paste any public Spotify playlist
   URL; the server reads it anonymously (web-player API, embed
   fallback) and stores it as a local playlist with playable
   audio resolved through the app's normal playback pipeline.
   ============================================================ */

export default function ImportSpotifyButton({ onImported }: { onImported?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setUrl("");
    setBusy(false);
  };

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { playlist?: { id: string; name: string }; importedCount?: number; error?: string }
        | null;
      if (!res.ok || !body?.playlist) throw new Error(body?.error ?? "Import failed");
      useUi.getState().showToast(`Imported ${body.importedCount ?? 0} songs from "${body.playlist.name}"`, "success");
      close();
      onImported?.();
      router.push(`/playlists/${body.playlist.id}`);
    } catch (err) {
      useUi.getState().showToast(err instanceof Error ? err.message : "Import failed", "error");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-pill border border-white/10 px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:border-electric hover:text-cyan"
      >
        <FilePlus2 className="size-4" />
        Import from Spotify
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={busy ? undefined : close}
          role="dialog"
          aria-modal="true"
          aria-label="Import a Spotify playlist"
        >
          <div
            className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-5 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">Import from Spotify</h2>
              <button type="button" aria-label="Close" onClick={close} disabled={busy} className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-muted">
              Paste the link to any public Spotify playlist. It will be added to your library with full, playable tracks.
            </p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              autoFocus
              inputMode="url"
              enterKeyHint="go"
              placeholder="https://open.spotify.com/playlist/…"
              // text-base on phones: iOS zoom-jumps the viewport on focus
              // for inputs under 16px, which yanked the layout around.
              className="w-full rounded-xl border border-white/10 bg-surface px-3.5 py-2.5 text-base text-ink outline-none placeholder:text-faint focus:border-electric sm:text-sm"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !url.trim()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-pill bg-electric px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-cyan disabled:opacity-45"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Importing…" : "Import playlist"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
