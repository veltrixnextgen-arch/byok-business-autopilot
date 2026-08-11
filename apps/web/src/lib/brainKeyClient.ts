import { apiClient } from "./apiClient";

export const BRAIN_PROVIDERS = ["anthropic", "openai", "google", "deepseek"] as const;
export type BrainProvider = (typeof BRAIN_PROVIDERS)[number];

export interface BrainKeyStatus {
  id: string;
  provider: string;
  maskedFingerprint: string;
  createdAt: string;
}

export async function getBrainKeyStatus(): Promise<BrainKeyStatus | null> {
  const res = await apiClient.me["brain-key"].$get();
  if (!res.ok) throw new Error(`Could not check your connected key (${res.status}).`);
  const { key } = await res.json();
  return key as BrainKeyStatus | null;
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
  return key as BrainKeyStatus;
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
