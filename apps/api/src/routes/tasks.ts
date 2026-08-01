import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, TrustCoreDeps } from "../context.js";

const submitTaskSchema = z.object({
  subAgentId: z.string().min(1),
  teamId: z.string().min(1),
  title: z.string().min(1),
  payload: z.string().min(1),
  dedupKey: z.string().min(1),
  model: z.string().optional(),
});

/**
 * The one example route proving the integration seam end to end: a typed,
 * validated request body goes in, and the ONLY trust-core touchpoint is
 * `deps.router.submitTask` — the public export of `@byok/router`. tenantId
 * comes from `c.get("tenantId")` (set by tenantMiddleware from the
 * server-verified session), never from the request body, so a caller can't
 * submit a task into another tenant's queue by editing the JSON payload.
 */
export function tasksRoute(deps: Pick<TrustCoreDeps, "router">) {
  return new Hono<AppEnv>().post("/", zValidator("json", submitTaskSchema), async (c) => {
    const body = c.req.valid("json");
    const tenantId = c.get("tenantId");

    const task = await deps.router.submitTask({ ...body, tenantId });
    return c.json({ task }, 201);
  });
}
