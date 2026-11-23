import { NextResponse } from "next/server";
import { GENRES } from "@/lib/data/demo";
import { ensureDbLoaded } from "@/lib/db/json-store";

/** Static genre/mood catalogue (curated, datatabse-free). */
export async function GET() {
  await ensureDbLoaded();
  return NextResponse.json({ genres: GENRES });
}
