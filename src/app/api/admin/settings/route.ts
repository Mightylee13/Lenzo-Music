import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { getAppSettings, saveAppSettings } from "@/lib/db/app-settings";
import { clearMusicCache } from "@/lib/api/music";
import { updateDb } from "@/lib/db/json-store";
import { ensureDbLoaded } from "@/lib/db/json-store";

export async function GET() {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ settings: getAppSettings() });
}

export async function PATCH(request: Request) {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { action, ...settingsPatch } = body as {
    action?: string;
    [key: string]: unknown;
  };

  if (action === "clear-cache") {
    clearMusicCache();
    return NextResponse.json({ ok: true, settings: getAppSettings() });
  }

  const next = saveAppSettings(settingsPatch as never);
  return NextResponse.json({ settings: next });
}

export async function DELETE() {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  // Error monitoring helper: wipe the bounded API log.
  updateDb((db) => {
    db.apiLogs = [];
  });
  return NextResponse.json({ ok: true });
}
