import { NextResponse } from "next/server";
import { findUserByEmail, findUserByUsername, getPasswordHash } from "@/lib/db/users";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, publicUser } from "@/lib/auth/session";
import { ensureDbLoaded } from "@/lib/db/json-store";

const IDENTIFIER_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  await ensureDbLoaded();
  const body = (await request.json().catch(() => null)) as
    | { identifier?: string; email?: string; username?: string; password?: string }
    | null;

  const identifier = (body?.identifier ?? body?.email ?? body?.username ?? "").trim();
  const password = body?.password ?? "";

  if (!identifier || !password) {
    return NextResponse.json({ error: "Enter your email/username and password" }, { status: 400 });
  }

  const user = IDENTIFIER_RE.test(identifier) ? findUserByEmail(identifier) : findUserByUsername(identifier);
  const hash = user ? getPasswordHash(user) : undefined;

  // Same message for unknown user and wrong password — no account enumeration.
  if (!user || !hash || !verifyPassword(password, hash)) {
    return NextResponse.json({ error: "Incorrect email/username or password" }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ user: publicUser(user) }, { status: 200 });
}
