import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { Reveal, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

// Built to satisfy two real reviewers, not just to exist —
// docs/design/google-oauth-verification-checklist.md and
// meta-app-review-checklist.md both require a privacy policy that (1)
// lives on the same domain as the app's homepage, (2) names every data
// category actually collected, (3) explains what each requested OAuth
// scope is used for specifically — reviewers cross-check this text
// against the scopes an app actually requests, not just skim it — and
// (4) gives a concrete deletion path. Every claim below traces to real
// code, not aspiration: packages/auth/src/schema.ts (account fields),
// packages/vault (key custody), packages/db/src/migrations (funnel
// analytics tables) — see each section's own note.
//
// PLACEHOLDER: privacy@runwisely.com / support@runwisely.com assume the
// product's own name as the eventual domain. Confirm against the real
// domain once it's chosen and update both this file and DataDeletionPage.tsx
// together — they must name the same address.
const PRIVACY_EMAIL = "privacy@runwisely.com";

const LAST_UPDATED = "August 2026";

export function PrivacyPolicyPage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();

  return (
    <>
      <LandingNav />
      <SectionContainer ref={heroRef} className="pb-4 pt-32 sm:pt-40">
        <Reveal revealed={heroRevealed} className="mx-auto max-w-2xl space-y-4 text-center">
          <SectionEyebrow>Legal</SectionEyebrow>
          <SectionHeading className="sm:text-3xl lg:text-[40px]">Privacy Policy</SectionHeading>
          <p className="text-text-secondary">Last updated {LAST_UPDATED}.</p>
        </Reveal>
      </SectionContainer>

      <SectionContainer className="max-w-3xl space-y-10 pb-24 pt-0 text-text-secondary sm:px-8">
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">What this covers</h2>
          <p>
            This policy explains what Runwisely ("we," "us") collects when you use runwisely.com and the Runwisely
            application, why we collect it, and how you can have it deleted. It covers everyone who visits the site,
            signs up, or connects a third-party account (like Google Calendar) to a Runwisely agent.
          </p>
          <p>
            Runwisely is built BYOK (bring your own key): the AI provider keys and connected-service credentials you
            give us are used only to act on your own behalf, at your own provider's cost — we never see, log, or
            resell them. The sections below are specific about what that means in practice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Data we collect</h2>
          <ul className="list-disc space-y-2.5 pl-5">
            <li>
              <strong className="text-text">Your business idea and interview answers.</strong> The text you type
              describing your business, and your answers to the guided interview (who pays you, how customers buy,
              what you deliver). This is what turns into your org chart.
            </li>
            <li>
              <strong className="text-text">Account information.</strong> Your name, email address, and a hashed
              password (or, if you sign in another way, whatever that provider confirms) — collected when you sign
              up, used to authenticate you and identify your organization.
            </li>
            <li>
              <strong className="text-text">AI provider keys (Brain keys).</strong> If you connect your own
              Anthropic, OpenAI, Google, or DeepSeek API key so your agents can run, we store it envelope-encrypted —
              never in plaintext, never in logs — and decrypt it only for the instant a call needs it.
            </li>
            <li>
              <strong className="text-text">Connected-service credentials (Hands keys), including OAuth tokens.</strong>{" "}
              If you connect a third-party service (e.g. Google Calendar) so an agent can act through it, we store
              the resulting access and refresh tokens the same way — encrypted, scoped to that one agent and that one
              capability, never logged or shown back to you in full.
            </li>
            <li>
              <strong className="text-text">Usage and product analytics.</strong> Which onboarding steps you reach,
              and optional feedback you submit — used to find where the product is confusing, not to build an
              advertising profile.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">What we do with it</h2>
          <p>
            Your idea and interview answers are sent, once, to Anthropic's API to generate your org chart — this
            first pass is funded by Runwisely's own capped platform key, not yours, so signing up never costs you
            anything before you've decided to continue. Every AI call after that point runs on your own connected key,
            billed to you directly by your provider, and is used only to do the work you've configured your agents to
            do.
          </p>
          <p>
            Account information authenticates you and scopes every request to your own organization's data — enforced
            at the database level (row-level security), not just in application code, so one tenant's data is
            structurally invisible to another's session.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">What connected-service (OAuth) access is used for</h2>
          <p>
            When you connect a third-party service, we request the narrowest access that lets the specific agent do
            its specific job — never broader "just in case" access.
          </p>
          <ul className="list-disc space-y-2.5 pl-5">
            <li>
              <strong className="text-text">Google Calendar</strong> — requested scope:{" "}
              <code className="rounded bg-bg-glass-subtle px-1.5 py-0.5 font-mono text-xs text-text">
                https://www.googleapis.com/auth/calendar.events
              </code>
              . Used only by your Scheduling and Event coordinator agents, only when connected, to read and create
              calendar events on your behalf — for example, booking an appointment or flagging a scheduling conflict.
              We never request broader Calendar access, and we never read or modify any calendar you haven't
              explicitly connected.
            </li>
          </ul>
          <p>
            Every connected-service token is bound to one specific agent and one specific capability at the moment
            you connect it — an agent can never use a token to act outside the job you connected it for, and a token
            for one service can never be read or reused by a different agent. You can disconnect (revoke) any
            connected service at any time from within the app; the agent it powered goes back to drafting for you to
            send yourself, nothing else changes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Who we share data with</h2>
          <p>We don't sell your data, and we don't share it for advertising. We share only what's operationally necessary:</p>
          <ul className="list-disc space-y-2.5 pl-5">
            <li>Your idea and interview answers, with Anthropic, to generate your org chart.</li>
            <li>
              Whatever a connected agent's own work requires, with the specific service you connected it to (e.g.
              Google, for a connected Calendar agent) — and nowhere else.
            </li>
            <li>Standard infrastructure providers (hosting, database) who process data on our behalf, under contract, and never use it for their own purposes.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">How we protect it</h2>
          <p>
            Every key and connected-service credential is envelope-encrypted at rest — a per-tenant encryption key
            protected by a master key, never stored as plaintext. Decryption happens only for the single call that
            needs it, in memory, for that call's duration, then the plaintext is discarded — never written to disk,
            logs, or anywhere an AI model itself could read it back. The application UI only ever shows a masked
            fingerprint (like <code className="rounded bg-bg-glass-subtle px-1.5 py-0.5 font-mono text-xs text-text">sk-...4f2a</code>) once a key is connected, never the real value again.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Requesting deletion</h2>
          <p>
            You can request deletion of everything we hold about you — your account, business data, and any
            connected-service credentials and tokens — at any time. Email{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-accent underline underline-offset-4 hover:text-accent-strong">
              {PRIVACY_EMAIL}
            </a>{" "}
            from the address on your account and we'll confirm and complete the deletion within 30 days. If you
            connected a service through Meta (Facebook/Instagram), see our{" "}
            <a href="/data-deletion" className="text-accent underline underline-offset-4 hover:text-accent-strong">
              data deletion instructions
            </a>{" "}
            page for that path specifically, including how to revoke access directly from your Meta account.
          </p>
          <p>
            Revoking a single connected service is faster and doesn't require an email — do it anytime from within
            the app, and that one credential is purged immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-text">Contact</h2>
          <p>
            Questions about this policy, or anything else data-related:{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-accent underline underline-offset-4 hover:text-accent-strong">
              {PRIVACY_EMAIL}
            </a>
            .
          </p>
        </section>
      </SectionContainer>

      <LandingFooter />
    </>
  );
}
