import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { users, findUserById, patchUser } from "@/lib/db/users";
import { readDb } from "@/lib/db/json-store";
import { publicUser } from "@/lib/auth/session";
import { playlistsByOwner } from "@/lib/db/playlists";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = readDb();
  const resets = (db.passwordResets as Array<{ token: string; userId: string; expiresAt: number }>) ?? [];
  const now = Date.now();
  const liveResets = resets.filter((r) => r.expiresAt > now);
  const logs = (db.apiLogs as unknown[]) ?? [];

  return NextResponse.json({
    users: users().map((u) => {
      const p = publicUser(u);
      return {
        ...p,
        playlistCount: playlistsByOwner(u.id).length,
        likedCount: u.likedTracks.length,
      };
    }),
    stats: {
      totalUsers: users().length,
      admins: users().filter((u) => u.role === "admin").length,
      totalPlaylists: ((db.playlists as unknown[]) ?? []).length,
      apiLogCount: logs.length,
      liveResets: liveResets.map((r) => ({
        token: r.token,
        userId: r.userId,
        expiresAt: r.expiresAt,
      })),
    },
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { action?: "promote" | "demote" | "delete"; userId?: string }
    | null;
  if (!body?.userId || !body.action) {
    return NextResponse.json({ error: "userId and action are required" }, { status: 400 });
  }
  if (body.userId === guard.user.id && body.action !== "promote") {
    return NextResponse.json({ error: "You cannot delete or demote your own account" }, { status: 400 });
  }

  const target = findUserById(body.userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (body.action === "delete") {
    // Hard role change is the only supported removal here: keep it simple by
    // emptying the account (soft delete) so referential data stays intact.
    patchUser(body.userId, { email: `deleted+${Date.now()}@lenzo.invalid`, username: `deleted_${target.username}`, bio: "Account deleted" });
    return NextResponse.json({ ok: true });
  }

  const updated = patchUser(body.userId, { role: body.action === "promote" ? "admin" : "user" });
  return NextResponse.json({ user: updated ? publicUser(updated) : null });
}
