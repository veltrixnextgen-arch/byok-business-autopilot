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

// OAuth refresh (PR 2A, ADR-020). Two distinct failure shapes on purpose:
// HandsRefreshFailedError is transient/ambiguous (network error, timeout,
// misconfiguration, an unrecognized provider error) — the credential MIGHT
// still be good, so the stored key is left alone and a later call can try
// again. HandsRefreshTokenRevokedError is a provider's explicit, durable
// signal that the refresh token itself is dead (e.g. OAuth's invalid_grant)
// — retrying can never succeed, so decryptHandsKey revokes the stored key
// for real (same purge-and-notify path as a manual revoke) rather than
// leaving a permanently-broken "connected" key that fails identically
// forever. Both always end the same way for the caller: no SecretHandle is
// ever returned, no matter which one is thrown — see decryptHandsKey.
export class HandsRefreshFailedError extends Error {}
export class HandsRefreshTokenRevokedError extends Error {}

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
  /** "opaque" (default, issue #22): `material` decrypts straight to the
   *  pasted secret, handed to SecretHandle unchanged. "oauth" (PR 2A):
   *  `material` decrypts to a JSON-serialized OAuthCredential — only
   *  "oauth" records ever go through decryptHandsKey's expiry/refresh
   *  path. Set once at storeHandsKey time, never changed by a refresh. */
  credentialKind: "opaque" | "oauth";
}

// The plaintext shape behind an "oauth" HandsKeyRecord once decrypted.
// Never handed to a caller directly — decryptHandsKey extracts only
// accessToken into the returned SecretHandle; refreshToken never leaves
// the vault package (see decryptHandsKey's zeroBuffer call on the raw
// parsed blob).
export interface OAuthCredential {
  accessToken: string;
  /** Absent means "this credential cannot be refreshed" — an expired
   *  credential with no refreshToken fails closed immediately (see
   *  vault.ts's getOrRefresh), never attempts a refresher call. */
  refreshToken?: string;
  /** ISO 8601. Absent is treated as "never expires" — defensive, not
   *  expected for a real OAuth credential, but keeps decryptHandsKey from
   *  throwing on a malformed/legacy record instead of just not refreshing
   *  one that doesn't need it. */
  expiresAt?: string;
  scope?: string;
}

// What a provider-specific HandsCredentialRefresher (vault.ts) returns on a
// successful refresh — deliberately narrower than OAuthCredential: a
// refresher's only job is turning a refreshToken into a new accessToken +
// expiry, never touching refreshToken/scope itself (PR 2A's generic
// orchestration owns preserving those across the refresh).
export interface RefreshedCredential {
  accessToken: string;
  expiresAt: string;
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
