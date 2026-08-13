import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { listOrganizations, switchOrganization, type OrganizationSummary } from "../lib/organizationClient";
import { useSession } from "../lib/authClient";
import { cx } from "./ui";

interface NavItem {
  label: string;
  to: string;
}

// The seven sections scoped for the app shell (dashboard rebuild pass).
// Every item routes somewhere real — the ones without a built feature
// yet (Agents, Approvals, Digest, Spending) still get a real route and
// an honest "not built yet" screen, never a dead link. See each route
// file for what backs it today.
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Company", to: "/org-chart" },
  { label: "Agents", to: "/agents" },
  { label: "Approvals", to: "/approvals" },
  { label: "Digest", to: "/digest" },
  { label: "Spending", to: "/spending" },
  { label: "Settings", to: "/settings" },
];

// Persistent left sidebar wrapping every authenticated screen (issue:
// "dashboard needs to become a real operating surface"). Each screen
// keeps its own content/data-fetching; this only owns navigation and the
// company switcher — deliberately not a route-tree layout route (that
// would mean renaming every existing route file into a nested
// pathless-layout structure), just a component every authenticated
// screen renders itself inside.
export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen lg:flex">
      <MobileTopBar onOpenMenu={() => setMobileOpen(true)} />

      <Sidebar active={active} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function MobileTopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3 lg:hidden">
      <span className="font-display text-base font-semibold text-text">Runwisely</span>
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-md border border-border p-1.5 text-text-secondary hover:text-text"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function Sidebar({
  active,
  mobileOpen,
  onCloseMobile,
}: {
  active: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}
      <aside
        className={cx(
          "z-50 flex w-64 shrink-0 flex-col border-r border-border-subtle bg-bg px-4 py-6",
          "fixed inset-y-0 left-0 transition-transform duration-calm-fast ease-calm lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link to="/dashboard" className="mb-6 block font-display text-base font-semibold text-text">
          Runwisely
        </Link>

        <CompanySwitcher />

        <nav className="mt-6 flex-1 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onCloseMobile}
              className={cx(
                "block rounded-lg px-3 py-2 font-body text-sm transition-colors duration-calm-fast ease-calm",
                item.to === active ? "bg-accent/10 font-medium text-accent" : "text-text-secondary hover:bg-bg-glass hover:text-text",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}

function CompanySwitcher() {
  const { data: session } = useSession();
  const [orgs, setOrgs] = useState<OrganizationSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listOrganizations()
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const activeOrgId = session?.session.activeOrganizationId ?? null;
  const activeOrg = orgs?.find((o) => o.id === activeOrgId) ?? null;

  async function handleSwitch(orgId: string) {
    if (orgId === activeOrgId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await switchOrganization(orgId);
      // A hard reload, not a client nav: every screen's data (dashboard
      // stats, org chart, spending) is fetched for whichever tenant the
      // session resolves to server-side — a client-only state update
      // would leave half the app showing the old tenant's data until
      // each screen happened to refetch on its own.
      window.location.assign("/dashboard");
    } catch {
      setSwitching(false);
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-bg-glass px-3 py-2.5 text-left transition-colors duration-calm-fast ease-calm hover:border-border-strong disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">Company</span>
          <span className="block truncate text-sm font-medium text-text">
            {switching ? "Switching…" : orgs === null ? "Loading…" : (activeOrg?.name ?? "Select a company")}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-text-muted">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && orgs !== null && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1.5 overflow-hidden rounded-lg border border-border bg-bg shadow-card">
          {orgs.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-text-muted">No companies yet.</p>
          ) : (
            orgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => handleSwitch(org.id)}
                className={cx(
                  "block w-full truncate px-3 py-2.5 text-left text-sm transition-colors duration-calm-fast ease-calm hover:bg-bg-glass",
                  org.id === activeOrgId ? "font-medium text-accent" : "text-text",
                )}
              >
                {org.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
