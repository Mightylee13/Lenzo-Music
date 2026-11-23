"use client";

import Link from "next/link";
import { Database, ListMusic, UsersRound, Zap } from "lucide-react";
import { ErrorState } from "@/components/ui/skeletons";
import { apiSend, formatCount } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { useUi } from "@/lib/store/ui";
import type { ApiStatus, PublicApiConfig } from "@/types";

type UsersPayload = {
  users: { id: string; username: string; email: string; role: "user" | "admin"; playlistCount: number; likedCount: number; createdAt: number }[];
  stats: { totalUsers: number; admins: number; totalPlaylists: number; apiLogCount: number; liveResets: { token: string; userId: string; expiresAt: number }[] };
};

export default function AdminOverviewPage() {
  const usersApi = useApi<UsersPayload>("/api/admin/users");
  const apiApi = useApi<{ config: PublicApiConfig; logs: unknown[] }>("/api/admin/api");
  const ui = useUi();

  const stats = usersApi.data?.stats;

  async function ping() {
    try {
      const res = await apiSend<{ status: ApiStatus }>("/api/admin/api", "POST", { action: "test" });
      ui.showToast(res.status.ok ? `Upstream OK — ${res.status.latencyMs ?? "?"}ms` : `Upstream: ${res.status.message}`, res.status.ok ? "success" : "error");
      apiApi.reload();
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Test failed", "error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Control room</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink md:text-3xl">Overview</h1>
      </header>

      {usersApi.error && <ErrorState message={usersApi.error} onRetry={usersApi.reload} />}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<UsersRound className="size-4" />} label="Users" value={stats ? formatCount(stats.totalUsers) : "—"} sub={stats ? `${stats.admins} admin${stats.admins === 1 ? "" : "s"}` : ""} />
        <StatTile icon={<ListMusic className="size-4" />} label="Playlists" value={stats ? formatCount(stats.totalPlaylists) : "—"} sub="across all users" />
        <StatTile icon={<Database className="size-4" />} label="API log entries" value={stats ? formatCount(stats.apiLogCount) : "—"} sub="bounded ring buffer" />
        <StatTile icon={<Zap className="size-4" />} label="Upstream" value={apiApi.data?.config.status.ok ? "Online" : "Offline"} sub={apiApi.data?.config.status.message ?? ""} />
      </section>

      <section className="rounded-card bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Upstream API</h2>
            <p className="mt-1 text-xs text-muted">
              {apiApi.data?.config.baseUrl ?? "Loading…"} · {apiApi.data?.config.hasKey ? "key stored server-side" : "no key set"}
            </p>
          </div>
          <button type="button" onClick={ping} className="rounded-pill bg-electric px-4 py-2 text-xs font-bold text-white transition hover:bg-cyan">
            Test connection
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link href="/admin/api" className="text-xs font-bold text-cyan hover:underline">Edit API configuration →</Link>
          <Link href="/admin/users" className="text-xs font-bold text-cyan hover:underline">Manage users →</Link>
          <Link href="/admin/content" className="text-xs font-bold text-cyan hover:underline">Homepage & features →</Link>
        </div>
      </section>

      {stats && stats.liveResets.length > 0 && (
        <section className="rounded-card bg-card p-5">
          <h2 className="text-sm font-bold text-ink">Live password-reset tokens</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {stats.liveResets.map((r) => (
              <li key={r.token} className="rounded-xl bg-black/20 px-3 py-2 font-mono text-xs text-muted">
                token <span className="text-cyan">{r.token}</span> · expires {new Date(r.expiresAt).toLocaleString()}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">Hand these to the requesting user over a trusted channel, then they finish at /reset-password.</p>
        </section>
      )}
    </div>
  );
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card bg-card p-4">
      <div className="flex items-center gap-2 text-cyan">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-extrabold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}
