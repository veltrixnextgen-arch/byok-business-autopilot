import type { LedgerEntry, RouterTaskStatus } from "./types.js";

// Append-only, per-sub-agent journal of every status transition a task
// went through. This is the audit trail the dashboard's "cost and activity
// per role AND per sub-agent" (roles-and-api-key-guide.md Screen 16) reads
// from, and what earned-autonomy counting (N approvals) will be built on.
export interface TaskLedger {
  append(entry: LedgerEntry): void;
  entriesFor(subAgentId: string): readonly LedgerEntry[];
  allEntries(): readonly LedgerEntry[];
}

export class InMemoryTaskLedger implements TaskLedger {
  private readonly entries: LedgerEntry[] = [];

  append(entry: LedgerEntry): void {
    this.entries.push(entry);
  }

  entriesFor(subAgentId: string): readonly LedgerEntry[] {
    return this.entries.filter((e) => e.subAgentId === subAgentId);
  }

  allEntries(): readonly LedgerEntry[] {
    return this.entries;
  }

  /** Count of entries with a given status for a sub-agent — e.g. how many
   *  times a task type has completed, for earned-autonomy thresholds. */
  countByStatus(subAgentId: string, status: RouterTaskStatus): number {
    return this.entriesFor(subAgentId).filter((e) => e.status === status).length;
  }
}
