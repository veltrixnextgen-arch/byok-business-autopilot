import type { Charter, CompanyCharter } from "@byok/contracts";
import { apiClient } from "./apiClient";

// R2 (docs/architecture/automation-runtime-plan.md §2, ADR-024): the
// Charter review/edit/handoff surface. Mirrors extractionClient.ts's
// conventions exactly (apiClient's typed RPC client, a plain Error on any
// non-ok response) — no new pattern introduced.

export interface CharterState {
  active: CompanyCharter | null;
  draft: CompanyCharter | null;
  /** Only present when neither `active` nor `draft` exists yet — the raw,
   *  not-yet-persisted Charter content from the org chart's onboarding
   *  batch. The screen calls createDraft() to turn this into an editable,
   *  savable record before the user can change anything. */
  rawDraft: Charter | null;
}

export async function getCharterState(): Promise<CharterState> {
  const res = await apiClient.me.charter.$get();
  if (!res.ok) throw new Error(`Could not load your Charter (${res.status}).`);
  return (await res.json()) as CharterState;
}

export async function createDraft(): Promise<CompanyCharter> {
  const res = await apiClient.me.charter.draft.$post();
  if (!res.ok) throw new Error(`Could not start editing your Charter (${res.status}).`);
  const { draft } = await res.json();
  return draft as CompanyCharter;
}

export async function updateDraft(id: string, content: Charter): Promise<CompanyCharter> {
  const res = await apiClient.me.charter.draft[":id"].$patch({ param: { id }, json: content });
  if (!res.ok) throw new Error(`Could not save your changes (${res.status}).`);
  const { draft } = await res.json();
  return draft as CompanyCharter;
}

/** The handoff ceremony (master-plan-v2.md Stage 4 #11): "Hand the Charter
 *  to [CEO name]?" → installs this draft as the active Charter and
 *  generates the three-tier prompt cascade from it. */
export async function acceptDraft(id: string): Promise<CompanyCharter> {
  const res = await apiClient.me.charter.draft[":id"].accept.$post({ param: { id } });
  if (!res.ok) throw new Error(`Could not hand off the Charter (${res.status}).`);
  const { charter } = await res.json();
  return charter as CompanyCharter;
}
