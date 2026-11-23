"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* ============================================================
   SECTION — a titled carousel. Horizontal scroll with snap on
   touch devices; chevron paging with scroll-smooth on desktop.
   ============================================================ */

interface SectionProps {
  title?: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
  /** Grid of cards instead of a scroller (mobile home style). */
}

export default function Section({ title, href, children, className = "" }: SectionProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const update = () => {
    const el = scroller.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 8,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    });
  };

  useEffect(() => {
    update();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [children]);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className={`group/section relative ${className}`}>
      {(title || href) && (
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          {title && (
            <h2 className="truncate text-lg font-bold tracking-tight text-ink md:text-xl">{title}</h2>
          )}
          {href && (
            <Link
              href={href}
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:bg-white/5 hover:text-ink"
            >
              Show all
            </Link>
          )}
        </div>
      )}
      <div className="relative">
        <div
          ref={scroller}
          className="hide-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pr-1 -mx-1 px-1 pb-1 md:gap-4"
        >
          {children}
        </div>
        {canScroll.left && (
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => page(-1)}
            className="absolute top-1/2 -left-3 z-10 hidden size-9 -translate-y-1/2 place-items-center rounded-full glass-strong text-ink opacity-0 shadow-lg transition-opacity group-hover/section:opacity-100 md:grid hover:scale-105"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        {canScroll.right && (
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => page(1)}
            className="absolute top-1/2 -right-3 z-10 hidden size-9 -translate-y-1/2 place-items-center rounded-full glass-strong text-ink opacity-0 shadow-lg transition-opacity group-hover/section:opacity-100 md:grid hover:scale-105"
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>
    </section>
  );
}
