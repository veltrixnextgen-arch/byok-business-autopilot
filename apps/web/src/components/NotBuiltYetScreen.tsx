import { AppShell } from "./AppShell";
import { Card } from "./ui";

// Honest placeholder for a nav item with no feature behind it yet
// (Approvals, Digest) — same principle as the empty states already used
// elsewhere (DashboardScreen's "No spend yet", OrgChartScreen's waiting
// state): say plainly that nothing is there rather than fabricate data
// or leave a dead link.
export function NotBuiltYetScreen({ active, title, note }: { active: string; title: string; note: string }) {
  return (
    <AppShell active={active}>
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-10 space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">{title}</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        </header>
        <Card className="text-center">
          <p className="font-display text-base font-semibold text-text">Not built yet</p>
          <p className="mt-2 text-sm text-text-secondary">{note}</p>
        </Card>
      </div>
    </AppShell>
  );
}
