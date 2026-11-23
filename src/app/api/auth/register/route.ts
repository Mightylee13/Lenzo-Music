import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/db/app-settings";
import { createUser, findUserByEmail, findUserByUsername } from "@/lib/db/users";
import { hashPassword } from "@/lib/auth/password";
import { createSession, publicUser } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { username?: string; email?: string; password?: string }
    | null;

  const username = body?.username?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";

  if (username.length < 3 || username.length > 32) {
    return NextResponse.json({ error: "Username must be 3–32 characters" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return NextResponse.json({ error: "Username may only contain letters, numbers, dots, dashes and underscores" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const settings = getAppSettings();
  if (!settings.features.find((f) => f.key === "registration")?.enabled) {
    return NextResponse.json({ error: "Registration is currently closed" }, { status: 403 });
  }

  if (findUserByEmail(email)) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }
  if (findUserByUsername(username)) {
    return NextResponse.json({ error: "This username is taken" }, { status: 409 });
  }

  const user = createUser({ username, email, passwordHash: hashPassword(password) });
  await createSession(user.id);
  return NextResponse.json({ user: publicUser(user) }, { status: 201 });
}
