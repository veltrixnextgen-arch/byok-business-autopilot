import { randomUUID } from "node:crypto";
import type { AuditEvent } from "./types.js";

// Append-only, per Section 8 ("Logging hygiene ... secret-scan runs on log
// pipelines"). Storage-agnostic interface (same pattern as the router's
// dedup/ledger stores) — in-memory here, a durable/shared store is a
// follow-up once the vault runs as a real service.
export interface AuditLog {
  append(event: Omit<AuditEvent, "id">): void;
  all(): readonly AuditEvent[];
  forKey(keyId: string): readonly AuditEvent[];
}

export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];

  append(event: Omit<AuditEvent, "id">): void {
    this.events.push({ id: randomUUID(), ...event });
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }

  forKey(keyId: string): readonly AuditEvent[] {
    return this.events.filter((e) => e.keyId === keyId);
  }
}
