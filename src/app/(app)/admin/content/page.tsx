"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ErrorState } from "@/components/ui/skeletons";
import { apiSend } from "@/lib/client/fetcher";
import { useApi } from "@/lib/client/hooks";
import { useUi } from "@/lib/store/ui";
import type { AppSettings, HomeSectionConfig } from "@/types";

export default function AdminContentPage() {
  const { data, loading, error, reload } = useApi<{ settings: AppSettings }>("/api/admin/settings");
  const ui = useUi();
  const [sections, setSections] = useState<HomeSectionConfig[] | null>(null);

  useEffect(() => {
    if (data && !sections) setSections(data.settings.homeSections);
  }, [data, sections]);

  async function commit(next: HomeSectionConfig[]) {
    setSections(next);
    try {
      await apiSend("/api/admin/settings", "PATCH", { homeSections: next });
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : "Save failed", "error");
      reload();
    }
  }

  if (loading) return <div className="grid place-items-center py-24"><div className="size-8 animate-spin rounded-full border-2 border-hairline border-t-cyan" /></div>;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const enabled = sections?.filter((s) => s.enabled).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan">Homepage</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink">Homepage & content</h1>
        <p className="mt-1 text-xs text-muted">{enabled} of {sections?.length ?? 0} sections visible on the home page. Changes apply instantly for every listener.</p>
      </header>

      <section className="rounded-card bg-card p-5">
        <h2 className="text-sm font-bold text-ink">Home sections</h2>
        <div className="mt-3 flex flex-col divide-y divide-hairline/40">
          {sections?.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => commit(sections.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}
              className="flex items-center justify-between gap-4 py-3 text-left first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{s.title}</span>
                <span className="block text-[11px] text-muted">{s.kind} · {s.id}</span>
              </span>
              <span className={`grid size-8 shrink-0 place-items-center rounded-full transition ${s.enabled ? "bg-electric/12 text-cyan" : "bg-white/6 text-faint"}`}>
                {s.enabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="rounded-card bg-card/50 px-4 py-3 text-[11px] text-faint">
        Section order follows this list top-to-bottom; the home renderer walks the same sequence.
      </p>
    </div>
  );
}
