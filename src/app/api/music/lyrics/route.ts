import { NextResponse } from "next/server";
import { fetchLyrics } from "@/lib/api/music";

/**
 * GET /api/music/lyrics?title=&artist=&duration= — on-demand lyrics lookup
 * for the current track. Primary source is LRCLIB (returns synced LRC when
 * available), falling back to the ytmp3 full-text lookup. Cached at the
 * same layer as the rest of the music service.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title")?.trim() ?? "";
  const artist = url.searchParams.get("artist")?.trim() ?? "";
  const duration = Number(url.searchParams.get("duration"));

  if (!title) {
    return NextResponse.json({ error: "A track title is required" }, { status: 400 });
  }

  try {
    const lyrics = await fetchLyrics(title, artist, Number.isFinite(duration) && duration > 0 ? duration : undefined);
    return NextResponse.json(lyrics);
  } catch {
    return NextResponse.json({ synced: null, plain: null, source: null });
  }
}
