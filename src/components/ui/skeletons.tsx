"use client";

/* ============================================================
   SKELETONS + EMPTY STATES shared by every data-driven page.
   ============================================================ */

export function CardSkeleton({ count = 6, round = false }: { count?: number; round?: boolean }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-[150px] shrink-0 snap-start md:w-[176px]">
          <div className={`skeleton aspect-square w-full shadow-lg shadow-black/30 ${round ? "rounded-full" : "rounded-card"}`} />
          <div className="skeleton mt-2.5 h-3.5 w-4/5 rounded-full" />
          <div className="skeleton mt-1.5 h-3 w-2/5 rounded-full" />
        </div>
      ))}
    </>
  );
}

export function TrackListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2.5">
          <div className="skeleton size-11 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-3.5 w-1/2 rounded-full" />
            <div className="skeleton mt-2 h-3 w-1/3 rounded-full" />
          </div>
          <div className="skeleton hidden h-3 w-10 rounded-full md:block" />
        </div>
      ))}
    </div>
  );
}

export function BannerSkeleton() {
  return (
    <div className="h-48 w-full skeleton md:h-64" />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-hairline px-6 py-14 text-center">
      {icon && <div className="grid size-12 place-items-center rounded-full bg-card text-cyan">{icon}</div>}
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-card/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-electric px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan"
        >
          Try again
        </button>
      )}
    </div>
  );
}
