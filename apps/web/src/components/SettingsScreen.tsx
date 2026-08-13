import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "../lib/authClient";
import { getBrainKeyStatus, getCeiling, type BrainKeyStatus, type CeilingInfo } from "../lib/brainKeyClient";
import { getOrgChartForTenant } from "../lib/extractionClient";
import { getHandsKeyStatus, type HandsKeyStatus } from "../lib/handsKeyClient";
import { AppShell } from "./AppShell";
import { Badge, Card } from "./ui";

interface HandsEntry {
  agentName: string;
  tool: string;
  status: HandsKeyStatus | null;
}

type HandsState = { kind: "loading" } | { kind: "no-agents" } | { kind: "ready"; entries: HandsEntry[] };
type BrainState = { kind: "loading" } | { kind: "ready"; status: BrainKeyStatus | null };
type CeilingState = { kind: "loading" } | { kind: "ready"; info: CeilingInfo };

// Settings (dashboard rebuild pass): profile, Brain key, connected
// services (Hands), spending walls, notifications. Every section reads
// real data from what already exists — nothing here is invented. Hands
// status specifically has no tenant-wide "list connected services"
// endpoint (apps/api's handsKeys.ts is deliberately per
// subAgentId+capabilityScope, ADR-002) — this walks the same
// (agent, tool) pairs OrgChartScreen already checks, which is the only
// honest way to show it without a dedicated aggregate route.
export function SettingsScreen() {
  const { data: session } = useSession();
  const [brain, setBrain] = useState<BrainState>({ kind: "loading" });
  const [ceiling, setCeilingState] = useState<CeilingState>({ kind: "loading" });
  const [hands, setHands] = useState<HandsState>({ kind: "loading" });

  useEffect(() => {
    getBrainKeyStatus()
      .then((status) => setBrain({ kind: "ready", status }))
      .catch(() => setBrain({ kind: "ready", status: null }));

    getCeiling()
      .then((info) => setCeilingState({ kind: "ready", info }))
      .catch(() => {});

    getOrgChartForTenant()
      .then(async (batch) => {
        const agents = batch?.orgChart?.agents ?? [];
        const pairs = agents.flatMap((agent) => agent.hands.map((tool) => ({ agentName: agent.name, tool, agentId: agent.id })));
        if (pairs.length === 0) {
          setHands({ kind: "no-agents" });
          return;
        }
        const entries = await Promise.all(
          pairs.map(async ({ agentId, agentName, tool }) => ({
            agentName,
            tool,
            status: await getHandsKeyStatus(agentId, tool).catch(() => null),
          })),
        );
        setHands({ kind: "ready", entries });
      })
      .catch(() => setHands({ kind: "no-agents" }));
  }, []);

  return (
    <AppShell active="/settings">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10 space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Settings</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
        </header>

        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-base font-semibold text-text">Profile</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Name</dt>
                <dd className="text-text">{session?.user.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Email</dt>
                <dd className="text-text">{session?.user.email ?? "—"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-text">AI provider (Brain)</h2>
              <Link to="/connect" className="text-sm font-medium text-accent hover:text-accent-strong">
                {brain.kind === "ready" && brain.status ? "Change" : "Connect"}
              </Link>
            </div>
            {brain.kind === "loading" && <p className="mt-3 text-sm text-text-muted">Loading…</p>}
            {brain.kind === "ready" && brain.status && (
              <div className="mt-3 flex items-center gap-2.5">
                <Badge tone="accent">Connected</Badge>
                <span className="font-mono text-sm text-text-muted">{brain.status.maskedFingerprint}</span>
              </div>
            )}
            {brain.kind === "ready" && !brain.status && <p className="mt-3 text-sm text-text-muted">Not connected yet.</p>}
          </Card>

          <Card>
            <h2 className="font-display text-base font-semibold text-text">Connected services (Hands)</h2>
            {hands.kind === "loading" && <p className="mt-3 text-sm text-text-muted">Loading…</p>}
            {hands.kind === "no-agents" && (
              <p className="mt-3 text-sm text-text-muted">
                No agents need a tool connection yet — this fills in once your company's agents are assigned tools.
              </p>
            )}
            {hands.kind === "ready" && (
              <ul className="mt-3 divide-y divide-border-subtle">
                {hands.entries.map((entry, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text">{entry.tool}</p>
                      <p className="truncate text-xs text-text-muted">{entry.agentName}</p>
                    </div>
                    <Badge tone={entry.status ? "accent" : "danger"}>{entry.status ? "Connected" : "Not connected"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-text">Spending walls</h2>
              <Link to="/spending" className="text-sm font-medium text-accent hover:text-accent-strong">
                Edit
              </Link>
            </div>
            {ceiling.kind === "loading" && <p className="mt-3 text-sm text-text-muted">Loading…</p>}
            {ceiling.kind === "ready" && (
              <p className="mt-3 text-sm text-text">
                <span className="font-mono text-base font-semibold text-text">${ceiling.info.companyMonthlyUsd.toFixed(2)}</span>{" "}
                <span className="text-text-muted">/ month{ceiling.info.isOverride ? "" : " (platform default)"}</span>
              </p>
            )}
          </Card>

          <Card>
            <h2 className="font-display text-base font-semibold text-text">Notifications</h2>
            <p className="mt-3 text-sm text-text-muted">Notification preferences aren't available yet.</p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
