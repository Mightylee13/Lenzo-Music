import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the PC's LAN IP so the app can be opened from a phone on the
  // same Wi-Fi (http://192.168.100.82:3000). Without this, Next dev
  // blocks all /_next assets from non-localhost hosts.
  allowedDevOrigins: ["192.168.100.82", "*.local"],
  // Cache Components (PPR) is intentionally NOT enabled: this application is
  // heavily dynamic (auth, playlists, live API proxying) and fetches data on
  // the client. Enabling it would require Suspense boundaries around every
  // uncached server read without any benefit for this product.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
