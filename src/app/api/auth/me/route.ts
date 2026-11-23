import { NextResponse } from "next/server";
import { getSessionUser, publicUser } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/db/app-settings";

export async function GET() {
  const user = await getSessionUser();
  const settings = getAppSettings();
  return NextResponse.json({
    user: user ? publicUser(user) : null,
    settings: user?.settings ?? null,
    app: { appName: settings.appName, tagline: settings.tagline, features: settings.features },
  });
}
