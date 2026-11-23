"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Heart, ListMusic, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Artwork from "@/components/ui/Artwork";
import { apiSend } from "@/lib/client/fetcher";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";

const MAX_AVATAR_BYTES = 300_000;

export default function ProfilePage() {
  const session = useSession();
  const router = useRouter();
  const ui = useUi();
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

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
  const stats = [
    { label: "Liked songs", value: session.library.likedTracks.length, icon: <Heart className="size-4" />, href: "/liked" },
    { label: "Playlists", value: null as number | null, icon: <ListMusic className="size-4" />, href: "/playlists" },
    { label: "Followed artists", value: session.library.followedArtists.length, icon: <UserRound className="size-4" />, href: "/library" },
    { label: "Downloads", value: session.library.downloads.length, icon: <Camera className="size-4" />, href: "/downloads" },
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 animate-fade-in">
      <header className="flex flex-col items-center gap-4 text-center md:flex-row md:text-left">
        <div className="relative">
          <Artwork
            src={user.avatar}
            seed={user.id}
            label={user.username}
            alt={user.username}
            className="size-28 rounded-full object-cover shadow-2xl shadow-black/50 md:size-32"
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
          <div className="flex items-center justify-center gap-2 md:justify-start">
            <h1 className="text-3xl font-extrabold tracking-tight text-ink">{user.username}</h1>
            {user.role === "admin" && (
              <Link href="/admin" className="flex items-center gap-1 rounded-pill bg-electric/12 px-2.5 py-1 text-[10px] font-bold text-cyan">
                <ShieldCheck className="size-3" /> Admin
              </Link>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{user.email} · member since {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => {
          const body = (
            <>
              <span className="text-cyan">{s.icon}</span>
              <span className="text-xl font-extrabold text-ink">{s.value}</span>
              <span className="text-[11px] text-muted">{s.label}</span>
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="flex flex-col items-center gap-1 rounded-card bg-card px-3 py-4 transition hover:bg-white/6 md:items-start">
              {body}
            </Link>
          ) : (
            <div key={s.label} className="flex flex-col items-center gap-1 rounded-card bg-card px-3 py-4 opacity-60 md:items-start">
              {body}
            </div>
          );
        })}
      </section>

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
          <div className="flex gap-2">
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
            <Link href="/settings" className="rounded-pill border border-hairline px-5 py-2.5 text-xs font-bold text-muted transition hover:text-ink">
              Preferences
            </Link>
          </div>
        </div>
      </section>

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
