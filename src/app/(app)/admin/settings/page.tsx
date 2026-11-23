"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/ui/skeletons";
import { apiSend } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { useUi } from "@/lib/store/ui";
import type { AppSettings, FeatureFlag } from "@/types";

export default function AdminSettingsPage() {
  const { data, loading, error, reload } = useApi<{ settings: AppSettings }>("/api/admin/settings");
  const ui = useUi();
  const [form, setForm] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data.settings);
  }, [data, form]);

  async function save(patch: Partial<AppSettings>) {
    if (!form) return;
    const optimistic = { ...form, ...patch };
    setForm(optimistic);
    setSaving(true);
    try {
      const res = await apiSend<{ settings: AppSettings }>("/api/admin/settings", "PATCH", patch);
      setForm(res.settings);
      ui.showToast("Saved — reload the home page to see branding changes", "success");
    } catch (err) {
      setForm(form);
      ui.showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid place-items-center py-24"><div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" /></div>;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Instance</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">App settings</h1>
      </header>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Branding</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">App name</span>
            <input
              value={form?.appName ?? ""}
              onChange={(e) => form && setForm({ ...form, appName: e.target.value })}
              onBlur={() => form && form.appName !== data?.settings.appName && save({ appName: form.appName })}
              className={settingsInput}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Tagline</span>
            <input
              value={form?.tagline ?? ""}
              onChange={(e) => form && setForm({ ...form, tagline: e.target.value })}
              onBlur={() => form && form.tagline !== data?.settings.tagline && save({ tagline: form.tagline })}
              className={settingsInput}
            />
          </label>
        </div>
      </section>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Access</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Switch label="Registration open" description="Allow new sign-ups from /signup" checked={!!form?.registrationOpen} onChange={(v) => save({ registrationOpen: v })} />
          <Switch label="Guest mode" description="Let visitors browse and search without an account" checked={!!form?.guestMode} onChange={(v) => save({ guestMode: v })} />
          <Switch label="Maintenance mode" description="Show a maintenance banner across the app" checked={!!form?.maintenanceMode} onChange={(v) => save({ maintenanceMode: v })} />
        </div>
      </section>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Feature flags</h2>
        <div className="mt-3 flex flex-col gap-3">
          {form?.features.map((f) => (
            <FlagRow key={f.key} flag={f} onToggle={() => {
              const next = form.features.map((x) => (x.key === f.key ? { ...x, enabled: !x.enabled } : x));
              setForm({ ...form, features: next });
              save({ features: next });
            }} />
          ))}
        </div>
      </section>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Maintenance</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await apiSend("/api/admin/settings", "PATCH", { action: "clear-cache" });
                ui.showToast("Music cache cleared", "success");
              } catch (err) {
                ui.showToast(err instanceof Error ? err.message : "Failed", "error");
              }
            }}
            className="flex items-center gap-2 rounded-pill border border-hairline px-4 py-2.5 text-xs font-bold text-muted transition hover:text-ink"
          >
            <RefreshCcw className="size-3.5" /> Clear music cache
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await apiSend("/api/admin/settings", "DELETE");
                ui.showToast("API log cleared", "success");
              } catch (err) {
                ui.showToast(err instanceof Error ? err.message : "Failed", "error");
              }
            }}
            className="flex items-center gap-2 rounded-pill border border-hairline px-4 py-2.5 text-xs font-bold text-muted transition hover:border-danger hover:text-danger"
          >
            <Trash2 className="size-3.5" /> Clear API log
          </button>
        </div>
        {saving && <p className="mt-3 text-[11px] text-faint">Saving…</p>}
      </section>
    </div>
  );
}

function FlagRow({ flag, onToggle }: { flag: FeatureFlag; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={flag.enabled} onClick={onToggle} className="flex w-full items-center justify-between gap-4 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{flag.label}</span>
        <span className="block text-[11px] text-muted">{flag.description}</span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${flag.enabled ? "bg-electric" : "bg-white/12"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${flag.enabled ? "translate-x-[1.375rem]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

function Switch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && <span className="block text-[11px] text-muted">{description}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-electric" : "bg-white/12"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[1.375rem]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

const settingsInput = "w-full rounded-xl border border-hairline bg-bg px-3.5 py-2.5 text-sm text-ink outline-none focus:border-electric";
