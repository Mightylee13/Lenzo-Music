"use client";

import { useOverlay } from "@/lib/client/hooks";

/* ============================================================
   SHEET — slide-up action sheet on touch screens, centered
   elevated dialog with backdrop on pointer devices. One primitive
   for every menu/confirmation in the product.
   ============================================================ */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}

export default function Sheet({ open, onClose, title, children, wide }: SheetProps) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={ref}
        className="animate-slide-up absolute inset-x-0 bottom-0 mx-auto w-full glass-strong rounded-t-3xl border-t border-white/8 p-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:w-auto sm:min-w-[360px] sm:max-w-[92vw] sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:border-white/10 sm:p-3"
        style={wide ? undefined : undefined}
      >
        {title && <p className="px-3 pb-1 pt-2 text-sm font-bold text-ink sm:pt-1">{title}</p>}
        <div className="max-h-[70dvh] overflow-y-auto scrollbar-thin sm:max-h-[60vh]">{children}</div>
      </div>
    </div>
  );
}

export function SheetItem({
  icon,
  label,
  description,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  description?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/6 active:bg-white/8 ${
        danger ? "text-danger" : "text-ink"
      }`}
    >
      {icon && <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/6 text-current">{icon}</span>}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {description && <span className="block truncate text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}
