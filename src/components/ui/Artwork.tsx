"use client";

import { useState } from "react";
import { generateArtwork } from "@/lib/artwork";

/* Artwork that never 404s: provider covers first, on-brand generated
   SVG fallback when there is nothing usable. Plain <img> keeps remote
   provider hosts out of the next/image config puzzle. */

interface ArtworkProps {
  src?: string | null;
  seed: string;
  label?: string;
  alt?: string;
  className?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
}

export default function Artwork({ src, seed, label, alt, className, loading = "lazy" }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const resolved = failed || !src ? generateArtwork(seed, label ?? seed) : src;
  return (
    <img
      src={resolved}
      alt={alt ?? label ?? seed}
      className={className}
      loading={loading}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
