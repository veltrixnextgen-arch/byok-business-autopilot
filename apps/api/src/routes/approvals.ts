import type { ApprovalQueue, DurableAutonomyStore } from "@byok/approval-queue";
import { UnknownActionError, UnknownRecommendationError } from "@byok/approval-queue";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { buildApprovalsView, type ApprovalsViewDeps } from "../approvals/buildApprovalsView.js";

const verdictSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("APPROVE") }),
  z.object({ kind: z.literal("REJECT"), feedback: z.string().min(1) }),
  z.object({ kind: z.literal("MODIFY"), editedOutput: z.string().min(1) }),
]);

const resolveSchema = z.object({
  kind: z.enum(["action", "recommendation"]),
  verdict: verdictSchema,
});

export interface ApprovalsRouteDeps extends ApprovalsViewDeps {
  approvalQueue: Pick<ApprovalQueue, "pendingActions" | "pendingRecommendationItems" | "resolve" | "resolveRecommendation">;
  /**
   * NOT the same thing as `deps.approvalQueue.autonomy` (the live,
   * in-memory AutonomyEngine every actual dispatch decision reads —
   * see queue.ts). This is the durable Postgres store
   * (autonomyStore.ts), read here only for stateFor()/acceptOffer().
   *
   * KNOWN GAP, flagged deliberately rather than silently worked around:
   * ApprovalQueue's real bypass-check (submitProposedAction) consults
   * the in-memory AutonomyEngine, which is never written to this table.
   * So accepting an offer here durably records `active = true` in
   * autonomy_counters, but has NO effect on live dispatch behavior until
   * ApprovalQueue itself is rewired to read from a DurableAutonomyStore
   * instead of the in-memory engine — a separate, real trust-core change,
   * not something this route can or should paper over.
   */
  autonomyStore: Pick<DurableAutonomyStore, "acceptOffer">;
}

export function approvalsRoute(deps: ApprovalsRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const view = await buildApprovalsView(deps, tenantId);
      return c.json(view);
    })
    .get("/count", async (c) => {
      const tenantId = c.get("tenantId");
      const [actions, recommendations] = await Promise.all([
        deps.approvalQueue.pendingActions(tenantId),
        deps.approvalQueue.pendingRecommendationItems(tenantId),
      ]);
      return c.json({ count: actions.length + recommendations.length });
    })
    .post("/:id/resolve", zValidator("json", resolveSchema), async (c) => {
      const tenantId = c.get("tenantId");
      const id = c.req.param("id");
      const { kind, verdict } = c.req.valid("json");

      // A recommendation never dispatches anything (T10) — "modify the
      // output" has nothing to substitute into, unlike an action's real
      // effect dispatch. Reject before ever touching the store, not
      // silently accepted-and-ignored.
      if (kind === "recommendation" && verdict.kind === "MODIFY") {
        return c.json({ error: "Recommendations can't be modified — they're guidance only and never dispatch anything." }, 400);
      }

      try {
        if (kind === "action") {
          const result = await deps.approvalQueue.resolve(tenantId, id, verdict);
          return c.json({ resolved: true, dispatched: result.dispatched });
        }
        await deps.approvalQueue.resolveRecommendation(tenantId, id, verdict);
        return c.json({ resolved: true, dispatched: false });
      } catch (err) {
        if (err instanceof UnknownActionError || err instanceof UnknownRecommendationError) {
          return c.json({ error: err.message }, 404);
        }
        throw err;
      }
    })
    .post("/autonomy/:taskType/accept", async (c) => {
      const tenantId = c.get("tenantId");
      const taskType = c.req.param("taskType");
      try {
        await deps.autonomyStore.acceptOffer(tenantId, taskType);
        return c.json({ accepted: true });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Could not accept this offer." }, 404);
      }
    });
}
