import { NextResponse } from "next/server";
import { getSessionUser, publicUser } from "@/lib/auth/session";
import { patchUser, patchUserSettings } from "@/lib/db/users";
import type { UserSettings } from "@/types";

/** GET/PATCH — user profile fields (username, avatar, bio) + preferences. */

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { username?: string; avatar?: string; bio?: string; settings?: Partial<UserSettings> }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.settings) {
    const updated = patchUserSettings(user.id, body.settings);
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ user: publicUser(updated) });
  }

  const profilePatch: { username?: string; avatar?: string; bio?: string } = {};
  if (typeof body.username === "string" && body.username.trim().length >= 3) {
    profilePatch.username = body.username.trim();
  }
  if (typeof body.avatar === "string") profilePatch.avatar = body.avatar;
  if (typeof body.bio === "string") profilePatch.bio = body.bio.slice(0, 500);

  const updated = patchUser(user.id, profilePatch);
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user: publicUser(updated) });
}
