import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import type { PublicUser } from "@/types";

/** Shared require-admin guard for /api/admin/** route handlers. */
export async function requireAdmin(): Promise<
  { ok: true; user: { id: string; role: string; username: string } } | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Sign in first" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "Administrator access required" }, { status: 403 }) };
  }
  const { id, role, username }: Pick<PublicUser, "id" | "role" | "username"> = {
    id: user.id,
    role: user.role,
    username: user.username,
  };
  return { ok: true, user: { id, role, username } };
}
