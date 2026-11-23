import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { isPrimaryDisabled, setPrimaryDisabled } from "@/lib/config/api-config";
import { backupAvailable } from "@/lib/api/backup";
import { clearMusicCache } from "@/lib/api/music";
import { ensureDbLoaded } from "@/lib/db/json-store";

/* ============================================================
   PRIMARY API KILL SWITCH (admin)
   GET    → current switch state + backup engine availability.
   PATCH  → { off: boolean } — switch the primary upstream off
            (backup test / failover) or back on. Takes effect on
            the next request; the response cache is cleared.
   ============================================================ */

export async function GET() {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  return NextResponse.json({
    off: isPrimaryDisabled(),
    backup: await backupAvailable(),
  });
}

export async function PATCH(request: Request) {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as { off?: boolean } | null;
  if (typeof body?.off !== "boolean") {
    return NextResponse.json({ error: "Body must be { off: boolean }" }, { status: 400 });
  }

  setPrimaryDisabled(body.off);
  // Cached search/resolve results came from the old source — clear them
  // so the switch is felt immediately.
  clearMusicCache();

  return NextResponse.json({
    off: isPrimaryDisabled(),
    backup: await backupAvailable(),
  });
}
