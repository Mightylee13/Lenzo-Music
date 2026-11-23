import { NextResponse } from "next/server";
import { searchAll, searchTracks } from "@/lib/api/music";
import type { SearchSource } from "@/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const sourceParam = url.searchParams.get("source");
  const limit = Number(url.searchParams.get("limit") ?? 40);

  if (!q) return NextResponse.json({ results: { tracks: [], artists: [], albums: [], playlists: [], podcasts: [], total: 0 } });

  try {
    if (sourceParam === "soundcloud" || sourceParam === "spotify" || sourceParam === "youtube") {
      const results = await searchTracks(q, sourceParam as SearchSource);
      return NextResponse.json({
        results: {
          ...results,
          tracks: results.tracks.slice(0, limit),
          artists: results.artists.slice(0, limit),
          albums: results.albums.slice(0, limit),
        },
      });
    }

    const results = await searchAll(q);
    return NextResponse.json({
      results: {
        ...results,
        tracks: results.tracks.slice(0, limit),
        artists: results.artists.slice(0, limit),
        albums: results.albums.slice(0, limit),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 }
    );
  }
}
