import { randomUUID } from "node:crypto";
import { brainAad, decrypt, encrypt, handsAad } from "./crypto.js";
import type { Kms } from "./kms.js";
import { DekStore } from "./dekStore.js";
import { maskFingerprint } from "./fingerprint.js";
import { SecretHandle } from "./secretHandle.js";
import type { AuditLog } from "./auditLog.js";
import { InMemoryAuditLog } from "./auditLog.js";
import {
  AccessDeniedError,
  KeyNotFoundError,
  ScopeBindingError,
  ValidationFailedError,
  toPublic,
} from "./types.js";
import type {
  BrainKeyRecord,
  HandsKeyRecord,
  PublicKeyRecord,
  RequesterIdentity,
  VaultEvent,
  VaultEventListener,
} from "./types.js";

const DEFAULT_TTL_MS = 60_000;

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
  plaintext: Buffer;
  validate?: (plaintext: Buffer) => Promise<boolean>;
}

/** The narrow interface OpenMultiAgentExecutor depends on — mockable in
 *  router tests without pulling in the whole Vault. */
export interface BrainKeyProvider {
  decryptBrainKey(roleId: string, requester: RequesterIdentity): Promise<SecretHandle>;
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

export class Vault implements BrainKeyProvider {
  private readonly dekStore: DekStore;
  private readonly brainKeysByRole = new Map<string, BrainKeyRecord>();
  private readonly handsKeysById = new Map<string, HandsKeyRecord>();
  private readonly listeners: VaultEventListener[] = [];

  constructor(
    kms: Kms,
    private readonly audit: AuditLog = new InMemoryAuditLog(),
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {
    this.dekStore = new DekStore(kms);
  }

  onEvent(listener: VaultEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: Omit<VaultEvent, "at">): void {
    const full: VaultEvent = { ...event, at: now() };
    for (const listener of this.listeners) listener(full);
  }

  auditEvents(): readonly ReturnType<AuditLog["all"]>[number][] {
    return this.audit.all();
  }

  // ---- Brain keys (per-role, ADR-002) ----------------------------------

  async storeBrainKey(input: StoreBrainKeyInput, requester: RequesterIdentity): Promise<PublicKeyRecord> {
    await this.runValidation(input.plaintext, input.validate, input.tenantId, requester);

    const dek = await this.dekStore.getOrCreateDek(input.tenantId);
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
    this.brainKeysByRole.set(input.roleId, record);
    this.audit.append({ operation: "store", keyId: record.id, tenantId: input.tenantId, requester, at: now() });
    return toPublic(record);
  }

  async rotateBrainKey(
    roleId: string,
    newPlaintext: Buffer,
    requester: RequesterIdentity,
    validate?: (plaintext: Buffer) => Promise<boolean>,
  ): Promise<PublicKeyRecord> {
    const record = this.brainKeysByRole.get(roleId);
    if (!record || record.revoked) throw new KeyNotFoundError(`No active Brain key for role "${roleId}".`);

    await this.runValidation(newPlaintext, validate, record.tenantId, requester);

    const dek = await this.dekStore.getOrCreateDek(record.tenantId);
    record.material = encrypt(newPlaintext, dek, brainAad(record.roleId, record.provider));
    record.maskedFingerprint = maskFingerprint(newPlaintext);
    record.updatedAt = now();

    this.audit.append({ operation: "rotate", keyId: record.id, tenantId: record.tenantId, requester, at: now() });
    return toPublic(record);
  }

  async revokeBrainKey(roleId: string, requester: RequesterIdentity): Promise<void> {
    const record = this.brainKeysByRole.get(roleId);
    if (!record) throw new KeyNotFoundError(`No Brain key for role "${roleId}".`);

    record.material = null; // purge — Section 3: "vault entry purged"
    record.revoked = true;
    record.revokedAt = now();
    record.updatedAt = now();

    this.audit.append({ operation: "revoke", keyId: record.id, tenantId: record.tenantId, requester, at: now() });
    this.emit({ type: "key.revoked", keyId: record.id, tenantId: record.tenantId, keyType: "brain", roleId });
  }

  async decryptBrainKey(roleId: string, requester: RequesterIdentity): Promise<SecretHandle> {
    assertRouterServiceIdentity(requester);
    const record = this.brainKeysByRole.get(roleId);
    if (!record || record.revoked || !record.material) {
      this.audit.append({
        operation: "decrypt-denied",
        keyId: record?.id ?? `role:${roleId}`,
        tenantId: record?.tenantId ?? "unknown",
        requester,
        at: now(),
        detail: "not found or revoked",
      });
      throw new KeyNotFoundError(`No active Brain key for role "${roleId}".`);
    }

    const dek = await this.dekStore.getOrCreateDek(record.tenantId);
    const plaintext = decrypt(record.material, dek, brainAad(record.roleId, record.provider));
    this.audit.append({ operation: "decrypt-granted", keyId: record.id, tenantId: record.tenantId, requester, at: now() });
    return new SecretHandle(plaintext, this.ttlMs);
  }

  // ---- Hands keys (per-sub-agent + per-capability, ADR-002, T8) --------

  async storeHandsKey(input: StoreHandsKeyInput, requester: RequesterIdentity): Promise<PublicKeyRecord> {
    await this.runValidation(input.plaintext, input.validate, input.tenantId, requester);

    const dek = await this.dekStore.getOrCreateDek(input.tenantId);
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
      createdAt: now(),
      updatedAt: now(),
    };
    this.handsKeysById.set(record.id, record);
    this.audit.append({ operation: "store", keyId: record.id, tenantId: input.tenantId, requester, at: now() });
    return toPublic(record);
  }

  async rotateHandsKey(
    keyId: string,
    newPlaintext: Buffer,
    requester: RequesterIdentity,
    validate?: (plaintext: Buffer) => Promise<boolean>,
  ): Promise<PublicKeyRecord> {
    const record = this.handsKeysById.get(keyId);
    if (!record || record.revoked) throw new KeyNotFoundError(`No active Hands key "${keyId}".`);

    await this.runValidation(newPlaintext, validate, record.tenantId, requester);

    const dek = await this.dekStore.getOrCreateDek(record.tenantId);
    record.material = encrypt(newPlaintext, dek, handsAad(record.subAgentId, record.capabilityScope));
    record.maskedFingerprint = maskFingerprint(newPlaintext);
    record.updatedAt = now();

    this.audit.append({ operation: "rotate", keyId: record.id, tenantId: record.tenantId, requester, at: now() });
    return toPublic(record);
  }

  async revokeHandsKey(keyId: string, requester: RequesterIdentity): Promise<void> {
    const record = this.handsKeysById.get(keyId);
    if (!record) throw new KeyNotFoundError(`No Hands key "${keyId}".`);

    record.material = null;
    record.revoked = true;
    record.revokedAt = now();
    record.updatedAt = now();

    this.audit.append({ operation: "revoke", keyId: record.id, tenantId: record.tenantId, requester, at: now() });
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
    keyId: string,
    requestedBy: { subAgentId: string; capabilityScope: string },
    requester: RequesterIdentity,
  ): Promise<SecretHandle> {
    assertRouterServiceIdentity(requester);
    const record = this.handsKeysById.get(keyId);
    if (!record || record.revoked || !record.material) {
      this.audit.append({
        operation: "decrypt-denied",
        keyId,
        tenantId: record?.tenantId ?? "unknown",
        requester,
        at: now(),
        detail: "not found or revoked",
      });
      throw new KeyNotFoundError(`No active Hands key "${keyId}".`);
    }

    const dek = await this.dekStore.getOrCreateDek(record.tenantId);
    const claimedAad = handsAad(requestedBy.subAgentId, requestedBy.capabilityScope);

    let plaintext: Buffer;
    try {
      plaintext = decrypt(record.material, dek, claimedAad);
    } catch {
      this.audit.append({
        operation: "decrypt-denied",
        keyId,
        tenantId: record.tenantId,
        requester,
        at: now(),
        detail: `scope-binding mismatch: claimed ${requestedBy.subAgentId}:${requestedBy.capabilityScope}`,
      });
      throw new ScopeBindingError(
        `Hands key "${keyId}" is not bound to subAgentId="${requestedBy.subAgentId}", ` +
          `capabilityScope="${requestedBy.capabilityScope}".`,
      );
    }

    this.audit.append({
      operation: "decrypt-granted",
      keyId,
      tenantId: record.tenantId,
      requester,
      at: now(),
      detail: `scope=${requestedBy.subAgentId}:${requestedBy.capabilityScope}`,
    });
    return new SecretHandle(plaintext, this.ttlMs);
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
      this.audit.append({ operation: "validate-failed", keyId: "pending", tenantId, requester, at: now() });
      throw new ValidationFailedError("Live validation call failed — key was not stored.");
    }
  }
}
