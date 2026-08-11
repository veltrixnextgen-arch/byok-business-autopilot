import type { EncryptedBlob } from "./crypto.js";

// Only a router-service identity may request decryption (per the spec).
// Other kinds exist for write operations (store/rotate/revoke), which are
// less tightly restricted but still fully audited. "tenant-user" is the
// connect-screen caller (issue #15): an authenticated tenant user managing
// their OWN org's Brain key through apps/api's /me/brain-key route —
// distinct from "admin" (a platform operator), so the audit log tells the
// two apart honestly instead of collapsing every non-service write under
// one ambiguous label.
export type RequesterIdentity =
  | { kind: "router-service"; serviceId: string }
  | { kind: "onboarding-service"; serviceId: string }
  | { kind: "admin"; serviceId: string }
  | { kind: "tenant-user"; userId: string };

export class AccessDeniedError extends Error {}
export class KeyNotFoundError extends Error {}
export class ScopeBindingError extends Error {}
export class ValidationFailedError extends Error {}
export class SecretExpiredError extends Error {}

// Base fields shared by both key record types. `ciphertext/iv/authTag` are
// null after revoke — revoke PURGES the key material (Section 3: "vault
// entry purged"), not just flags it; only a tombstone remains for audit.
interface KeyRecordBase {
  id: string;
  tenantId: string;
  maskedFingerprint: string;
  createdAt: string;
  updatedAt: string;
  revoked: boolean;
  revokedAt?: string;
}

export interface BrainKeyRecord extends KeyRecordBase {
  type: "brain";
  roleId: string;
  provider: string;
  material: EncryptedBlob | null;
}

export interface HandsKeyRecord extends KeyRecordBase {
  type: "hands";
  subAgentId: string;
  capabilityScope: string;
  service: string;
  material: EncryptedBlob | null;
}

export type KeyRecord = BrainKeyRecord | HandsKeyRecord;

// Public-facing view of a key record — never includes `material`.
export type PublicKeyRecord = Omit<BrainKeyRecord, "material"> | Omit<HandsKeyRecord, "material">;

export function toPublic(record: KeyRecord): PublicKeyRecord {
  const { material: _material, ...rest } = record;
  return rest;
}

export interface AuditEvent {
  id: string;
  at: string;
  operation: "store" | "rotate" | "revoke" | "decrypt-granted" | "decrypt-denied" | "validate-failed";
  keyId: string;
  tenantId: string;
  requester?: RequesterIdentity;
  /** Free-text context. MUST NEVER contain key material — enforced by
   *  convention here (callers pass structured, non-secret strings only). */
  detail?: string;
}

export type VaultEvent = {
  type: "key.revoked";
  keyId: string;
  tenantId: string;
  keyType: "brain" | "hands";
  roleId?: string;
  subAgentId?: string;
  at: string;
};

export type VaultEventListener = (event: VaultEvent) => void;
