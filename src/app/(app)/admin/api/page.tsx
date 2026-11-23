"use client";

import { useEffect, useState } from "react";
import { CircleDot, Power, Send, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/ui/skeletons";
import { apiSend } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { useUi } from "@/lib/store/ui";
import type { PublicApiConfig } from "@/types";

/* ============================================================
   API CONFIGURATION — edit connection settings, probe any
   endpoint, watch the request log. Secrets stay server-side;
   the browser only ever sees a `hasKey` flag.
   ============================================================ */

type LogEntry = { at?: number; endpoint?: string; ok?: boolean; status?: number; latencyMs?: number; error?: string };

function getDefaults(config: PublicApiConfig) {
  return {
    baseUrl: config.baseUrl,
    authHeader: config.authHeader,
    authPrefix: config.authPrefix,
    docsUrl: config.docsUrl,
    timeoutMs: String(config.timeoutMs),
    endpoints: config.endpoints.map((e) => ({ ...e })),
    responseMappings: { ...config.responseMappings },
    requestHeaders: { ...config.requestHeaders },
  };
}

export default function AdminApiPage() {
  const { data, loading, error, reload } = useApi<{ config: PublicApiConfig; logs: LogEntry[] }>("/api/admin/api");
  const ui = useUi();
  const [form, setForm] = useState<ReturnType<typeof getDefaults> | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState({ endpoint: "/api/search/soundcloud", params: "query=wizkid" });
  const [preview, setPreview] = useState<string | null>(null);
  const [primaryOff, setPrimaryOff] = useState<{ off: boolean; backup: boolean } | null>(null);

  useEffect(() => {
    if (data && !form) setForm(getDefaults(data.config));
  }, [data, form]);

  useEffect(() => {
    fetch("/api/admin/primary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPrimaryOff(d))
      .catch(() => {});
  }, []);

  async function togglePrimary() {
    if (!primaryOff) return;
    const next = !primaryOff.off;
    try {
      const res = await apiSend<{ off: boolean; backup: boolean }>("/api/admin/primary", "PATCH", { off: next });
      setPrimaryOff(res);
      ui.showToast(
        next
          ? res.backup
            ? "Primary API OFF — app is running on the backup engine"
            : "Primary API OFF — warning: backup engine is NOT reachable (start backend/run.bat)"
          : "Primary API back ON",
        next && !res.backup ? "error" : "success",
      );
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Switch failed", "error");
    }
  }

  async function saveConfig() {
    if (!form) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form, timeoutMs: Number(form.timeoutMs) || 15000 };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await apiSend<{ config: PublicApiConfig }>("/api/admin/api", "PATCH", payload);
      setForm(getDefaults(res.config));
      setApiKey("");
      ui.showToast(res.config.status.ok ? "Saved — upstream is reachable" : "Saved — upstream did not answer", res.config.status.ok ? "success" : "error");
      reload();
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid place-items-center py-24"><div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" /></div>;
  if (error || !data) return <ErrorState message={error ?? "Could not load configuration"} onRetry={reload} />;

  const status = data.config.status;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Connection</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">API configuration</h1>
        </div>
        <span className={`flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[11px] font-bold ${status.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-danger/10 text-danger"}`}>
          <CircleDot className="size-3" />
          {status.ok ? `Online · ${status.latencyMs ?? "?"}ms` : status.message}
        </span>
      </header>

      {/* Kill switch */}
      <section className={`rounded-card border p-5 ${primaryOff?.off ? "border-danger/40 bg-danger/5" : "border-hairline bg-card"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Power className={`size-4 ${primaryOff?.off ? "text-danger" : "text-emerald-400"}`} />
              Primary API switch
            </h2>
            <p className="mt-1 text-xs text-muted">
              {primaryOff?.off
                ? "OFF — every upstream call fails instantly; search and playback run on the backup engine."
                : "ON — the app uses the normal upstream API. Switch off to test backup failover."}
            </p>
          </div>
          <button
            type="button"
            onClick={togglePrimary}
            disabled={!primaryOff}
            className={`rounded-pill px-5 py-2.5 text-xs font-bold text-white transition disabled:opacity-40 ${primaryOff?.off ? "bg-emerald-600 hover:bg-emerald-500" : "bg-danger hover:opacity-90"}`}
          >
            {primaryOff?.off ? "Turn primary back ON" : "Turn primary API OFF"}
          </button>
        </div>
        <p className={`mt-2 text-[11px] ${primaryOff?.backup ? "text-emerald-400" : "text-faint"}`}>
          Backup engine: {primaryOff?.backup ? "reachable on port 8765" : primaryOff ? "NOT reachable — start backend/run.bat first" : "checking…"}
        </p>
      </section>

      {/* Connection form */}
      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Upstream connection</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Base URL">
            <input value={form?.baseUrl ?? ""} onChange={(e) => form && setForm({ ...form, baseUrl: e.target.value })} className={inputCls} />
          </Field>
          <Field label="API key" hint={data.config.hasKey ? "A key is stored server-side. Leave empty to keep it." : "No key stored yet."}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data.config.hasKey ? "•••••••• (unchanged)" : "paste key"}
              className={inputCls}
            />
          </Field>
          <Field label="Auth header">
            <input value={form?.authHeader ?? ""} onChange={(e) => form && setForm({ ...form, authHeader: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Auth prefix">
            <input value={form?.authPrefix ?? ""} onChange={(e) => form && setForm({ ...form, authPrefix: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Docs URL">
            <input value={form?.docsUrl ?? ""} onChange={(e) => form && setForm({ ...form, docsUrl: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Timeout (ms)">
            <input type="number" value={form?.timeoutMs ?? ""} onChange={(e) => form && setForm({ ...form, timeoutMs: e.target.value })} className={inputCls} />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={saveConfig} disabled={saving || !form} className="rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white transition hover:bg-cyan disabled:opacity-40">
            {saving ? "Saving & testing…" : "Save & test"}
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await apiSend("/api/admin/api", "POST", { action: "reset" });
                setForm(null);
                setApiKey("");
                ui.showToast("Configuration reset to built-in defaults", "success");
                reload();
              } catch (err) {
                ui.showToast(err instanceof Error ? err.message : "Reset failed", "error");
              }
            }}
            className="flex items-center gap-2 rounded-pill border border-hairline px-4 py-2.5 text-xs font-bold text-muted transition hover:border-danger hover:text-danger"
          >
            <Trash2 className="size-3.5" /> Reset to defaults
          </button>
        </div>
      </section>

      {/* Endpoint mappings */}
      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Endpoint mappings</h2>
        <p className="mt-1 text-xs text-muted">Logical names the app uses and the upstream paths they map to.</p>
        <div className="mt-3 flex flex-col gap-2">
          {form?.endpoints.map((e, i) => (
            <div key={e.key} className="grid grid-cols-[7rem_1fr] items-center gap-2 sm:grid-cols-[9rem_1fr_auto]">
              <span className="truncate font-mono text-xs font-bold text-cyan">{e.key}</span>
              <input
                value={e.path}
                onChange={(ev) => {
                  const endpoints = form.endpoints.map((x, j) => (j === i ? { ...x, path: ev.target.value } : x));
                  setForm({ ...form, endpoints });
                }}
                className={`${inputCls} font-mono`}
              />
              <span className="hidden text-[11px] text-faint sm:block">{e.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Probe */}
      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Endpoint probe</h2>
        <p className="mt-1 text-xs text-muted">Fire a real request against any mapped endpoint and inspect the (trimmed) response.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={probe.endpoint}
            onChange={(e) => setProbe({ ...probe, endpoint: e.target.value })}
            placeholder="/api/search/soundcloud"
            className={`${inputCls} sm:w-64 sm:shrink-0 font-mono`}
          />
          <input
            value={probe.params}
            onChange={(e) => setProbe({ ...probe, params: e.target.value })}
            placeholder="key=value&key2=value2"
            className={`${inputCls} font-mono`}
          />
          <button
            type="button"
            onClick={async () => {
              setPreview("Probing…");
              try {
                const params = Object.fromEntries(new URLSearchParams(probe.params));
                const res = await apiSend<{ ok: boolean; preview?: string; error?: string }>("/api/admin/api", "POST", { action: "probe", endpoint: probe.endpoint, params });
                setPreview(res.ok ? res.preview ?? "(empty response)" : `Error: ${res.error}`);
              } catch (err) {
                setPreview(`Error: ${err instanceof Error ? err.message : "probe failed"}`);
              }
            }}
            className="flex shrink-0 items-center justify-center gap-2 rounded-pill bg-electric px-5 py-2.5 text-xs font-bold text-white transition hover:bg-cyan"
          >
            <Send className="size-3.5" /> Probe
          </button>
        </div>
        {preview && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-muted">{preview}</pre>
        )}
      </section>

      {/* Logs */}
      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Recent upstream requests</h2>
        {data.logs.length === 0 ? (
          <p className="mt-3 text-xs text-faint">No upstream calls recorded yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {[...data.logs].reverse().slice(0, 15).map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2 font-mono text-[11px] text-muted">
                <span className="truncate">{l.endpoint ?? "?"}</span>
                <span className={l.ok ? "text-emerald-400" : "text-danger"}>
                  {l.ok ? l.latencyMs != null ? `${l.latencyMs}ms` : "ok" : (l.error ?? l.status ?? "failed")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await apiSend("/api/admin/settings", "DELETE");
              ui.showToast("Log cleared", "success");
              reload();
            } catch (err) {
              ui.showToast(err instanceof Error ? err.message : "Could not clear log", "error");
            }
          }}
          className="mt-3 rounded-pill border border-hairline px-4 py-2 text-[11px] font-bold text-muted transition hover:border-danger hover:text-danger"
        >
          Clear log
        </button>
      </section>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-hairline bg-bg px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-electric";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-faint">{hint}</span>}
    </label>
  );
}
