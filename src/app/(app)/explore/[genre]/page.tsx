import ExploreGenre from "./client";

/* /explore/[genre] — deep-dive collection view, rendered by the
   client so the player keeps its state. `params` is a Promise in
   this Next version, unwrapped on the server here. */

export default async function ExploreGenrePage({ params }: { params: Promise<{ genre: string }> }) {
  const { genre } = await params;
  return <ExploreGenre genreId={genre} />;
}
