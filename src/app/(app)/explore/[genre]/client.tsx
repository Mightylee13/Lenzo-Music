"use client";

import { ExploreGenre } from "@/app/(app)/explore/page";

export default function ExploreGenreClient({ genreId }: { genreId: string }) {
  return <ExploreGenre genreId={genreId} />;
}
