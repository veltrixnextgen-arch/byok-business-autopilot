import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { Reveal, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

// Built for the same real reviewer PrivacyPolicyPage.tsx was — Google's
// OAuth verification wants a terms-of-service link alongside the privacy
// policy, on the same domain (docs/design/google-oauth-verification-checklist.md
// §2). Every claim below traces to real code/product behavior, not
// boilerplate: pricingConstants.ts (the actual plan/prices), ADR-043 (the
// draft-only decision) and PR #218/ResendEffectExecutor (the one narrow,
// human-gated exception to it), billing.ts (the real Stripe cancel/tier-
// revert mechanics) — see each section's own note.
//
// Shares PrivacyPolicyPage.tsx's contact address — same reasoning: no
// business mailbox exists yet (2026-09-03). Swap both together once one
// does.
const CONTACT_EMAIL = "veltrixnextgen@gmail.com";

const LAST_UPDATED = "September 2026";

export function TermsOfServicePage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();

  return (
    <>
      <LandingNav />
      <SectionContainer ref={heroRef} className="pb-4 pt-32 sm:pt-40">
        <Reveal revealed={heroRevealed} className="mx-auto max-w-2xl space-y-4 text-center">
          <SectionEyebrow>Legal</SectionEyebrow>
          <SectionHeading className="sm:text-3xl lg:text-[40px]">Terms of Service</SectionHeading>
          <p className="text-text-secondary">Last updated {LAST_UPDATED}.</p>
        </Reveal>
      </SectionContainer>

      <SectionContainer className="max-w-3xl space-y-10 pb-24 pt-0 text-text-secondary sm:px-8">
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">What Runwisely is</h2>
          <p>
            Runwisely turns a business idea (or an existing business) into a structured org chart of AI agents, then
            runs those agents on a schedule against your own connected AI provider and service accounts. These terms
            govern your use of runwisely.cc and the Runwisely application. By creating an account, you agree to them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">BYOK — you bring the keys, you pay the providers</h2>
          <p>
            Runwisely is bring-your-own-key. When you connect an AI provider (Anthropic, OpenAI, Google, or DeepSeek)
            or a service ("Hands," e.g. Google Calendar or Resend), every call your agents make runs on{" "}
            <strong className="text-text">your own connected credential, billed to you directly by that provider</strong>{" "}
            — never marked up, never billed through us. We charge a flat subscription for the product itself (below);
            we are not a party to, and have no visibility into or control over, the pricing, uptime, rate limits, or
            terms of service of the third-party providers you connect. If a provider changes its pricing, suspends
            your account, or is unavailable, that's between you and them — the same way it would be if you used their
            API directly, with or without Runwisely.
          </p>
          <p>
            One narrow exception: your very first org chart is generated using Runwisely's own capped platform key,
            not yours, so signing up and seeing your company's structure costs you nothing before you decide to
            continue.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Subscription, billing, and cancellation</h2>
          <p>
            Runwisely is one plan, billed monthly ($39.99), quarterly ($107.97, ~10% off), or yearly ($383.90, ~20%
            off) — every feature the product has, at every billing period, for one company. Payment is processed by
            Stripe; we never see or store your card details ourselves.
          </p>
          <p>
            You can cancel at any time from your account settings. Cancellation takes effect at the end of your
            current billing period — you keep full access until then, and are not charged again after. Once your
            subscription ends, your account reverts to the free tier (org chart, Charter, and one role under full
            manual review) rather than being deleted; see "Data handling" below for what that means for your data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">One company per account</h2>
          <p>
            Your subscription covers one active company. If you use Runwisely for more than one business idea, only
            one can be actively scheduled and spending at a time — the others stay visible and switchable, but
            paused: no scheduled work runs, and no AI or service cost is incurred, until you make that company active
            again.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Drafts, approvals, and the one thing that actually happens automatically</h2>
          <p>
            By default, every action an agent proposes — sending an email, posting, creating an invoice, anything
            that would do something in the world rather than just think — is a <strong className="text-text">draft</strong>.
            Nothing is sent, posted, paid, or executed until a human reviews it in your Approvals queue and explicitly
            approves it. This is the core safety property of the product, and it applies no matter how much
            autonomy a task type has "earned" through a track record of approvals.
          </p>
          <p>
            As of this writing, there is exactly one narrow exception: a single task type (an internal weekly summary
            emailed via your own connected Resend account) can send for real once you've approved it through the
            Approvals queue — the human-approval step still happens every time; what's different is that approval
            triggers a real send instead of just marking the draft reviewed. Every other task type, for every
            business, stays draft-only. If and when more task types gain this capability, the approval step required
            beforehand does not change.
          </p>
          <p>
            You are responsible for reviewing what you approve. Runwisely shows you the exact content that will be
            sent or acted on before you approve it; once you approve it, that action is yours, not ours.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Data handling</h2>
          <p>
            What we collect, why, and how it's protected is covered in full in our{" "}
            <a href="/privacy" className="text-accent underline underline-offset-4 hover:text-accent-strong">
              Privacy Policy
            </a>{" "}
            — these terms don't repeat it. In short: your AI provider keys and connected-service credentials are
            envelope-encrypted, never stored in plaintext, and never shared beyond what your own agents' work
            requires from the specific service you connected.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Acceptable use</h2>
          <p>
            You won't use Runwisely to generate or dispatch content that's illegal, fraudulent, or that violates a
            connected third-party provider's own terms of service. You're responsible for having the right to connect
            any account or credential you give us — including making sure you're authorized to act on a business's
            behalf if you're setting this up for someone else. We can suspend an account we reasonably believe is
            being used this way.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">No warranty; limitation of liability</h2>
          <p>
            Runwisely is provided "as is." We don't warrant that agent output is accurate, complete, or fit for any
            particular purpose — AI models make mistakes, and the draft-review step above exists specifically because
            of that, not as a formality. We are not liable for the content, availability, pricing, or conduct of any
            third-party AI provider or connected service you use through Runwisely, or for any action you approve.
          </p>
          <p>
            To the maximum extent the law allows, Runwisely's total liability for any claim relating to the service
            is limited to the amount you paid us in the 12 months before the claim arose, and we are not liable for
            indirect, incidental, or consequential damages (lost profits, lost data, business interruption) arising
            from your use of the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Changes to these terms</h2>
          <p>
            If we make a material change, we'll update the date at the top of this page and, where practical, notify
            you directly. Continuing to use Runwisely after a change takes effect means you accept the updated terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Contact</h2>
          <p>
            Questions about these terms:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline underline-offset-4 hover:text-accent-strong">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </SectionContainer>

      <LandingFooter />
    </>
  );
}
