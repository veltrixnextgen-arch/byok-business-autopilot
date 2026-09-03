import type { ApprovalQueue } from "@byok/approval-queue";
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
  approvalQueue: Pick<ApprovalQueue, "pendingActions" | "pendingRecommendationItems" | "resolve" | "resolveRecommendation" | "acceptOffer">;
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
          // issue #159's own discipline, applied here too: a real effect
          // that failed to dispatch (e.g. Resend rejected the send) must
          // be visible, not just "dispatched: true" regardless of what
          // effectExecutor actually returned. Logged loudly server-side
          // AND returned to the caller — the UI surfaces this, not just
          // this route.
          if (result.effectResult?.success === false) {
            console.error(
              `[approvals] tenant ${tenantId} action ${id} dispatched but its effect failed: ${result.effectResult.error}`,
            );
          }
          return c.json({ resolved: true, dispatched: result.dispatched, effectResult: result.effectResult ?? null });
        }
        await deps.approvalQueue.resolveRecommendation(tenantId, id, verdict);
        return c.json({ resolved: true, dispatched: false, effectResult: null });
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
        await deps.approvalQueue.acceptOffer(tenantId, taskType);
        return c.json({ accepted: true });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Could not accept this offer." }, 404);
      }
    });
}
