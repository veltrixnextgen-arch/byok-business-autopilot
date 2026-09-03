import type { OrgChart } from "@byok/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stable reference across renders — matches how the real useNavigate()
// behaves. A fresh `vi.fn()` on every call would change the effect's
// [navigate] dependency on every re-render (e.g. the setState inside
// load() itself), re-triggering the effect and calling load() a second
// time mid-test.
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// AppShell has its own test file and its own real network calls
// (company list, session) — tested in isolation there, not re-exercised
// here on every OrgChartScreen test.
vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/extractionClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/extractionClient")>();
  return {
    ...actual,
    getLatestBatch: vi.fn(),
    getOrgChartForTenant: vi.fn(),
    recordFunnelEvent: vi.fn(),
    submitFeedback: vi.fn(),
    reassemble: vi.fn(),
    renameAgent: vi.fn(),
  };
});

import { getLatestBatch, getOrgChartForTenant } from "../lib/extractionClient";

const getHandsKeyStatus = vi.fn();
const connectHandsKey = vi.fn();
// handsOAuthStartUrl (PR 2B) is left real, not mocked — it's a pure
// string-builder (no network call), and testing the actual URL it
// produces is the point of the oauth-live badge tests below.
vi.mock("../lib/handsKeyClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/handsKeyClient")>();
  return {
    ...actual,
    getHandsKeyStatus: (...args: [string, string]) => getHandsKeyStatus(...args),
    connectHandsKey: (...args: [string, string, string]) => connectHandsKey(...args),
  };
});

import { OrgChartScreen } from "./OrgChartScreen";

const CHART: OrgChart = {
  meta: { idea: "a barber shop", generatedAt: new Date().toISOString(), templateSelection: {} as never, calls: [], costUsd: 0 },
  teams: [{ id: "money", roleTitle: "Money", isHuman: false, agentIds: ["agent-1"] }],
  agents: [
    {
      id: "agent-1",
      name: "Alex",
      title: "Bookkeeper",
      teamId: "money",
      taskIds: ["task-1"],
      tier: "T1" as never,
      brain: null,
      hands: [],
      autonomyDefault: "review" as never,
      complianceLocked: false,
      requiresProfessionalVerification: false,
    },
  ],
  tasks: [
    {
      id: "task-1",
      text: "Log receipts",
      agentType: "agent-1",
      agentLabel: "Bookkeeper",
      teamHint: "money",
      frequency: "daily" as never,
      stakes: "low" as never,
      tier: "T1" as never,
      autonomy: "review" as never,
      handsTool: null,
    },
  ],
  customization: {} as never,
} as unknown as OrgChart;

beforeEach(() => {
  // useRevealStage() (OrgChartScreen.tsx) reads prefers-reduced-motion in
  // an effect — jsdom doesn't implement matchMedia at all. Stubbing it to
  // report reduced motion skips straight to the settled stage, same as a
  // real reduced-motion visitor, so the test doesn't need to wait through
  // the reveal's CSS-timed stages.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  // Default: no claimed organization yet — matches the genuine pre-org
  // state most tests below exercise. Tests for the tenant-scoped path
  // override this with their own mockResolvedValueOnce.
  vi.mocked(getOrgChartForTenant).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(getLatestBatch).mockReset();
  vi.mocked(getOrgChartForTenant).mockReset();
  getHandsKeyStatus.mockReset();
  connectHandsKey.mockReset();
  navigate.mockReset();
});

// The reported bug: nothing exists after the org chart reveal — the
// feedback prompt answers and then it's a dead end for testers. This
// covers the fix: a closing state that always renders alongside the
// feedback prompt (not gated on answering it), naming what's next and
// linking back to the dashboard — no fake buttons, no invented screens.
describe("OrgChartScreen — closing state", () => {
  it("shows the closing state and a dashboard link once the chart settles", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    await waitFor(() => expect(screen.getByText(/that's the preview, in full/i)).toBeTruthy());
    expect(screen.getByText(/naming every agent, connecting your own ai key/i)).toBeTruthy();

    const link = screen.getByRole("link", { name: /back to your dashboard/i });
    expect(link.getAttribute("href")).toBe("/dashboard");
  });
});

// Issue #38 + a real bug found 2026-09-03: once a chart is claimed by a
// tenant, that's the authoritative state — it must win even when the
// user ALSO has an older, never-claimed batch sitting around (a founder
// who tried a few ideas before committing to one). The tenant-scoped
// read is tried FIRST, always; the pre-org read is only a fallback for
// a user with no active organization at all yet.
describe("OrgChartScreen — post-claim revisit (issue #38)", () => {
  it("shows the tenant-scoped org chart when the user has a claimed organization", async () => {
    vi.mocked(getOrgChartForTenant).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    await waitFor(() => expect(screen.getByText(/that's the preview, in full/i)).toBeTruthy());
    expect(vi.mocked(getOrgChartForTenant)).toHaveBeenCalledOnce();
    expect(vi.mocked(getLatestBatch)).not.toHaveBeenCalled();
  });

  it("shows the claimed org's chart even when an older, unclaimed pre-org batch also exists — the exact bug this fixed", async () => {
    // A stale, abandoned draft from an earlier idea the user never
    // finished onboarding with. Before the fix, this alone determined
    // what rendered, forever hiding the user's real, claimed company.
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "old-draft",
      idea: "a completely different, abandoned idea",
      status: "completed",
      orgChart: { ...CHART, meta: { ...CHART.meta, idea: "a completely different, abandoned idea" } },
      costUsd: 0.01,
      error: null,
    });
    vi.mocked(getOrgChartForTenant).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    await waitFor(() => expect(screen.getByText(/that's the preview, in full/i)).toBeTruthy());
    expect(vi.mocked(getLatestBatch)).not.toHaveBeenCalled();
  });

  it("falls back to the pre-org read when the user has no claimed organization at all", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    await waitFor(() => expect(screen.getByText(/that's the preview, in full/i)).toBeTruthy());
    expect(vi.mocked(getOrgChartForTenant)).toHaveBeenCalledOnce();
  });
});

const CHART_WITH_HANDS: OrgChart = {
  ...CHART,
  agents: [{ ...CHART.agents[0], hands: ["Stripe"] }],
} as unknown as OrgChart;

// Issue #22: the org chart is where a Hands tool's JIT connect prompt
// actually lives — Screen 12's "connect now or skip; agents without
// tools work in draft mode".
describe("OrgChartScreen — just-in-time Hands connect (issue #22)", () => {
  it("shows a connect affordance for an unconnected Hands tool, not a static badge", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue(null);

    render(<OrgChartScreen />);

    const connectButton = await screen.findByRole("button", { name: "Stripe · connect" });
    expect(getHandsKeyStatus).toHaveBeenCalledWith("agent-1", "Stripe");

    fireEvent.click(connectButton);
    expect(await screen.findByText(/Alex wants to connect/i)).toBeTruthy();
    expect(screen.getByText(/it works in draft mode/i)).toBeTruthy();
  });

  it("connecting a key replaces the connect button with a connected badge", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue(null);
    connectHandsKey.mockResolvedValue({ id: "key-1", service: "Stripe", maskedFingerprint: "sk-...abcd", createdAt: "" });

    render(<OrgChartScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Stripe · connect" }));
    fireEvent.change(await screen.findByLabelText("Paste your Stripe API key"), { target: { value: "sk_live_real" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(connectHandsKey).toHaveBeenCalledWith("agent-1", "Stripe", "sk_live_real"));
    expect(await screen.findByText("✓ Stripe")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stripe · connect" })).toBeNull();
  });

  it("shows a connected badge directly, with no connect affordance, when already connected", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue({ id: "key-1", service: "Stripe", maskedFingerprint: "sk-...abcd", createdAt: "" });

    render(<OrgChartScreen />);

    expect(await screen.findByText("✓ Stripe")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stripe · connect" })).toBeNull();
  });

  it("skip dismisses the panel without ever calling connectHandsKey", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue(null);

    render(<OrgChartScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Stripe · connect" }));
    await screen.findByText(/Alex wants to connect/i);

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(screen.queryByText(/Alex wants to connect/i)).toBeNull();
    expect(connectHandsKey).not.toHaveBeenCalled();
  });
});

const CHART_WITH_OAUTH_ONLY_HANDS: OrgChart = {
  ...CHART,
  agents: [{ ...CHART.agents[0], hands: ["Instagram/Meta"] }],
} as unknown as OrgChart;

// Follow-up to issue #22: HandsConnectPanel's paste-a-key input is honest
// only for services that actually have a pasteable key
// (docs/design/tool-registry.md §2b/§2e found most Hands services don't).
// authMethodForTool (packages/templates) is what decides which panel a
// badge opens — these tests cover the OAuth-only branch specifically.
describe("OrgChartScreen — OAuth-only Hands tool shows an honest draft-mode state, not a key field", () => {
  it("labels the badge 'draft only', not 'connect', for an OAuth-only tool", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_OAUTH_ONLY_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue(null);

    render(<OrgChartScreen />);

    expect(await screen.findByRole("button", { name: "Instagram/Meta · draft only" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instagram/Meta · connect" })).toBeNull();
  });

  it("clicking the badge shows the honest message with no paste-a-key input, and never calls connectHandsKey", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_OAUTH_ONLY_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue(null);

    render(<OrgChartScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Instagram/Meta · draft only" }));

    expect(await screen.findByText(/needs a sign-in flow we haven't built yet/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Paste your Instagram\/Meta API key/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/needs a sign-in flow we haven't built yet/i)).toBeNull();
    expect(connectHandsKey).not.toHaveBeenCalled();
  });
});

const CHART_WITH_LIVE_OAUTH_HANDS: OrgChart = {
  ...CHART,
  agents: [{ ...CHART.agents[0], hands: ["Calendar"] }],
} as unknown as OrgChart;

// PR 2B: Calendar is the one handsAuth.ts entry classified "oauth-live" —
// its badge must be a real navigable link to apps/api's real connect
// flow, not a button opening an inline panel like the other two methods.
describe("OrgChartScreen — 'oauth-live' Hands tool is a real connect link (PR 2B)", () => {
  it("renders the badge as a real link to apps/api's OAuth start route, not a button", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_LIVE_OAUTH_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue(null);

    render(<OrgChartScreen />);

    const link = await screen.findByRole("link", { name: "Calendar · connect" });
    expect(link.getAttribute("href")).toBe("http://localhost:3000/api/hands-oauth/google-calendar/start?subAgentId=agent-1&capabilityScope=calendar");
    expect(screen.queryByRole("button", { name: "Calendar · connect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Calendar · draft only" })).toBeNull();
  });

  it("shows the connected badge, not the connect link, once already connected", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART_WITH_LIVE_OAUTH_HANDS,
      costUsd: 0.01,
      error: null,
    });
    getHandsKeyStatus.mockResolvedValue({ id: "key-1", service: "google-calendar", maskedFingerprint: "", createdAt: "" });

    render(<OrgChartScreen />);

    expect(await screen.findByText("✓ Calendar")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Calendar · connect" })).toBeNull();
  });
});

// PR 2B: the callback route redirects back to /org-chart?handsOAuth=... —
// this is where that lands.
describe("OrgChartScreen — post-OAuth-redirect banner", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("shows a success message for ?handsOAuth=connected and strips it from the URL", async () => {
    window.history.pushState({}, "", "/org-chart?handsOAuth=connected");
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    expect(await screen.findByText(/can now act through it/i)).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("shows the reason for ?handsOAuth=error&reason=exchange_failed, as an alert", async () => {
    window.history.pushState({}, "", "/org-chart?handsOAuth=error&reason=exchange_failed");
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't connect/i);
    expect(alert.textContent).toMatch(/exchange_failed/);
  });

  it("shows no banner at all when the URL has neither query param", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    await waitFor(() => expect(screen.getByText(/that's the preview, in full/i)).toBeTruthy());
    expect(screen.queryByText(/can now act through it/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
