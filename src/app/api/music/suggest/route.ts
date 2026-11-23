import { NextResponse } from "next/server";
import { suggest } from "@/lib/api/music";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ suggestions: await suggest(q) });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
