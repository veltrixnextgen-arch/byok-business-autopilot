// security-architecture.md §5: "The approval queue is the final firewall
// ... injected content can, at absolute worst, produce a bad proposal —
// which a human sees, in plain language, before anything happens." The
// queue gates EFFECTS, not thinking: drafting/reasoning output is free,
// but anything that would actually DO something in the world must pass
// through here first.
export type EffectKind = "send" | "post" | "pay" | "deploy";

export interface EffectDescriptor {
  kind: EffectKind;
  /** Plain-language description of what happens on approval, per the
   *  "Fix this" / plain-language-reasoning design law. */
  description: string;
  detail?: Record<string, unknown>;
}

export interface ProposedAction {
  id: string;
  tenantId: string;
  agentName: string;
  roleTitle: string;
  /** The task type this action belongs to — what earned autonomy tracks
   *  per (tenantId, taskType). */
  taskType: string;
  summary: string;
  draft: string;
  stakesTags: string[];
  /** Undefined = pure draft, always free, never queued for an effect
   *  reason (though it may still be queued for visibility — see queue.ts).
   *  Present = this MUST pass the queue before the effect runs. */
  effect?: EffectDescriptor;
  createdAt: string;
}

// T10 / ADR-004: the CEO's outputs can ONLY enter the approval queue as
// guidance — there is no dispatch, spend, send, or deploy pathway, no
// matter what the CEO's prompt becomes. This type has NO `effect` field at
// all, not even as `undefined` — there is no property here that could ever
// hold an EffectDescriptor. Same philosophy as packages/vault's
// SecretHandle: the type system forbids the dangerous case outright,
// backed by a runtime check in queue.ts for defense in depth against an
// `as any` cast smuggling one in anyway.
export interface RecommendationItem {
  id: string;
  tenantId: string;
  agentName: string;
  roleTitle: string;
  summary: string;
  draft: string;
  stakesTags: string[];
  createdAt: string;
}

export type VerdictKind = "APPROVE" | "REJECT" | "MODIFY";

export interface ApproveVerdict {
  kind: "APPROVE";
}

export interface RejectVerdict {
  kind: "REJECT";
  /** Required, not optional — Screen 7: "Fix this" always comes with a
   *  comment box that becomes agent feedback. A reject with no feedback
   *  teaches the agent nothing. */
  feedback: string;
}

export interface ModifyVerdict {
  kind: "MODIFY";
  /** The edited output substitutes the original draft, then the rest of
   *  the flow is identical to APPROVE (effect dispatches with the edited
   *  content, autonomy counter progresses). */
  editedOutput: string;
}

export type Verdict = ApproveVerdict | RejectVerdict | ModifyVerdict;

export class EffectOnRecommendationError extends Error {}
export class UnknownActionError extends Error {}
export class UnknownRecommendationError extends Error {}
