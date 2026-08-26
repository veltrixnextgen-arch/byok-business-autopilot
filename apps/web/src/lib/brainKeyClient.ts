import { apiClient } from "./apiClient";

export const BRAIN_PROVIDERS = ["anthropic", "openai", "google", "deepseek"] as const;
export type BrainProvider = (typeof BRAIN_PROVIDERS)[number];

export interface BrainKeyStatus {
  id: string;
  provider: string;
  maskedFingerprint: string;
  createdAt: string;
  /** ADR-031: distinct from the key merely being "connected" (a row
   *  exists, not revoked) — this reflects whether that row's material
   *  can actually be decrypted right now. false most likely means the
   *  KMS master key that encrypted it has since rotated out from under
   *  it; either way, a connected-but-undecryptable key needs to be
   *  reconnected, not just left showing green. */
  decryptable: boolean;
}

export async function getBrainKeyStatus(): Promise<BrainKeyStatus | null> {
  const res = await apiClient.me["brain-key"].$get();
  if (!res.ok) throw new Error(`Could not check your connected key (${res.status}).`);
  const { key, decryptable } = await res.json();
  if (!key) return null;
  // The route's underlying PublicKeyRecord type covers both Brain and
  // Hands key shapes (the general vault-wide union) — this specific
  // route only ever actually returns a Brain-shaped record, same as
  // before this file added `decryptable`, which is why a cast (not a
  // plain spread) is needed here.
  return { ...key, decryptable: decryptable ?? false } as BrainKeyStatus;
}

/** Thrown on a 422 (the provider rejected the key) — distinct from a
 *  generic Error so the connect form can show "that key didn't work"
 *  inline instead of a raw network-failure message. */
export class BrainKeyRejectedError extends Error {}

export async function connectBrainKey(provider: BrainProvider, apiKey: string): Promise<BrainKeyStatus> {
  const res = await apiClient.me["brain-key"].$post({ json: { provider, apiKey } });
  if (res.status === 422) {
    const { error } = (await res.json()) as { error: string };
    throw new BrainKeyRejectedError(error);
  }
  if (!res.ok) throw new Error(`Could not connect that key (${res.status}).`);
  const { key } = await res.json();
  // storeBrainKey's response never runs the decrypt-verify check — a key
  // that was just stored (and, for most providers, just live-validated)
  // is decryptable by construction at this exact moment, so `true` here
  // is a correct starting value, not a guess.
  return { ...key, decryptable: true } as BrainKeyStatus;
}

// Brain-per-role (first slice): targets exactly one role instead of the
// whole org chart. No component calls these yet — landed ahead of a real
// per-role picker UI (issue #13), same reasoning as the route itself (see
// apps/api/src/routes/brainKeys.ts's module comment).
export async function getBrainKeyStatusForRole(roleId: string): Promise<BrainKeyStatus | null> {
  const res = await apiClient.me["brain-key"][":roleId"].$get({ param: { roleId } });
  if (!res.ok) throw new Error(`Could not check the connected key for this role (${res.status}).`);
  const { key, decryptable } = await res.json();
  if (!key) return null;
  return { ...key, decryptable: decryptable ?? false } as BrainKeyStatus;
}

export async function connectBrainKeyForRole(roleId: string, provider: BrainProvider, apiKey: string): Promise<BrainKeyStatus> {
  const res = await apiClient.me["brain-key"][":roleId"].$post({ param: { roleId }, json: { provider, apiKey } });
  if (res.status === 422) {
    const { error } = (await res.json()) as { error: string };
    throw new BrainKeyRejectedError(error);
  }
  if (!res.ok) throw new Error(`Could not connect that key (${res.status}).`);
  const { key } = await res.json();
  return { ...key, decryptable: true } as BrainKeyStatus;
}

export interface CeilingInfo {
  companyMonthlyUsd: number;
  isOverride: boolean;
}

export async function getCeiling(): Promise<CeilingInfo> {
  const res = await apiClient.me.ceiling.$get();
  if (!res.ok) throw new Error(`Could not load your spending ceiling (${res.status}).`);
  return res.json();
}

export class InvalidCeilingError extends Error {}

export async function setCeiling(companyMonthlyUsd: number): Promise<CeilingInfo> {
  const res = await apiClient.me.ceiling.$post({ json: { companyMonthlyUsd } });
  if (res.status === 400) {
    const { error } = (await res.json()) as { error: string };
    throw new InvalidCeilingError(error);
  }
  if (!res.ok) throw new Error(`Could not save your spending ceiling (${res.status}).`);
  return res.json();
}
