import { NextResponse } from "next/server";
import { consumePasswordReset } from "@/lib/auth/session";
import { setPasswordHash } from "@/lib/db/users";
import { hashPassword } from "@/lib/auth/password";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; password?: string }
    | null;

  const token = body?.token ?? "";
  const password = body?.password ?? "";

  if (!token || password.length < 8) {
    return NextResponse.json({ error: "A valid token and an 8+ character password are required" }, { status: 400 });
  }

  const userId = consumePasswordReset(token);
  if (!userId) {
    return NextResponse.json({ error: "This reset token is invalid or has expired" }, { status: 400 });
  }

  setPasswordHash(userId, hashPassword(password));
  return NextResponse.json({ ok: true });
}
