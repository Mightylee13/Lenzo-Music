"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Clock3, Download, Heart, ListMusic, LogOut, Pencil, Play, ShieldCheck, UserRound } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { useApi } from "@/lib/client/hooks";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { usePlayerStore } from "@/lib/store/player";
import type { Playlist, Track } from "@/types";

const MAX_AVATAR_BYTES = 300_000;

export default function ProfilePage() {
  const session = useSession();
  const router = useRouter();
  const ui = useUi();
  const playlistsApi = useApi<{ mine: Playlist[] }>("/api/playlists");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!session.ready) return;
    if (!session.user) router.replace("/login?next=/profile");
    else {
      setUsername(session.user.username);
      setBio(session.user.bio ?? "");
    }
  }, [session.ready, session.user, router]);

  if (!session.ready || !session.user)
    return (
      <div className="grid place-items-center py-24">
        {!session.ready && <div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" />}
      </div>
    );

  const user = session.user;
  const playlists = playlistsApi.data?.mine ?? [];
  const recent = session.library.recentlyPlayed.slice(0, 12);
  const totalPlaylistTracks = playlists.reduce((n, p) => n + p.tracks.length, 0);

  const stats = [
    { label: "Liked songs", value: session.library.likedTracks.length, icon: <Heart className="size-4" />, href: "/liked" },
    { label: "Playlists", value: playlists.length, icon: <ListMusic className="size-4" />, href: "/playlists" },
    { label: "Followed artists", value: session.library.followedArtists.length, icon: <UserRound className="size-4" />, href: "/library" },
    { label: "Downloads", value: session.library.downloads.length, icon: <Download className="size-4" />, href: "/downloads" },
  ];

  async function onAvatarPicked(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      ui.showToast("Pick an image under 300 KB (or paste a URL instead)", "error");
      return;
    }
    try {
      await session.updateProfile({ avatar: await fileToDataUrl(file) });
      ui.showToast("Avatar updated", "success");
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Upload failed", "error");
    }
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-card bg-gradient-to-b from-electric/25 via-card to-card p-5 md:p-7">
        <div className="flex flex-col items-center gap-4 text-center md:flex-row md:items-end md:text-left">
          <div className="relative shrink-0">
            <Artwork
              src={user.avatar}
              seed={user.id}
              label={user.username}
              alt={user.username}
              className="size-28 rounded-full object-cover shadow-2xl shadow-black/50 ring-4 ring-white/10 md:size-36"
              loading="eager"
            />
            <label
              className="absolute -bottom-1 -right-1 grid size-9 cursor-pointer place-items-center rounded-full bg-electric text-white shadow-lg transition hover:bg-cyan"
              title="Upload a new avatar"
            >
              <Camera className="size-4" />
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onAvatarPicked(e.target.files?.[0])} />
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Profile</p>
            <div className="mt-0.5 flex items-center justify-center gap-2 md:justify-start">
              <h1 className="truncate text-3xl font-extrabold tracking-tight text-ink md:text-5xl">{user.username}</h1>
              {user.role === "admin" && (
                <Link href="/admin" className="flex shrink-0 items-center gap-1 rounded-pill bg-electric/15 px-2.5 py-1 text-[10px] font-bold text-cyan">
                  <ShieldCheck className="size-3" /> Admin
                </Link>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {user.email} · member since {new Date(user.createdAt).toLocaleDateString()}
              {playlists.length > 0 && <> · {totalPlaylistTracks} songs in playlists</>}
            </p>
            {user.bio && <p className="mt-2 max-w-xl text-sm text-muted md:ml-0">{user.bio}</p>}
            <div className="mt-3 flex items-center justify-center gap-2 md:justify-start">
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                className="flex items-center gap-1.5 rounded-pill border border-hairline px-4 py-2 text-xs font-bold text-muted transition hover:text-ink"
              >
                <Pencil className="size-3" /> {editing ? "Close editor" : "Edit profile"}
              </button>
              <Link href="/settings" className="rounded-pill border border-hairline px-4 py-2 text-xs font-bold text-muted transition hover:text-ink">
                Preferences
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Edit profile (inline, under the hero) */}
      {editing && (
        <section className="rounded-card bg-card p-5">
          <h2 className="text-sm font-bold text-ink">Your public profile</h2>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none focus:border-electric"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Bio (up to 500 characters)</span>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Tell listeners who you are..."
                className="w-full resize-none rounded-xl border border-hairline bg-bg px-4 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric"
              />
            </label>
            <div>
              <button
                type="button"
                disabled={saving || username.trim().length < 3}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await session.updateProfile({ username: username.trim(), bio });
                    ui.showToast("Profile saved", "success");
                  } catch (err) {
                    ui.showToast(err instanceof Error ? err.message : "Save failed", "error");
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white transition hover:bg-cyan disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="flex flex-col items-center gap-1 rounded-card bg-card px-3 py-4 transition hover:bg-white/6 md:items-start">
            <span className="text-cyan">{s.icon}</span>
            <span className="text-xl font-extrabold text-ink">{s.value}</span>
            <span className="text-[11px] text-muted">{s.label}</span>
          </Link>
        ))}
      </section>

      {/* Jump back in */}
      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Clock3 className="size-4 text-cyan" /> Jump back in
            </h2>
            <Link href="/recently-played" className="text-xs font-bold text-muted hover:text-cyan">
              See all
            </Link>
          </div>
          <div className="hide-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
            {recent.map((t: Track) => (
              <button
                key={t.id}
                type="button"
                onClick={() => usePlayerStore.getState().playQueue(recent, recent.indexOf(t))}
                className="group w-28 shrink-0 snap-start text-left md:w-36"
              >
                <Artwork
                  src={t.artwork}
                  seed={t.id}
                  label={t.title}
                  alt={t.title}
                  className="aspect-square w-full rounded-xl object-cover shadow-lg shadow-black/40"
                />
                <p className="mt-1.5 truncate text-xs font-bold text-ink">{t.title}</p>
                <p className="truncate text-[11px] text-muted">{t.artist}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Your playlists */}
      {playlists.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <ListMusic className="size-4 text-cyan" /> Your playlists
            </h2>
            <Link href="/playlists" className="text-xs font-bold text-muted hover:text-cyan">
              See all
            </Link>
          </div>
          <div className="hide-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
            {playlists.slice(0, 12).map((p) => (
              <Link key={p.id} href={`/playlists/${p.id}`} className="group w-28 shrink-0 snap-start md:w-36">
                <div className="relative">
                  <Artwork
                    src={p.artwork}
                    seed={p.id}
                    label={p.name}
                    alt={p.name}
                    className="aspect-square w-full rounded-xl object-cover shadow-lg shadow-black/40"
                  />
                  <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100">
                    <Play className="size-3.5 fill-current" />
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs font-bold text-ink">{p.name}</p>
                <p className="truncate text-[11px] text-muted">{p.tracks.length} song{p.tracks.length === 1 ? "" : "s"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={async () => {
          await session.logout();
          router.push("/");
        }}
        className="mx-auto flex items-center gap-2 rounded-pill border border-danger/50 px-5 py-2.5 text-xs font-bold text-danger transition hover:bg-danger/10"
      >
        <LogOut className="size-3.5" /> Log out
      </button>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}
