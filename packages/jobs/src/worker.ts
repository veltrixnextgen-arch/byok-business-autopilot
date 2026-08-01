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
