import { NextResponse } from "next/server";
import { getSectionPayload } from "@/lib/api/home-sections";

/* ============================================================
   HOME SECTION — one homepage section at a time, so the page
   loads "small small": each shelf appears as soon as its own
   data is ready, and a slow/failing section never blocks the
   others. Served from the per-section stale-while-revalidate
   cache in src/lib/api/home-sections.ts when warm.
   ============================================================ */

export const revalidate = 0;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9-]{1,64}$/i.test(id)) {
    return NextResponse.json({ error: "Bad section id" }, { status: 400 });
  }
  const payload = await getSectionPayload(id);
  if (!payload) {
    return NextResponse.json({ error: "Section not found or empty" }, { status: 404 });
  }
  return NextResponse.json(payload);
}
