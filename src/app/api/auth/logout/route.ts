import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { ensureDbLoaded } from "@/lib/db/json-store";

export async function POST() {
  await ensureDbLoaded();
  await destroySession();
  return NextResponse.json({ ok: true });
}
