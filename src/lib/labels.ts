import type { Album } from "@/types";

/**
 * What a release IS — the badge/subtitle word shown on cards and rows.
 * EPs, singles and compilations get their own sign everywhere an album
 * type is displayed, instead of everything falling back to "Album".
 */
export function albumTypeLabel(type?: Album["type"]): string {
  switch (type) {
    case "ep":
      return "EP";
    case "single":
      return "Single";
    case "compilation":
      return "Compilation";
    default:
      return "Album";
  }
}
