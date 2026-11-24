import { NextResponse } from "next/server";
import { chartPlaylistById } from "@/lib/api/charts";

/* ============================================================
   EDITORIAL CHARTS — one real chart playlist by id (Apple Music
   "Most Played" per storefront, Deezer editorials). Powers the
   Discover chips so they stay in sync with the rest of the app
   (same chart data as the home chart shelves).
   ============================================================ */

export const revalidate = 0;

export async function GET(_request: Request, ctx: RouteContext<"/api/music/charts/[id]">) {
  const { id } = await ctx.params;
  if (!/^chart-(apple|dz)-[a-z0-9-]{1,32}$/i.test(id)) {
    return NextResponse.json({ error: "Unknown chart id" }, { status: 400 });
  }
  const playlist = await chartPlaylistById(id.trim().toLowerCase());
  if (!playlist || !playlist.tracks?.length) {
    return NextResponse.json({ error: "Chart unavailable right now" }, { status: 502 });
  }
  return NextResponse.json({ playlist });
}
