import { NextResponse } from "next/server";
import { isLocalSection, localContext, localSectionPayload, peekSection, type SectionDescriptor } from "@/lib/api/home-sections";
import { getAppSettings } from "@/lib/db/app-settings";
import { PLAYLISTS } from "@/lib/data/demo";

/* ============================================================
   HOME SHELL — instant, never waits on the upstream API.
   Returns the section layout: local sections with their payload
   inline, remote sections as descriptors the client loads one
   by one (see /api/home/section). See also src/lib/api/
   home-sections.ts for the builders and caches.
   ============================================================ */

export const revalidate = 0;

export async function GET() {
  const settings = getAppSettings().homeSections.filter((s) => s.enabled);
  const { recent, madeForUser } = await localContext();

  const sections: SectionDescriptor[] = settings.map((section) => {
    if (isLocalSection(section.id)) {
      return {
        id: section.id,
        title: section.title,
        kind: section.kind,
        payload: localSectionPayload(section, recent, madeForUser),
      };
    }
    return { id: section.id, title: section.title, kind: section.kind, payload: peekSection(section.id) };
  });

  return NextResponse.json({
    sections,
    featured: PLAYLISTS[0] ?? null,
  });
}
