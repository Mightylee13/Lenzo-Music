"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  HardDrive,
  Heart,
  ListMusic,
  LogOut,
  Pencil,
  Play,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { useApi } from "@/lib/client/hooks";
import { clearAudioCache, formatBytes, getAudioCacheStats, hasCachedAudio } from "@/lib/client/audioCache";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { usePlayerStore } from "@/lib/store/player";
import type { Playlist, Track } from "@/types";

const MAX_AVATAR_BYTES = 300_000;

type Tab = "general" | "playlists" | "artists" | "downloads";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "general", label: "General" },
  { id: "playlists", label: "Playlists" },
  { id: "artists", label: "Artists" },
  { id: "downloads", label: "Downloads" },
];

export default function ProfilePage() {
  const session = useSession();
  const router = useRouter();
  const ui = useUi();
  const playlistsApi = useApi<{ mine: Playlist[] }>("/api/playlists");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("general");
  const [storage, setStorage] = useState({ songs: 0, bytes: 0 });
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!session.ready) return;
    if (!session.user) router.replace("/login?next=/profile");
    else {
      setUsername(session.user.username);
      setBio(session.user.bio ?? "");
    }
  }, [session.ready, session.user, router]);

  const refreshStorage = useCallback(() => {
    void getAudioCacheStats().then(setStorage);
  }, []);

  useEffect(refreshStorage, [refreshStorage]);

  if (!session.ready || !session.user)
    return (
      <div className="grid place-items-center py-24">
        {!session.ready && <div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" />}
      </div>
    );

  const user = session.user;
  const playlists = playlistsApi.data?.mine ?? [];
  const recent = session.library.recentlyPlayed.slice(0, 12);
  const followed = session.library.followedArtists;
  const downloads = session.library.downloads;
  const totalPlaylistTracks = playlists.reduce((n, p) => n + p.tracks.length, 0);

  const stats = [
    { label: "Liked songs", value: session.library.likedTracks.length, icon: <Heart className="size-4" />, href: "/liked" },
    { label: "Playlists", value: playlists.length, icon: <ListMusic className="size-4" />, href: "/playlists" },
    { label: "Followed artists", value: followed.length, icon: <UserRound className="size-4" />, href: "/library" },
    { label: "Downloads", value: downloads.length, icon: <Download className="size-4" />, href: "/downloads" },
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

      {/* Spotify-style section tabs */}
      <nav className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-pill px-4 py-2 text-xs font-bold transition ${
              tab === t.id ? "bg-ink text-bg" : "bg-card text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "general" && (
        <div className="flex flex-col gap-6">
          {/* Device storage — cache lives on THIS device only */}
          <section className="rounded-card bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-electric/15 text-cyan">
                  <HardDrive className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-ink">Songs on this device</h2>
                  <p className="text-xs text-muted">
                    {storage.songs} song{storage.songs === 1 ? "" : "s"} cached · {formatBytes(storage.bytes)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">Stored only on your phone — nothing is uploaded.</p>
                </div>
              </div>
              <button
                type="button"
                disabled={clearing || storage.songs === 0}
                onClick={async () => {
                  setClearing(true);
                  try {
                    const removed = await clearAudioCache();
                    ui.showToast(removed > 0 ? `Cleared ${removed} song${removed === 1 ? "" : "s"} from this device` : "Nothing to clear", "success");
                  } catch {
                    ui.showToast("Could not clear the cache", "error");
                  } finally {
                    setClearing(false);
                    refreshStorage();
                  }
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-pill border border-danger/50 px-3.5 py-2 text-xs font-bold text-danger transition hover:bg-danger/10 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" /> {clearing ? "Clearing…" : "Clear cache"}
              </button>
            </div>
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
                <button type="button" onClick={() => setTab("playlists")} className="text-xs font-bold text-muted hover:text-cyan">
                  See all
                </button>
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
        </div>
      )}

      {tab === "playlists" && (
        <section className="flex flex-col gap-1">
          {playlists.length === 0 && (
            <EmptyTab
              icon={<ListMusic className="size-5" />}
              title="No playlists yet"
              description="Create one from any song's menu, or import from Spotify."
              href="/playlists"
              cta="Go to playlists"
            />
          )}
          {playlists.map((p) => (
            <Link
              key={p.id}
              href={`/playlists/${p.id}`}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/6"
            >
              <Artwork src={p.artwork} seed={p.id} label={p.name} alt={p.name} className="size-12 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{p.name}</p>
                <p className="truncate text-xs text-muted">
                  Playlist · {p.tracks.length} song{p.tracks.length === 1 ? "" : "s"}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-faint" />
            </Link>
          ))}
        </section>
      )}

      {tab === "artists" && (
        <section className="flex flex-col gap-1">
          {followed.length === 0 && (
            <EmptyTab
              icon={<UserRound className="size-5" />}
              title="No followed artists"
              description="Follow artists you love and they will show up here."
              href="/search"
              cta="Find artists"
            />
          )}
          {followed.map((a) => (
            <Link
              key={a.id}
              href={`/artists/${a.id}`}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/6"
            >
              <Artwork src={a.image} seed={a.id} label={a.name} alt={a.name} className="size-12 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{a.name}</p>
                <p className="truncate text-xs text-muted">Artist{a.verified ? " · Verified" : ""}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-faint" />
            </Link>
          ))}
        </section>
      )}

      {tab === "downloads" && (
        <DownloadsTab
          tracks={downloads}
          onRefresh={refreshStorage}
        />
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

function DownloadsTab({ tracks, onRefresh }: { tracks: Track[]; onRefresh: () => void }) {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.all(
      tracks.map(async (t) => ({ id: t.id, ok: await hasCachedAudio(t.id) })),
    ).then((pairs) => {
      if (!alive) return;
      setSaved(new Set(pairs.filter((p) => p.ok).map((p) => p.id)));
    });
    return () => {
      alive = false;
    };
  }, [tracks]);

  if (tracks.length === 0)
    return (
      <EmptyTab
        icon={<Download className="size-5" />}
        title="No downloads"
        description="Tap the download icon on any song to keep it playable offline."
        href="/downloads"
        cta="Open downloads"
      />
    );

  return (
    <section className="flex flex-col gap-1">
      {tracks.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => usePlayerStore.getState().playQueue(tracks, tracks.indexOf(t))}
          className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/6"
        >
          <Artwork src={t.artwork} seed={t.id} label={t.title} alt={t.title} className="size-12 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">{t.title}</p>
            <p className="truncate text-xs text-muted">{t.artist}</p>
          </div>
          {saved.has(t.id) ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-cyan">
              <CheckCircle2 className="size-3.5" /> On device
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-faint">Not cached</span>
          )}
        </button>
      ))}
      <p className="px-2 pt-2 text-[11px] text-faint">
        "On device" means the full audio is stored on this phone and plays instantly, even offline. Clear it from the General tab.
      </p>
      <button type="button" onClick={onRefresh} className="hidden" aria-hidden />
    </section>
  );
}

function EmptyTab({
  icon,
  title,
  description,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card bg-card px-6 py-10 text-center">
      <span className="text-cyan">{icon}</span>
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="max-w-xs text-xs text-muted">{description}</p>
      <Link href={href} className="mt-2 rounded-pill bg-electric px-4 py-2 text-xs font-bold text-white transition hover:bg-cyan">
        {cta}
      </Link>
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
