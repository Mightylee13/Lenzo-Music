import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import {
  getApiConfig,
  getPublicApiConfig,
  resetApiConfig,
  saveApiConfig,
} from "@/lib/config/api-config";
import { testConnection } from "@/lib/api/music";
import { callUpstream } from "@/lib/api/client";
import { readDb } from "@/lib/db/json-store";
import { ensureDbLoaded } from "@/lib/db/json-store";

export async function GET() {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = readDb();
  const status = await testConnection();
  return NextResponse.json({
    config: getPublicApiConfig(status),
    logs: db.apiLogs ?? [],
  });
}

export async function PATCH(request: Request) {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const key of ["baseUrl", "apiKey", "authHeader", "authPrefix", "docsUrl", "timeoutMs" as const]) {
    if (typeof body[key] === "string" || typeof body[key] === "number") patch[key] = body[key];
  }
  if (typeof body.apiKey === "string" && body.apiKey === "") delete patch.apiKey; // empty = keep current
  if (Array.isArray(body.endpoints)) patch.endpoints = body.endpoints;
  if (body.responseMappings && typeof body.responseMappings === "object") patch.responseMappings = body.responseMappings;
  if (body.requestHeaders && typeof body.requestHeaders === "object") patch.requestHeaders = body.requestHeaders;

  saveApiConfig(patch as never);
  const status = await testConnection();
  return NextResponse.json({ config: getPublicApiConfig(status) });
}

export async function POST(request: Request) {
  await ensureDbLoaded();
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { action?: "test" | "reset" | "probe"; endpoint?: string; params?: Record<string, string> }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.action === "reset") {
    resetApiConfig();
    const status = await testConnection();
    return NextResponse.json({ config: getPublicApiConfig(status) });
  }

  if (body.action === "probe" || body.action === "test") {
    if (body.action === "test") {
      const status = await testConnection();
      return NextResponse.json({ status });
    }
    if (!body.endpoint) return NextResponse.json({ error: "An endpoint path is required" }, { status: 400 });
    try {
      const result = await callUpstream({ endpoint: body.endpoint, params: paramsOf(body.params), silent: false });
      return NextResponse.json({
        ok: true,
        preview: JSON.stringify(result, null, 2).slice(0, 4000),
      });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : "Probe failed",
      });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

function paramsOf(map: Record<string, string> | undefined): Record<string, string> {
  return map ?? {};
}
