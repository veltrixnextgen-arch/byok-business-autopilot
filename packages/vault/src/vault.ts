import { randomUUID } from "node:crypto";
import { brainAad, decrypt, encrypt, handsAad, zeroBuffer } from "./crypto.js";
import type { Kms } from "./kms.js";
import { DekStore, DekUndecryptableError } from "./dekStore.js";
import type { DekRecordStore } from "./durable/dekRecordStore.js";
import { InMemoryDekRecordStore } from "./durable/dekRecordStore.js";
import type { VaultKeyStore } from "./durable/vaultKeyStore.js";
import { InMemoryVaultKeyStore } from "./durable/vaultKeyStore.js";
import { maskFingerprint } from "./fingerprint.js";
import { SecretHandle } from "./secretHandle.js";
import { isDevOrTestEnvironment } from "./env.js";
import { InMemoryDurableAuditLog, type DurableAuditLog, type StoredAuditEvent } from "@byok/db";
import {
  AccessDeniedError,
  HandsRefreshFailedError,
  HandsRefreshTokenRevokedError,
  KeyNotFoundError,
  ScopeBindingError,
  ValidationFailedError,
  toPublic,
} from "./types.js";
import type {
  BrainKeyRecord,
  HandsKeyRecord,
  OAuthCredential,
  PublicKeyRecord,
  RefreshedCredential,
  RequesterIdentity,
  VaultEvent,
  VaultEventListener,
} from "./types.js";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 10_000;
// Refresh this far ahead of the credential's real expiry, not exactly at
// it — closes the window where a token that reads as "still valid" when
// decryptHandsKey checks it expires for real before the actual Hands
// service call completes (network latency, provider processing time).
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Provider-agnostic OAuth token refresh (PR 2A). One implementation per
 * Hands service that uses OAuth (Google Calendar, Meta, ...) — vault.ts's
 * decryptHandsKey owns everything provider-independent (expiry check,
 * single-flight de-dup, timeout enforcement, re-encrypt-in-place, fail-
 * closed classification); a refresher owns only the one HTTP call to its
 * provider's token endpoint. This is what lets a new OAuth Hands service
 * "plug in" without touching decryptHandsKey itself — register one more
 * entry in the constructor's `handsCredentialRefreshers` map.
 */
export interface HandsCredentialRefresher {
  /** Must throw HandsRefreshTokenRevokedError specifically when the
   *  provider's response means the refresh token itself is dead (e.g.
   *  OAuth's `invalid_grant`) — any other failure (network error, 5xx,
   *  malformed response) should throw a plain Error or
   *  HandsRefreshFailedError; decryptHandsKey classifies/wraps it either
   *  way, but only HandsRefreshTokenRevokedError triggers revocation. */
  refresh(refreshToken: string): Promise<RefreshedCredential>;
}

// Bounds a promise to `ms` — rejects with `onTimeout()` if it hasn't
// settled by then, and always clears its timer so a settled promise never
// leaves a dangling handle. This is what makes "never a hang" true for a
// refresher implementation regardless of whether that implementation
// enforces its own timeout (PR 2B's real Google/Meta refreshers should,
// but this guarantees the property even if one doesn't).
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface StoreBrainKeyInput {
  tenantId: string;
  roleId: string;
  provider: string;
  plaintext: Buffer;
  /** Live validation-call hook (Section 3: "one fraction-of-a-cent test
   *  call"). Pluggable so the vault package has no direct provider-SDK
   *  dependency — the caller supplies the real check. */
  validate?: (plaintext: Buffer) => Promise<boolean>;
}

export interface StoreHandsKeyInput {
  tenantId: string;
  subAgentId: string;
  capabilityScope: string;
  service: string;
  /** For credentialKind "oauth", this is `Buffer.from(JSON.stringify(credential))`
   *  for an OAuthCredential (types.ts) — never a bare access token string. */
  plaintext: Buffer;
  validate?: (plaintext: Buffer) => Promise<boolean>;
  /** Defaults to "opaque" (a pasted static key/token, issue #22 — decrypted
   *  and handed back unchanged). "oauth" (PR 2A) makes decryptHandsKey
   *  check expiry and refresh via a registered HandsCredentialRefresher for
   *  `service` before ever returning a handle. */
  credentialKind?: "opaque" | "oauth";
}

/** The narrow interface OpenMultiAgentExecutor depends on — mockable in
 *  router tests without pulling in the whole Vault. tenantId is required
 *  (not just roleId): role ids like "cfo" are short, human-chosen slugs
 *  that are NOT globally unique across tenants — see Vault's own
 *  tenant-then-role Map for why a bare roleId lookup would let one
 *  tenant's "cfo" key collide with another's. */
export interface BrainKeyProvider {
  decryptBrainKey(tenantId: string, roleId: string, requester: RequesterIdentity): Promise<SecretHandle>;
}

/** The Hands-side counterpart to BrainKeyProvider — same purpose (a narrow,
 *  mockable seam so router-side code depends only on this package's public
 *  interface, never Vault's internals), scoped to per-sub-agent,
 *  per-capability decryption (ADR-002, T8). The caller's `requestedBy` claim
 *  becomes the decrypt's AAD (see decryptHandsKey below), so a wrong claim
 *  fails cryptographically, not just an application-level check. */
export interface HandsKeyProvider {
  /** `tenantId` scopes the lookup itself now that key records are
   *  RLS-protected Postgres rows, not a flat in-memory Map — every real
   *  caller (handsTool.ts) already has it in scope at the call site. */
  decryptHandsKey(
    tenantId: string,
    keyId: string,
    requestedBy: { subAgentId: string; capabilityScope: string },
    requester: RequesterIdentity,
  ): Promise<SecretHandle>;
  /** Pre-flight lookup (issue #22's just-in-time gate): does a connected
   *  Hands key exist for this scope, and if so what's its id — so a
   *  caller can both decide "can I even offer this tool right now" AND,
   *  if so, go straight to decryptHandsKey(keyId, ...) without a second
   *  round trip. Deliberately just an id, not the full PublicKeyRecord
   *  (no fingerprint/timestamps) — those belong to a status route, not
   *  this hot pre-flight path. No requester identity check here (unlike
   *  decryptHandsKey) — knowing whether a key merely EXISTS carries none
   *  of the risk that decrypting it does. */
  resolveHandsKeyId(tenantId: string, subAgentId: string, capabilityScope: string): Promise<string | null>;
}

function assertRouterServiceIdentity(requester: RequesterIdentity): void {
  if (requester.kind !== "router-service") {
    throw new AccessDeniedError(
      `Only a router-service identity may request decryption (got "${requester.kind}").`,
    );
  }
}

function now(): string {
  return new Date().toISOString();
}

// #149: Vault's audit trail (key store/rotate/revoke/decrypt-granted/
// decrypt-denied — who touched which tenant's key, and when) used to be a
// bespoke, always-in-memory AuditLog with no durable counterpart at all.
// It's now the same shared, tenant-scoped DurableAuditLog every other
// trust-core audit trail writes through (packages/db's audit_log table,
// source="vault") — durableTrustCore.ts passes a real PostgresDurableAuditLog
// for any deployed environment. This guard is why: an omitted `audit`
// argument outside dev/test would otherwise silently fall back to an
// in-memory instance whose entire audit trail vanishes on the next
// restart — exactly the gap this issue closed. `InMemoryDurableAuditLog`
// itself lives in @byok/db and stays unguarded there (it's a generic,
// reusable in-memory implementation of the shared interface, used the
// same way by cost-gate and approval-queue's own tests) — the guard
// belongs here, at the one call site that decides whether defaulting to
// it is safe for THIS deployment.
export class DevOnlyVaultAuditGuardError extends Error {}

function defaultAuditLog(): DurableAuditLog {
  if (!isDevOrTestEnvironment()) {
    throw new DevOnlyVaultAuditGuardError(
      "Vault cannot default its audit log to an in-memory store outside a dev or test environment — " +
        "pass a real DurableAuditLog (e.g. PostgresDurableAuditLog) for any deployed environment.",
    );
  }
  return new InMemoryDurableAuditLog();
}

export class Vault implements BrainKeyProvider, HandsKeyProvider {
  private readonly dekStore: DekStore;
  private readonly audit: DurableAuditLog;
  private readonly listeners: VaultEventListener[] = [];
  // In-flight OAuth refresh promises, keyed by Hands key id. A second
  // decryptHandsKey call for the SAME expired key while a refresh is
  // already running awaits this same promise instead of starting its own
  // — verified necessary, not speculative: @open-multi-agent/core's
  // ToolExecutor.executeBatch runs a turn's tool calls concurrently
  // (Promise.all + a 4-way semaphore, dist/tool/executor.js), so an LLM
  // that calls the same Hands tool twice in one turn really can reach
  // decryptHandsKey twice before either finishes (docs/DECISIONS.md
  // ADR-020). Deliberately still in-process/in-memory even now that key
  // STORAGE is durable — this coalesces concurrent requests within one
  // process's lifetime, not something that needs to survive a restart;
  // losing it on restart just means duplicate refresh calls, not data loss.
  private readonly inFlightRefreshes = new Map<string, Promise<OAuthCredential>>();

  constructor(
    kms: Kms,
    audit?: DurableAuditLog,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly handsCredentialRefreshers: ReadonlyMap<string, HandsCredentialRefresher> = new Map(),
    private readonly refreshTimeoutMs: number = DEFAULT_REFRESH_TIMEOUT_MS,
    // Both default to in-memory (dev/test only, see durable/*.ts's own
    // guards) — durableTrustCore.ts/devTrustCore.ts pass real Postgres
    // stores for any deployed environment. Key records and the DEK that
    // encrypts them are two separate stores (dekRecordStore threads
    // through to DekStore below) because losing one without the other is
    // exactly the half-fixed state that leaves everything permanently
    // undecryptable — see dekStore.ts's own comment.
    private readonly store: VaultKeyStore = new InMemoryVaultKeyStore(),
    dekRecordStore: DekRecordStore = new InMemoryDekRecordStore(),
  ) {
    this.dekStore = new DekStore(kms, dekRecordStore);
    this.audit = audit ?? defaultAuditLog();
  }

  onEvent(listener: VaultEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: Omit<VaultEvent, "at">): void {
    const full: VaultEvent = { ...event, at: now() };
    for (const listener of this.listeners) listener(full);
  }

  private async logAudit(kind: string, tenantId: string, refId: string, detail?: Record<string, unknown>): Promise<void> {
    await this.audit.append({ tenantId, source: "vault", kind, refId, detail });
  }

  /** tenantId-scoped, most-recent-first — mirrors DurableAuditLog.recentForTenant
   *  exactly (no wider "every tenant" read exists, matching every other
   *  durable store in this codebase, and RLS would refuse one anyway). */
  async auditEvents(tenantId: string, limit?: number): Promise<readonly StoredAuditEvent[]> {
    return this.audit.recentForTenant(tenantId, limit);
  }

  /** ADR-032: the write-side half of DekUndecryptableError handling —
   *  store/rotate calls need a DEK to encrypt something NEW under, so an
   *  undecryptable existing one is recoverable here: discard it and
   *  start fresh. Read paths (decryptBrainKey/decryptHandsKey/
   *  verifyBrainKeyDecryptable) must NOT use this — see
   *  DekStore.getOrCreateDek's own comment for why recreating on a read
   *  would be a pointless, surprising side effect. */
  private async getDekForWrite(tenantId: string): Promise<Buffer> {
    try {
      return await this.dekStore.getOrCreateDek(tenantId);
    } catch (err) {
      if (err instanceof DekUndecryptableError) {
        return this.dekStore.discardAndRecreateDek(tenantId);
      }
      throw err;
    }
  }

  // ---- Brain keys (per-tenant, per-role, ADR-002) -----------------------

  async storeBrainKey(input: StoreBrainKeyInput, requester: RequesterIdentity): Promise<PublicKeyRecord> {
    await this.runValidation(input.plaintext, input.validate, input.tenantId, requester);

    const dek = await this.getDekForWrite(input.tenantId);
    const aad = brainAad(input.roleId, input.provider);
    const material = encrypt(input.plaintext, dek, aad);

    const record: BrainKeyRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      type: "brain",
      roleId: input.roleId,
      provider: input.provider,
      material,
      maskedFingerprint: maskFingerprint(input.plaintext),
      revoked: false,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.putBrainKey(record);
    await this.logAudit("store", input.tenantId, record.id, { requester });
    return toPublic(record);
  }

  async rotateBrainKey(
    tenantId: string,
    roleId: string,
    newPlaintext: Buffer,
    requester: RequesterIdentity,
    validate?: (plaintext: Buffer) => Promise<boolean>,
  ): Promise<PublicKeyRecord> {
    const record = await this.store.getBrainKey(tenantId, roleId);
    if (!record || record.revoked) throw new KeyNotFoundError(`No active Brain key for role "${roleId}".`);

    await this.runValidation(newPlaintext, validate, record.tenantId, requester);

    const dek = await this.getDekForWrite(record.tenantId);
    record.material = encrypt(newPlaintext, dek, brainAad(record.roleId, record.provider));
    record.maskedFingerprint = maskFingerprint(newPlaintext);
    record.updatedAt = now();
    await this.store.updateBrainKey(record);

    await this.logAudit("rotate", record.tenantId, record.id, { requester });
    return toPublic(record);
  }

  async revokeBrainKey(tenantId: string, roleId: string, requester: RequesterIdentity): Promise<void> {
    const record = await this.store.getBrainKey(tenantId, roleId);
    if (!record) throw new KeyNotFoundError(`No Brain key for role "${roleId}".`);

    record.material = null; // purge — Section 3: "vault entry purged"
    record.revoked = true;
    record.revokedAt = now();
    record.updatedAt = now();
    await this.store.updateBrainKey(record);

    await this.logAudit("revoke", record.tenantId, record.id, { requester });
    this.emit({ type: "key.revoked", keyId: record.id, tenantId: record.tenantId, keyType: "brain", roleId });
  }

  /** Status only — never returns material, safe for a route to expose
   *  directly (issue #15's "is a key already connected" check).
   *
   *  Deliberately does NOT attempt decryption — a row existing and not
   *  being revoked is a cheap, purely-metadata fact. Whether the key
   *  material behind that row can still actually be decrypted is a
   *  DIFFERENT question this method does not answer — see
   *  verifyBrainKeyDecryptable below, added specifically because
   *  "connected" reading true while decryption is silently broken (found
   *  live: a rotated KMS master key orphans every DEK with zero visible
   *  symptom until something tries to decrypt) is the same "reports
   *  healthy, is broken" shape this codebase has hit multiple times now.
   *  A caller wanting an honest signal should check both. */
  async getBrainKeyStatus(tenantId: string, roleId: string): Promise<PublicKeyRecord | null> {
    const record = await this.store.getBrainKey(tenantId, roleId);
    return record && !record.revoked ? toPublic(record) : null;
  }

  /** ADR-031: the real decrypt-path health check `getBrainKeyStatus`
   *  deliberately isn't. Runs the exact same DEK-fetch + AES-GCM-decrypt
   *  path `decryptBrainKey` does, immediately zeroes the recovered
   *  plaintext, and returns only whether it succeeded — never the
   *  material itself, so this carries none of `decryptBrainKey`'s
   *  requester-identity restriction (there is nothing here for a caller
   *  to misuse). Both the DEK's own decrypt (fails if the KMS master key
   *  that encrypted it is no longer the one configured — exactly the
   *  rotated-master-key scenario this was built to catch) and the
   *  material's decrypt (fails on any other corruption/tamper) have to
   *  succeed for this to return true. A missing or revoked record is
   *  `false`, not an error — "can I decrypt this" is vacuously false for
   *  a key that was never usable in the first place, matching
   *  getBrainKeyStatus's own not-found-or-revoked-reads-as-absent
   *  convention. */
  async verifyBrainKeyDecryptable(tenantId: string, roleId: string): Promise<boolean> {
    const record = await this.store.getBrainKey(tenantId, roleId);
    if (!record || record.revoked || !record.material) return false;
    try {
      const dek = await this.dekStore.getOrCreateDek(record.tenantId);
      const plaintext = decrypt(record.material, dek, brainAad(record.roleId, record.provider));
      zeroBuffer(plaintext);
      return true;
    } catch {
      return false;
    }
  }

  async decryptBrainKey(tenantId: string, roleId: string, requester: RequesterIdentity): Promise<SecretHandle> {
    assertRouterServiceIdentity(requester);
    const record = await this.store.getBrainKey(tenantId, roleId);
    if (!record || record.revoked || !record.material) {
      await this.logAudit("decrypt-denied", record?.tenantId ?? tenantId, record?.id ?? `role:${roleId}`, {
        requester,
        reason: "not found or revoked",
      });
      throw new KeyNotFoundError(`No active Brain key for role "${roleId}".`);
    }

    const dek = await this.dekStore.getOrCreateDek(record.tenantId);
    const plaintext = decrypt(record.material, dek, brainAad(record.roleId, record.provider));
    await this.logAudit("decrypt-granted", record.tenantId, record.id, { requester });
    return new SecretHandle(plaintext, this.ttlMs);
  }

  // ---- Hands keys (per-sub-agent + per-capability, ADR-002, T8) --------

  async storeHandsKey(input: StoreHandsKeyInput, requester: RequesterIdentity): Promise<PublicKeyRecord> {
    await this.runValidation(input.plaintext, input.validate, input.tenantId, requester);

    const dek = await this.getDekForWrite(input.tenantId);
    const aad = handsAad(input.subAgentId, input.capabilityScope);
    const material = encrypt(input.plaintext, dek, aad);

    const record: HandsKeyRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      type: "hands",
      subAgentId: input.subAgentId,
      capabilityScope: input.capabilityScope,
      service: input.service,
      material,
      maskedFingerprint: maskFingerprint(input.plaintext),
      revoked: false,
      credentialKind: input.credentialKind ?? "opaque",
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.putHandsKey(record);
    await this.logAudit("store", input.tenantId, record.id, { requester });
    return toPublic(record);
  }

  /** Status only — never returns material, safe for a route to expose
   *  directly (mirrors getBrainKeyStatus, issue #22's "is this Hands tool
   *  already connected" check). */
  async getHandsKeyStatus(tenantId: string, subAgentId: string, capabilityScope: string): Promise<PublicKeyRecord | null> {
    const keyId = await this.store.resolveHandsKeyId(tenantId, subAgentId, capabilityScope);
    const record = keyId ? await this.store.getHandsKeyById(tenantId, keyId) : null;
    return record && !record.revoked ? toPublic(record) : null;
  }

  async resolveHandsKeyId(tenantId: string, subAgentId: string, capabilityScope: string): Promise<string | null> {
    return this.store.resolveHandsKeyId(tenantId, subAgentId, capabilityScope);
  }

  async rotateHandsKey(
    tenantId: string,
    keyId: string,
    newPlaintext: Buffer,
    requester: RequesterIdentity,
    validate?: (plaintext: Buffer) => Promise<boolean>,
  ): Promise<PublicKeyRecord> {
    const record = await this.store.getHandsKeyById(tenantId, keyId);
    if (!record || record.revoked) throw new KeyNotFoundError(`No active Hands key "${keyId}".`);

    await this.runValidation(newPlaintext, validate, record.tenantId, requester);

    const dek = await this.getDekForWrite(record.tenantId);
    record.material = encrypt(newPlaintext, dek, handsAad(record.subAgentId, record.capabilityScope));
    record.maskedFingerprint = maskFingerprint(newPlaintext);
    record.updatedAt = now();
    await this.store.updateHandsKey(record);

    await this.logAudit("rotate", record.tenantId, record.id, { requester });
    return toPublic(record);
  }

  async revokeHandsKey(tenantId: string, keyId: string, requester: RequesterIdentity): Promise<void> {
    const record = await this.store.getHandsKeyById(tenantId, keyId);
    if (!record) throw new KeyNotFoundError(`No Hands key "${keyId}".`);

    record.material = null;
    record.revoked = true;
    record.revokedAt = now();
    record.updatedAt = now();
    await this.store.updateHandsKey(record);

    await this.logAudit("revoke", record.tenantId, record.id, { requester });
    this.emit({
      type: "key.revoked",
      keyId: record.id,
      tenantId: record.tenantId,
      keyType: "hands",
      subAgentId: record.subAgentId,
    });
  }

  /**
   * Decrypt a Hands key. The caller must CLAIM the sub-agent + capability
   * scope it believes it's entitled to — that claim becomes the AAD, so a
   * wrong claim fails cryptographically (ScopeBindingError), not just an
   * application-level permission check. This is what makes "an agent can
   * never enumerate or borrow another agent's Hands" (T8) true even if the
   * lookup-by-id step were somehow bypassed.
   */
  async decryptHandsKey(
    tenantId: string,
    keyId: string,
    requestedBy: { subAgentId: string; capabilityScope: string },
    requester: RequesterIdentity,
  ): Promise<SecretHandle> {
    assertRouterServiceIdentity(requester);
    const record = await this.store.getHandsKeyById(tenantId, keyId);
    if (!record || record.revoked || !record.material) {
      await this.logAudit("decrypt-denied", record?.tenantId ?? "unknown", keyId, {
        requester,
        reason: "not found or revoked",
      });
      throw new KeyNotFoundError(`No active Hands key "${keyId}".`);
    }

    const dek = await this.dekStore.getOrCreateDek(record.tenantId);
    const claimedAad = handsAad(requestedBy.subAgentId, requestedBy.capabilityScope);

    let plaintext: Buffer;
    try {
      plaintext = decrypt(record.material, dek, claimedAad);
    } catch {
      await this.logAudit("decrypt-denied", record.tenantId, keyId, {
        requester,
        reason: `scope-binding mismatch: claimed ${requestedBy.subAgentId}:${requestedBy.capabilityScope}`,
      });
      throw new ScopeBindingError(
        `Hands key "${keyId}" is not bound to subAgentId="${requestedBy.subAgentId}", ` +
          `capabilityScope="${requestedBy.capabilityScope}".`,
      );
    }

    // Opaque (default, issue #22): unchanged behavior — hand the decrypted
    // bytes straight back, no expiry/refresh concept applies.
    if (record.credentialKind !== "oauth") {
      await this.logAudit("decrypt-granted", record.tenantId, keyId, {
        requester,
        scope: `${requestedBy.subAgentId}:${requestedBy.capabilityScope}`,
      });
      return new SecretHandle(plaintext, this.ttlMs);
    }

    // OAuth (PR 2A): plaintext is the JSON-serialized OAuthCredential, not
    // itself the thing a Hands tool should ever see — parse it, zero the
    // raw buffer immediately (it carries the refreshToken, which must
    // never reach a tool's invoke() the way a plain accessToken does), and
    // hand back a fresh SecretHandle wrapping ONLY the access token.
    let credential: OAuthCredential;
    try {
      credential = JSON.parse(plaintext.toString("utf8")) as OAuthCredential;
    } finally {
      zeroBuffer(plaintext);
    }

    const freshCredential = this.credentialIsExpired(credential)
      ? await this.getOrRefreshCredential(keyId, record, credential, requester)
      : credential;

    await this.logAudit("decrypt-granted", record.tenantId, keyId, {
      requester,
      scope: `${requestedBy.subAgentId}:${requestedBy.capabilityScope}`,
    });
    return new SecretHandle(Buffer.from(freshCredential.accessToken, "utf8"), this.ttlMs);
  }

  private credentialIsExpired(credential: OAuthCredential): boolean {
    if (!credential.expiresAt) return false; // no expiry info -> defensively treat as non-expiring
    return Date.parse(credential.expiresAt) - Date.now() <= EXPIRY_SAFETY_MARGIN_MS;
  }

  // Single-flight: a second caller for the same keyId while a refresh is
  // already in progress awaits THIS SAME promise rather than starting a
  // second refresh call against the provider (ADR-020) — every concurrent
  // caller gets the same resolved credential or the same thrown error,
  // whichever this one settled to.
  private getOrRefreshCredential(
    keyId: string,
    record: HandsKeyRecord,
    credential: OAuthCredential,
    requester: RequesterIdentity,
  ): Promise<OAuthCredential> {
    let inFlight = this.inFlightRefreshes.get(keyId);
    if (!inFlight) {
      inFlight = this.performRefresh(record, credential, requester).finally(() => {
        this.inFlightRefreshes.delete(keyId);
      });
      this.inFlightRefreshes.set(keyId, inFlight);
    }
    return inFlight;
  }

  // Fail-closed on every path: this either resolves with a genuinely fresh
  // credential or rejects — there is no branch that returns a stale/expired
  // accessToken. Bounded by withTimeout so a hanging provider call can
  // never hang the caller. A single attempt, no internal retry loop — a
  // transient failure surfaces immediately as a draft-mode result (via
  // handsTool.ts's catch -> OpenMultiAgentExecutor's missingHands, see
  // ADR-020) rather than this method silently hammering the provider's
  // token endpoint.
  private async performRefresh(
    record: HandsKeyRecord,
    credential: OAuthCredential,
    requester: RequesterIdentity,
  ): Promise<OAuthCredential> {
    if (!credential.refreshToken) {
      throw new HandsRefreshFailedError(
        `Hands key "${record.id}" (${record.service}) expired and has no refresh token — cannot refresh.`,
      );
    }
    const refresher = this.handsCredentialRefreshers.get(record.service);
    if (!refresher) {
      throw new HandsRefreshFailedError(`No credential refresher registered for service "${record.service}".`);
    }

    let result: RefreshedCredential;
    try {
      result = await withTimeout(
        refresher.refresh(credential.refreshToken),
        this.refreshTimeoutMs,
        () => new HandsRefreshFailedError(`Refreshing "${record.service}" credential timed out after ${this.refreshTimeoutMs}ms.`),
      );
    } catch (err) {
      if (err instanceof HandsRefreshTokenRevokedError) {
        // Durable, not transient: the provider says this refresh token can
        // never work again. Revoke for real — same purge + audit + emit
        // path a manual revoke uses (#22/#37's revoke-cancels-queued
        // listener fires identically) — rather than leaving a "connected"
        // key that fails the same way on every future call.
        await this.revokeHandsKey(record.tenantId, record.id, requester);
        throw err;
      }
      if (err instanceof HandsRefreshFailedError) throw err;
      throw new HandsRefreshFailedError(`Refreshing "${record.service}" credential failed: ${(err as Error).message}`);
    }

    const refreshed: OAuthCredential = {
      accessToken: result.accessToken,
      refreshToken: credential.refreshToken,
      expiresAt: result.expiresAt,
      scope: credential.scope,
    };

    // Re-encrypt in place — SAME record id, SAME AAD scope-binding. Any
    // caller already holding this key id (a Hands tool spec, a status
    // check) keeps working unchanged; only the material behind it rotates.
    const dek = await this.getDekForWrite(record.tenantId);
    record.material = encrypt(Buffer.from(JSON.stringify(refreshed), "utf8"), dek, handsAad(record.subAgentId, record.capabilityScope));
    record.updatedAt = now();
    await this.store.updateHandsKey(record);
    // maskedFingerprint deliberately untouched — it's the user-visible
    // "you connected this" identity from the initial store, not a live
    // reflection of the access token, which rotates silently and often;
    // updating it here would make the UI's masked fingerprint flicker on
    // every background refresh for no reason the user did anything.
    await this.logAudit("rotate", record.tenantId, record.id, {
      requester,
      reason: `silent OAuth refresh (${record.service})`,
    });

    return refreshed;
  }

  // ---- shared -----------------------------------------------------------

  private async runValidation(
    plaintext: Buffer,
    validate: ((plaintext: Buffer) => Promise<boolean>) | undefined,
    tenantId: string,
    requester: RequesterIdentity,
  ): Promise<void> {
    if (!validate) return;
    const ok = await validate(plaintext);
    if (!ok) {
      await this.logAudit("validate-failed", tenantId, "pending", { requester });
      throw new ValidationFailedError("Live validation call failed — key was not stored.");
    }
  }
}
