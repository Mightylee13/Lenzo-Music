"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Moon, Palette } from "lucide-react";
import { apiGet } from "@/lib/client/fetcher";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import type { UserSettings } from "@/types";

/* ============================================================
   SETTINGS — playback, audio quality, content, privacy.
   Every toggle persists through /api/settings PATCH.
   ============================================================ */

const QUALITY: { value: UserSettings["audioQuality"]; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "~96 kbps · data saver" },
  { value: "normal", label: "Normal", hint: "~160 kbps · balanced" },
  { value: "high", label: "High", hint: "~320 kbps · best from streams" },
  { value: "lossless", label: "Lossless", hint: "Premium tier · when the source provides it" },
];

const THEMES: { value: UserSettings["theme"]; label: string }[] = [
  { value: "midnight", label: "Midnight (default)" },
  { value: "ocean", label: "Ocean" },
  { value: "midnight-contrast", label: "Midnight contrast" },
];

export default function SettingsPage() {
  const session = useSession();
  const router = useRouter();
  const ui = useUi();
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    if (!session.ready) return;
    if (!session.user) {
      router.replace("/login?next=/settings");
      return;
    }
    apiGet<{ settings: UserSettings | null }>("/api/auth/me")
      .then((me) => setSettings(me.settings))
      .catch(() => ui.showToast("Could not load your settings", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ready, session.user]);

  async function save(patch: Partial<UserSettings>) {
    if (!settings) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    try {
      await session.updateSettings(patch);
    } catch (err) {
      setSettings(settings); // roll back on failure
      ui.showToast(err instanceof Error ? err.message : "Could not save", "error");
    }
  }

  if (!settings)
    return (
      <div className="grid place-items-center py-24">
        <div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" aria-label="Loading settings" />
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 animate-fade-in">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Preferences</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink md:text-4xl">Settings</h1>
      </header>

      <section className="rounded-card bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink"><Palette className="size-4 text-cyan" /> Appearance & language</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Theme">
            <select
              value={settings.theme}
              onChange={(e) => save({ theme: e.target.value as UserSettings["theme"] })}
              className="w-56 rounded-xl border border-hairline bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-electric"
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Language">
            <select
              value={settings.language}
              onChange={(e) => save({ language: e.target.value })}
              className="w-56 rounded-xl border border-hairline bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-electric"
            >
              {["en", "en-NG", "fr", "es", "pt", "sw"].map((l) => (
                <option key={l} value={l}>{L_LANGUAGE[l] ?? l}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-card bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink"><Moon className="size-4 text-cyan" /> Audio & playback</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Audio quality" hint="Files stream at whatever the source offers — the preference guides future tuning.">
            <div className="flex flex-wrap gap-2">
              {QUALITY.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => save({ audioQuality: q.value })}
                  className={`rounded-pill border px-4 py-2 text-xs font-bold transition ${
                    settings.audioQuality === q.value ? "border-electric bg-electric/12 text-cyan" : "border-hairline text-muted hover:text-ink"
                  }`}
                  title={q.hint}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Crossfade — ${settings.crossfade}s`}>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={settings.crossfade}
              onChange={(e) => save({ crossfade: Number(e.target.value) })}
              className="w-56 accent-[#398CFF]"
            />
          </Field>
          <Toggle label="Normalize volume" checked={settings.normalizeVolume} onChange={(v) => save({ normalizeVolume: v })} />
          <Toggle label="Autoplay similar songs when the queue ends" checked={settings.autoplay} onChange={(v) => save({ autoplay: v })} />
        </div>
      </section>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Content & privacy</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Toggle label="Allow explicit content" checked={settings.explicitContent} onChange={(v) => save({ explicitContent: v })} />
          <Toggle label="Private session (search history stays local)" checked={settings.privateSession} onChange={(v) => save({ privateSession: v })} />
          <Toggle label="Data saver" checked={settings.dataSaver} onChange={(v) => save({ dataSaver: v })} />
          <Toggle label="Notifications" checked={settings.notifications} onChange={(v) => save({ notifications: v })} />
          <Toggle label="Downloads only on Wi-Fi" checked={settings.downloadWifiOnly} onChange={(v) => save({ downloadWifiOnly: v })} />
        </div>
      </section>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Account</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href="/profile" className="rounded-pill bg-white px-5 py-2.5 text-xs font-bold text-bg hover:bg-white/90">Edit profile</Link>
          <button
            type="button"
            onClick={async () => {
              await session.logout();
              router.push("/");
            }}
            className="rounded-pill border border-danger/50 px-5 py-2.5 text-xs font-bold text-danger transition hover:bg-danger/10"
          >
            Log out
          </button>
          <Link href="/admin/api" className="text-xs font-bold text-cyan hover:underline">API configuration →</Link>
        </div>
      </section>
    </div>
  );
}

const L_LANGUAGE: Record<string, string> = {
  en: "English",
  "en-NG": "English (Nigeria)",
  fr: "Français",
  es: "Español",
  pt: "Português",
  sw: "Kiswahili",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 text-left">
      <span className="text-sm text-ink">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-electric" : "bg-white/12"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[1.375rem]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
