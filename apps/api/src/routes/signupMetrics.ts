import { zValidator } from "@hono/zod-validator";
import type { SignupMetricsStore } from "@byok/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";

const funnelEventSchema = z.object({
  screen: z.enum(["signup", "interview", "tasks", "org_chart"]),
});

const feedbackSchema = z.object({
  taughtSomething: z.boolean(),
  freeText: z.string().max(2000).optional(),
});

/**
 * MVP-0 tester gate (Phase B Step 6C): the write side apps/web calls from
 * each screen. Behind userMiddleware (same as extractionRoute) — userId
 * always comes from the server-verified session, never the request body.
 * No read endpoint here on purpose: the aggregate view is
 * internalMetrics.ts, a separate token-gated route, not something any
 * tester's own session can query.
 */
export function signupMetricsRoute(store: Pick<SignupMetricsStore, "recordFunnelEvent" | "recordFeedback">) {
  return new Hono<AppEnv>()
    .post("/funnel-event", zValidator("json", funnelEventSchema), async (c) => {
      const { screen } = c.req.valid("json");
      await store.recordFunnelEvent(c.get("userId"), screen);
      return c.json({ ok: true });
    })
    .post("/feedback", zValidator("json", feedbackSchema), async (c) => {
      const { taughtSomething, freeText } = c.req.valid("json");
      await store.recordFeedback(c.get("userId"), taughtSomething, freeText ?? null);
      return c.json({ ok: true });
    });
}
