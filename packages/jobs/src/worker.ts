import { Worker, type ConnectionOptions, type Processor } from "bullmq";
import type { TenantJobPayload } from "./types.js";

export interface WorkerConfig {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
}

export function createTenantWorker<Payload extends TenantJobPayload>(
  name: string,
  processor: Processor<Payload>,
  config: WorkerConfig,
): Worker<Payload> {
  return new Worker<Payload>(name, processor, {
    connection: config.connection,
    prefix: config.prefix,
    concurrency: config.concurrency ?? 5,
  });
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
  return new Worker<Payload>(name, processor, {
    connection: config.connection,
    prefix: config.prefix,
    concurrency: config.concurrency ?? 1,
  });
}
