import type { RouterTask } from "./types.js";

// Idempotency store: resubmitting a task with a dedupKey already seen
// returns the existing (possibly still in-flight) task instead of creating
// and executing a new one. Interface kept storage-agnostic — this in-memory
// implementation is correct for a single-process router; a durable/shared
// store is a Phase A follow-up once the router runs as a real service.
export interface DedupStore {
  get(dedupKey: string): RouterTask | undefined;
  set(dedupKey: string, task: RouterTask): void;
}

export class InMemoryDedupStore implements DedupStore {
  private readonly byKey = new Map<string, RouterTask>();

  get(dedupKey: string): RouterTask | undefined {
    return this.byKey.get(dedupKey);
  }

  set(dedupKey: string, task: RouterTask): void {
    this.byKey.set(dedupKey, task);
  }
}
