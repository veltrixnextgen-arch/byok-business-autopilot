import type { EffectDescriptor, ProposedAction } from "./types.js";

export type EffectResult = { success: true } | { success: false; error: string };

// Same pluggability philosophy as apps/router/src/executor.ts's
// AgentExecutor: the queue's own logic (intake, verdicts, autonomy) is
// fully testable without ever actually sending an email, posting to a
// social account, moving money, or deploying anything.
export interface EffectExecutor {
  execute(effect: EffectDescriptor, action: ProposedAction): Promise<EffectResult>;
}

export class MockEffectExecutor implements EffectExecutor {
  async execute(effect: EffectDescriptor): Promise<EffectResult> {
    return { success: true };
  }
}
