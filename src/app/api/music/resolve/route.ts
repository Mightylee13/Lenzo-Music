import { NextResponse } from "next/server";
import { clearMusicCache, resolveTrack } from "@/lib/api/music";
import type { Track } from "@/types";

// Converters legitimately take 5–30s to prepare a full track; Vercel's
// default function timeout is far below that (playback would fail or be
// retried endlessly). This route is exactly the slow-but-bounded path.
export const maxDuration = 60;

/**
 * POST /api/music/resolve — turns a catalogue track into a directly
 * streamable audio URL. Strategy: return whatever we can play, prefer the
 * best source; when no stream exists, surface a real error (never a fake
 * success).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { track?: Track; force?: boolean }
    | null;

  if (!body?.track?.id) {
    return NextResponse.json({ error: "A track id is required" }, { status: 400 });
  }

  try {
    if (body.force) clearMusicCache();
    const audio = await resolveTrack(body.track, body.force);
    return NextResponse.json({ audio });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not resolve audio" },
      { status: 404 }
    );
  }
}
