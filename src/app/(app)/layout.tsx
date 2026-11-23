import AppShell from "@/components/shell/AppShell";
import ServiceWorkerBoot from "@/components/shell/ServiceWorkerBoot";

/* All authenticated/dashboard pages share the persistent shell — the
   audio element, queue and scroll position survive navigation. */

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ServiceWorkerBoot />
      {children}
    </AppShell>
  );
}
