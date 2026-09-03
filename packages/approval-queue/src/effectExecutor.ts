import { ResendEmailSender } from "@byok/notifications";
import type { HandsKeyProvider, RequesterIdentity } from "@byok/vault";
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

// Matches apps/web/src/lib/handsKeyClient.ts's capabilityScopeForTool("Resend")
// exactly — the connect flow and this executor must resolve to the same
// (subAgentId, capabilityScope) pair or a connected key would never be found.
const RESEND_CAPABILITY_SCOPE = "resend";

// ponytail: Resend's own shared test sender, usable from any Resend
// account without that tenant verifying their own sending domain first.
// Real per-tenant "from" identity isn't captured anywhere yet (the
// connect flow only stores the API key) — upgrade when it is.
const FROM_ADDRESS = "Runwisely Agent <onboarding@resend.dev>";

/**
 * The first real EffectExecutor (Week 1's narrow scope: one task type,
 * templated send, human-gated). Sends via the TENANT's own connected
 * Resend Hands key — never a platform key, ADR-002 BYOK — to the
 * tenant's own owner/admin emails (issue #140's existing lookup,
 * @byok/db's getTenantOwnerEmails). Only ever reached via
 * ApprovalQueue.resolve() (a human APPROVE/MODIFY verdict) — queue.ts's
 * own autonomy-bypass path refuses to carry an effect at all, so an
 * earned-autonomy task type can never reach this executor without a
 * human resolve() first, no matter how "earned" it is.
 *
 * `action.taskType` doubles as the router-level subAgentId here —
 * router.ts's submitTask always sets `taskType: task.subAgentId`
 * (never caller-supplied), so this holds for every real dispatch, not
 * just this one task type. `action.draft` is the email body verbatim —
 * the agent's own output, or the human's MODIFY-edited replacement if
 * that's the verdict — never re-derived, so what was approved is
 * exactly what sends.
 *
 * Every failure returns {success:false, error} rather than throwing —
 * ApprovalQueue.resolve() surfaces it as a real, visible dispatch
 * failure (issue #159's own "no silent failures" discipline), never a
 * swallowed one.
 */
export interface TenantContactLookup {
  /** Owner/admin emails for a tenant — @byok/db's getTenantOwnerEmails
   *  (issue #140) bound to a real pool, at the construction site
   *  (durableTrustCore.ts). Narrow on purpose, same "mockable seam"
   *  philosophy as HandsKeyProvider/BrainKeyProvider elsewhere in this
   *  codebase — this class never needs to know a Postgres pool exists. */
  getOwnerEmails(tenantId: string): Promise<string[]>;
}

export class ResendEffectExecutor implements EffectExecutor {
  constructor(
    private readonly contacts: TenantContactLookup,
    private readonly vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey">,
    private readonly requester: RequesterIdentity,
  ) {}

  async execute(effect: EffectDescriptor, action: ProposedAction): Promise<EffectResult> {
    if (effect.kind !== "send") {
      return { success: false, error: `ResendEffectExecutor only handles "send" effects, got "${effect.kind}".` };
    }

    const subAgentId = action.taskType;
    const keyId = await this.vault.resolveHandsKeyId(action.tenantId, subAgentId, RESEND_CAPABILITY_SCOPE);
    if (!keyId) {
      return { success: false, error: `Resend isn't connected for "${action.agentName}" yet.` };
    }

    let handle;
    try {
      handle = await this.vault.decryptHandsKey(
        action.tenantId,
        keyId,
        { subAgentId, capabilityScope: RESEND_CAPABILITY_SCOPE },
        this.requester,
      );
    } catch (err) {
      return { success: false, error: `Could not decrypt the connected Resend key: ${(err as Error).message}` };
    }

    const recipients = await this.contacts.getOwnerEmails(action.tenantId);
    if (recipients.length === 0) {
      return { success: false, error: "No owner/admin email found for this tenant." };
    }

    try {
      return await handle.use(async (apiKeyBuffer) => {
        const sender = new ResendEmailSender(apiKeyBuffer.toString("utf8"), FROM_ADDRESS);
        for (const to of recipients) {
          await sender.send({ to, subject: action.summary, text: action.draft });
        }
        return { success: true } as const;
      });
    } catch (err) {
      return { success: false, error: `Resend send failed: ${(err as Error).message}` };
    }
  }
}
