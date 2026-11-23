import { NextResponse } from "next/server";
import { findUserByEmail, findUserByUsername } from "@/lib/db/users";
import { createPasswordReset } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { identifier?: string } | null;
  const identifier = (body?.identifier ?? "").trim();

  const user = identifier.includes("@") ? findUserByEmail(identifier) : findUserByUsername(identifier);
  // Always return ok so the endpoint cannot be used to discover accounts.
  // In a real deployment the token would be emailed; here it is stored
  // server-side and surfaced by the admin dashboard for manual handoff.
  if (user) createPasswordReset(user.id);
  return NextResponse.json({ ok: true, message: "If the account exists, a reset was issued. Contact your administrator to receive the token." });
}
