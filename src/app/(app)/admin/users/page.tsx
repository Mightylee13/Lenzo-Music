"use client";

import { ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/ui/skeletons";
import { apiSend, formatCount } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { useUi } from "@/lib/store/ui";
import { useSession } from "@/lib/store/session";
import type { PublicUser } from "@/types";

type AdminUser = PublicUser & { playlistCount: number; likedCount: number };
type Payload = { users: AdminUser[]; stats: unknown };

export default function AdminUsersPage() {
  const { data, loading, error, reload } = useApi<Payload>("/api/admin/users");
  const session = useSession();
  const ui = useUi();

  async function act(userId: string, action: "promote" | "demote" | "delete") {
    if (action === "delete" && !confirm("Delete this user permanently? Their playlists go with them."))
      return;
    try {
      await apiSend("/api/admin/users", "PATCH", { userId, action });
      ui.showToast(`User ${action === "delete" ? "deleted" : action === "promote" ? "promoted" : "demoted"}`, "success");
      reload();
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Action failed", "error");
    }
  }

  if (loading) return <div className="grid place-items-center py-24"><div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" /></div>;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.users.length) return <EmptyState title="No users yet" description="Users appear here as they sign up." />;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">People</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">Users</h1>
        <p className="mt-1 text-xs text-muted">{data.users.length} accounts registered on this instance.</p>
      </header>

      <div className="overflow-x-auto rounded-card bg-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-3 font-bold">User</th>
              <th className="px-4 py-3 font-bold">Role</th>
              <th className="px-4 py-3 font-bold">Playlists</th>
              <th className="px-4 py-3 font-bold">Likes</th>
              <th className="px-4 py-3 font-bold">Joined</th>
              <th className="px-4 py-3 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => {
              const self = u.id === session.user?.id;
              return (
                <tr key={u.id} className="border-b border-hairline/40 last:border-0 hover:bg-white/2">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{u.username}{self && <span className="ml-2 text-[10px] font-bold text-cyan">(you)</span>}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-pill px-2.5 py-1 text-[10px] font-bold ${u.role === "admin" ? "bg-electric/12 text-cyan" : "bg-white/6 text-muted"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums text-muted">{formatCount(u.playlistCount)}</td>
                  <td className="px-4 py-3 text-xs tabular-nums text-muted">{formatCount(u.likedCount)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {self ? (
                      <p className="text-right text-[11px] text-faint">Self-protected</p>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          title={u.role === "admin" ? "Demote to user" : "Promote to admin"}
                          onClick={() => act(u.id, u.role === "admin" ? "demote" : "promote")}
                          className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-white/8 hover:text-cyan"
                        >
                          {u.role === "admin" ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
                        </button>
                        <button
                          type="button"
                          title="Delete user"
                          onClick={() => act(u.id, "delete")}
                          className="grid size-8 place-items-center rounded-full text-faint transition hover:bg-white/8 hover:text-danger"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
