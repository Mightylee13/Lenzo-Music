import { NextResponse } from "next/server";
import { GENRES } from "@/lib/data/demo";

/** Static genre/mood catalogue (curated, datatabse-free). */
export async function GET() {
  return NextResponse.json({ genres: GENRES });
}
