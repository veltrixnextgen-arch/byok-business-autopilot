import { randomUUID } from "node:crypto";
import type { GateVerdictKind } from "./gate.js";

// Same append-only pattern as packages/vault/src/auditLog.ts — every gate
// decision is logged, nothing here is ever mutated or deleted.
export interface GateAuditEvent {
  id: string;
  at: string;
  taskId: string;
  roleId: string;
  taskType: string;
  verdict: GateVerdictKind;
  reason: string;
  model?: string;
  downgradedTo?: string;
  estimatedUpperBoundUsd?: number;
}

export interface GateAuditLog {
  append(event: Omit<GateAuditEvent, "id">): void;
  all(): readonly GateAuditEvent[];
  forTask(taskId: string): readonly GateAuditEvent[];
}

export class InMemoryGateAuditLog implements GateAuditLog {
  private readonly events: GateAuditEvent[] = [];

  append(event: Omit<GateAuditEvent, "id">): void {
    this.events.push({ id: randomUUID(), ...event });
  }

  all(): readonly GateAuditEvent[] {
    return this.events;
  }

  forTask(taskId: string): readonly GateAuditEvent[] {
    return this.events.filter((e) => e.taskId === taskId);
  }
}
