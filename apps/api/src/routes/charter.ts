import { zValidator } from "@hono/zod-validator";
import type { Charter } from "@byok/contracts";
import { generateCascade } from "@byok/extraction";
import type { CompanyCharterStore, SignupExtractionBatchStore } from "@byok/db";
import type { SyncResult } from "@byok/jobs";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import type { ClampNote } from "../scheduler/computeDesiredSchedule.js";

export interface CharterSyncResult extends SyncResult {
  clampNotes: ClampNote[];
}

export interface CharterRouteDeps {
  charters: Pick<
    CompanyCharterStore,
    "createDraft" | "updateDraft" | "getLatestDraft" | "getActive" | "accept" | "get"
  >;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  /** R3/ADR-025: syncs the tenant's BullMQ repeatable-job schedule against
   *  the just-installed cascade — called after every successful accept, so
   *  a Charter handoff makes the company actually run on its own, not just
   *  installs prompts nothing dispatches yet. Optional so charter.test.ts's
   *  existing R2-era tests don't all need a scheduler double; omitted in
   *  those, it's simply not called.
   *
   *  Issue #135: returns what was actually scheduled (added/removed/
   *  unchanged job ids, plus any tier-floor clamp notes) — the accept
   *  response surfaces this instead of silently discarding it the way this
   *  callback used to (`Promise<void>`, result thrown away). `null` means
   *  "nothing to schedule yet" (shouldn't happen post-accept, but never
   *  assumed), not an error. */
  onAccepted?: (tenantId: string) => Promise<CharterSyncResult | null>;
}

const roleMandateSchema = z.object({
  roleTitle: z.string(),
  mandate: z.string(),
  tasks: z.array(z.string()),
});

const charterContentSchema = z.object({
  sharpenedIdea: z.string().min(1),
  mvpDefinition: z.string().min(1),
  roleMandates: z.array(roleMandateSchema),
  monthOneGoals: z.array(z.string()),
  budgetCeilingUsd: z.number().positive().finite(),
}) satisfies z.ZodType<Charter>;

/**
 * R2 (docs/architecture/automation-runtime-plan.md §2, ADR-024): the
 * Charter review/edit/handoff surface. `GET /` is a pure read — never
 * creates anything — so the UI can render before deciding whether it needs
 * to call `POST /draft`. `POST /draft` is the one side-effecting read-ish
 * call, and it's idempotent (same shape as /me/claim-org-chart): calling it
 * twice never creates two drafts.
 *
 * Every route lives under tenantMiddleware (mounted at /me/charter) — an
 * active organization must already exist, matching /me/claim-org-chart and
 * /me/org-chart's own requirement.
 */
export function charterRoute(deps: CharterRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const [active, draft] = await Promise.all([deps.charters.getActive(tenantId), deps.charters.getLatestDraft(tenantId)]);
      if (active || draft) return c.json({ active, draft, rawDraft: null });

      const batch = await deps.batchStore.latestForTenant(tenantId);
      const rawDraft = batch?.orgChart?.onboardingBatch?.charterDraft ?? null;
      return c.json({ active: null, draft: null, rawDraft });
    })
    .post("/draft", async (c) => {
      const tenantId = c.get("tenantId");
      const existing = await deps.charters.getLatestDraft(tenantId);
      if (existing) return c.json({ draft: existing });

      // Reopening an already-installed Charter (master-plan-v2.md: "the
      // user can reopen anytime") seeds the new draft from what's active;
      // a brand-new company seeds from the raw onboarding-batch draft.
      const active = await deps.charters.getActive(tenantId);
      if (active) {
        const draft = await deps.charters.createDraft(tenantId, active.content);
        return c.json({ draft });
      }

      const batch = await deps.batchStore.latestForTenant(tenantId);
      const rawDraft = batch?.orgChart?.onboardingBatch?.charterDraft;
      if (!rawDraft) return c.json({ error: "No org chart to draft a Charter from — complete extraction first." }, 404);

      const draft = await deps.charters.createDraft(tenantId, rawDraft);
      return c.json({ draft });
    })
    .patch("/draft/:id", zValidator("json", charterContentSchema), async (c) => {
      const tenantId = c.get("tenantId");
      const id = c.req.param("id");
      const content = c.req.valid("json") as Charter;
      const draft = await deps.charters.updateDraft(tenantId, id, content);
      if (!draft) return c.json({ error: "No editable draft with that id." }, 404);
      return c.json({ draft });
    })
    // The handoff ceremony (master-plan-v2.md Stage 4 #11): installs this
    // draft as the tenant's active Charter and generates the three-tier
    // prompt cascade from it. Requires an org chart to already be claimed
    // by this tenant (issue #38) — the caller is expected to have called
    // POST /me/claim-org-chart first (or this endpoint is itself the new,
    // later call site per me.ts's own "just the caller" design note).
    .post("/draft/:id/accept", async (c) => {
      const tenantId = c.get("tenantId");
      const id = c.req.param("id");

      const draft = await deps.charters.get(tenantId, id);
      if (!draft || draft.status !== "draft") return c.json({ error: "No editable draft with that id." }, 404);

      const batch = await deps.batchStore.latestForTenant(tenantId);
      if (!batch?.orgChart) return c.json({ error: "No claimed org chart to cascade against — claim one first." }, 409);

      const previousActive = await deps.charters.getActive(tenantId);
      const cascade = generateCascade(draft.content, batch.orgChart, previousActive?.cascade);

      const installed = await deps.charters.accept(tenantId, id, cascade);
      const sync = (await deps.onAccepted?.(tenantId)) ?? null;
      return c.json({ charter: installed, sync });
    });
}
