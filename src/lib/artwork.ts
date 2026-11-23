/* ============================================================
   GENERATED ARTWORK
   ------------------------------------------------------------
   Every provider supplies its own cover art when available.
   This module produces an on-brand SVG fallback so a playlist,
   album or chart is never represented by a broken image.
   ============================================================ */

const PALETTES: Array<[string, string, string]> = [
  ["#287bff", "#0b1425", "#52c8ff"],
  ["#398cff", "#091222", "#b7deff"],
  ["#1f5fd6", "#070d1a", "#398cff"],
  ["#52c8ff", "#0b1425", "#287bff"],
  ["#2a4fd0", "#0a1120", "#7fd4ff"],
  ["#1747a8", "#070d1a", "#52c8ff"],
  ["#3f7dff", "#0d1729", "#b7deff"],
  ["#0f63d4", "#091222", "#6fd3ff"],
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Deterministic 600×600 SVG artwork. The same seed always yields the same
 * image, so a playlist keeps its cover across reloads and devices.
 */
export function generateArtwork(seed: string, label = ""): string {
  const h = hash(seed || "lenzo");
  const [a, b, c] = PALETTES[h % PALETTES.length];
  const angle = h % 360;
  const cx = 140 + (h % 320);
  const cy = 140 + ((h >> 3) % 320);
  const r = 150 + ((h >> 6) % 170);
  const cx2 = 480 - (cx - 120);
  const cy2 = 460 - (cy - 140);
  const r2 = 120 + ((h >> 9) % 140);
  const initial = escapeXml((label || seed || "L").trim().charAt(0).toUpperCase() || "L");
  const showInitial = label.length > 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="${escapeXml(label || seed)}">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="55%" stop-color="${b}"/>
      <stop offset="100%" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="s" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="${c}" stop-opacity=".55"/>
      <stop offset="100%" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="46"/></filter>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <g filter="url(#blur)" opacity=".85">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity=".5"/>
    <circle cx="${cx2}" cy="${cy2}" r="${r2}" fill="${a}" opacity=".6"/>
  </g>
  <rect width="600" height="600" fill="url(#s)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity=".10" stroke-width="1.5">
    <circle cx="300" cy="300" r="196"/>
    <circle cx="300" cy="300" r="248"/>
  </g>
  ${
    showInitial
      ? `<text x="300" y="348" text-anchor="middle" font-family="Manrope, Inter, system-ui, sans-serif" font-size="230" font-weight="800" fill="#ffffff" fill-opacity=".92" letter-spacing="-8">${initial}</text>`
      : `<circle cx="300" cy="300" r="66" fill="#ffffff" fill-opacity=".14"/>`
  }
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Applies `generateArtwork` only when a provider gave us nothing. */
export function artworkOr(value: string | undefined | null, seed: string, label = ""): string {
  if (value && /^https?:\/\//.test(value)) return value;
  return generateArtwork(seed, label);
}
