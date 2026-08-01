import { randomUUID } from "node:crypto";

// Same append-only pattern as packages/vault and packages/cost-gate.
export interface QueueAuditEvent {
  id: string;
  at: string;
  actionId: string;
  tenantId: string;
  taskType?: string;
  kind:
    | "queued"
    | "auto-approved"
    | "APPROVE"
    | "REJECT"
    | "MODIFY"
    | "recommendation-submitted"
    | "recommendation-resolved";
  detail?: string;
}

export interface QueueAuditLog {
  append(event: Omit<QueueAuditEvent, "id">): void;
  all(): readonly QueueAuditEvent[];
  forAction(actionId: string): readonly QueueAuditEvent[];
}

export class InMemoryQueueAuditLog implements QueueAuditLog {
  private readonly events: QueueAuditEvent[] = [];

  append(event: Omit<QueueAuditEvent, "id">): void {
    this.events.push({ id: randomUUID(), ...event });
  }

  all(): readonly QueueAuditEvent[] {
    return this.events;
  }

  forAction(actionId: string): readonly QueueAuditEvent[] {
    return this.events.filter((e) => e.actionId === actionId);
  }
}
