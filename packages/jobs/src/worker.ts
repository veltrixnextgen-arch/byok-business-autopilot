import { Worker, type ConnectionOptions, type Processor } from "bullmq";
import type { TenantJobPayload } from "./types.js";

export interface WorkerConfig {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
}

/** Real incident, not a hypothetical: a job whose processor throws is
 *  caught internally by BullMQ and written to Redis's own failed-job
 *  data — the ONLY other listener this codebase ever attached (see
 *  redisErrorCircuitBreaker.ts) is `worker.on("error", ...)`, a completely
 *  different event (Redis connection health, not job outcomes). With
 *  neither wired to `"failed"`, a genuinely broken job — Acme's scheduled
 *  dispatch crashed on every single firing for three weeks — produces
 *  zero output anywhere Railway's own logs surface. This is the minimum
 *  fix: log it, so "silently wrong" becomes "loudly wrong" the same day. */
function logFailedJob(workerName: string, job: { id?: string; name: string; data: unknown } | undefined, err: Error): void {
  const tenantId = (job?.data as { tenantId?: string } | undefined)?.tenantId ?? "unknown-tenant";
  console.error(`[jobs] "${workerName}" job "${job?.name ?? "unknown"}" (id ${job?.id ?? "unknown"}, tenant ${tenantId}) failed:`, err.message);
}

export function createTenantWorker<Payload extends TenantJobPayload>(
  name: string,
  processor: Processor<Payload>,
  config: WorkerConfig,
): Worker<Payload> {
  const worker = new Worker<Payload>(name, processor, {
    connection: config.connection,
    prefix: config.prefix,
    concurrency: config.concurrency ?? 5,
  });
  worker.on("failed", (job, err) => logFailedJob(name, job, err));
  return worker;
}

/**
 * For a job that genuinely isn't scoped to one tenant — e.g. a single
 * daily digest job whose handler loops over every tenant in one
 * execution, rather than firing once per tenant the way scheduled-
 * dispatch does. createTenantWorker's `Payload extends TenantJobPayload`
 * constraint (security-architecture.md Ring 1: every tenant-scoped job
 * carries its own tenantId) doesn't apply here because there is no
 * single tenant this job belongs to — forcing a sentinel tenantId onto
 * it would be worse than just not claiming one.
 */
export function createPlatformWorker<Payload = unknown>(name: string, processor: Processor<Payload>, config: WorkerConfig): Worker<Payload> {
  const worker = new Worker<Payload>(name, processor, {
    connection: config.connection,
    prefix: config.prefix,
    concurrency: config.concurrency ?? 1,
  });
  worker.on("failed", (job, err) => logFailedJob(name, job, err));
  return worker;
}
