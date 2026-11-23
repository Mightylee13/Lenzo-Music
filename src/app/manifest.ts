import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lenzo Music",
    short_name: "Lenzo",
    description: "Premium music streaming — search, discover and stream.",
    start_url: "/",
    display: "standalone",
    background_color: "#070d1a",
    theme_color: "#070d1a",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
