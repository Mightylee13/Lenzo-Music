import AppShell from "@/components/shell/AppShell";

/* All authenticated/dashboard pages share the persistent shell — the
   audio element, queue and scroll position survive navigation. */

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
