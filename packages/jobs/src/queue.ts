import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { TenantJobPayload } from "./types.js";

export class MissingTenantIdError extends Error {
  constructor(queueName: string) {
    super(`Job payload submitted to queue "${queueName}" is missing a tenantId.`);
    this.name = "MissingTenantIdError";
  }
}

// Structural — lets tests exercise TenantQueue's tenantId enforcement
// without opening a real Redis connection (bullmq's Queue constructor
// reaches for Redis immediately and ioredis retries indefinitely by
// default, which would hang a test run with no Redis available).
export interface QueueLike<Payload> {
  add(jobName: string, payload: Payload, opts?: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

export interface QueueConfig {
  connection: ConnectionOptions;
  prefix?: string;
}

/**
 * Runtime belt-and-suspenders on top of the TypeScript `TenantJobPayload`
 * constraint: a payload built from unvalidated input (JSON body, deep
 * object spread) can still reach `.add` without a tenantId at the type
 * level being violated at compile time — this catches that at the queue
 * boundary instead of letting it become an untenanted job silently.
 */
export class TenantQueue<Payload extends TenantJobPayload> {
  constructor(
    public readonly name: string,
    private readonly queue: QueueLike<Payload>,
  ) {}

  async add(jobName: string, payload: Payload, opts?: JobsOptions): Promise<unknown> {
    if (!payload.tenantId) {
      throw new MissingTenantIdError(this.name);
    }
    return this.queue.add(jobName, payload, opts);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createTenantQueue<Payload extends TenantJobPayload>(
  name: string,
  config: QueueConfig,
): TenantQueue<Payload> {
  const queue = new Queue<Payload>(name, { connection: config.connection, prefix: config.prefix });
  return new TenantQueue<Payload>(name, queue);
}

/** A real BullMQ `Queue` already satisfies `RepeatableQueueLike`
 *  (tenantScheduler.ts) structurally — `.add`, `.getRepeatableJobs`, and
 *  `.removeRepeatableByKey` are all native methods. This factory exists so
 *  callers (apps/api's server bootstrap) never import `bullmq` directly
 *  themselves, matching createTenantQueue's own reasoning. */
export function createRepeatableQueue(name: string, config: QueueConfig): Queue {
  return new Queue(name, { connection: config.connection, prefix: config.prefix });
}
