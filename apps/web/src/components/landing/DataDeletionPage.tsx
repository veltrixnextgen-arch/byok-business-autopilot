import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

// Meta App Review's data-deletion requirement (docs/design/meta-app-review-checklist.md):
// "a valid Data Deletion Callback URL or Data Deletion Instructions URL —
// absence causes automatic rejection." We build the static instructions
// page, not the JSON callback endpoint — simpler, and Meta's own docs
// accept either. This page is provider-agnostic in its second half (any
// connected service, not just Meta) since Vault's architecture already
// is; the Meta-specific section exists because that's literally what a
// Meta reviewer checks for, independent of whether a Meta connection is
// live yet (docs/design/meta-app-review-checklist.md — Google Calendar
// is the only live connection today, see ADR-021).
//
// PLACEHOLDER: shares PRIVACY_EMAIL's assumed domain — see
// PrivacyPolicyPage.tsx's own note. Keep both files' addresses in sync.
const DELETION_EMAIL = "privacy@runwisely.com";

const STEPS = [
  {
    title: "Revoke access at the source (fastest, no waiting)",
    body: "Disconnecting a service immediately stops the agent it powered from acting through it — the credential is purged from Runwisely right away.",
    detail:
      "In Runwisely: open your org chart, find the agent's connected service badge, and disconnect it — no email needed.",
  },
  {
    title: "Revoke access from Meta directly (Facebook or Instagram)",
    body: "If you connected a service via Meta (Facebook Login), you can also remove Runwisely's access directly from your Meta account at any time — this works whether or not you've disconnected it inside Runwisely.",
    detail: "Facebook: Settings & Privacy → Settings → Apps and Websites → find Runwisely → Remove. Instagram: Settings → Apps and Websites → Runwisely → Remove.",
  },
  {
    title: "Request full deletion of everything we hold about you",
    body: "Removing app access stops future activity, but doesn't by itself delete what we've already stored — your account, business data, and any encrypted credentials/tokens tied to it.",
    detail: `Email ${DELETION_EMAIL} from the address on your account, asking us to delete your data. We confirm and complete it within 30 days.`,
  },
];

export function DataDeletionPage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();
  const [stepsRef, stepsRevealed] = useRevealOnScroll<HTMLElement>();

  return (
    <>
      <LandingNav />
      <SectionContainer ref={heroRef} className="pb-4 pt-32 sm:pt-40">
        <Reveal revealed={heroRevealed} className="mx-auto max-w-2xl space-y-4 text-center">
          <SectionEyebrow>Legal</SectionEyebrow>
          <SectionHeading className="sm:text-3xl lg:text-[40px]">Data Deletion Instructions</SectionHeading>
          <p className="text-text-secondary">
            How to remove Runwisely's access to a connected service, and how to have everything we hold about you
            deleted.
          </p>
        </Reveal>
      </SectionContainer>

      <SectionContainer ref={stepsRef} className="max-w-3xl space-y-5 pb-16 pt-0 sm:px-8">
        <Reveal revealed={stepsRevealed} className="space-y-5">
          {STEPS.map((step, i) => (
            <RwCard key={step.title} className="space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 font-mono text-sm text-text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div className="space-y-2">
                  <h2 className="font-display text-lg font-semibold text-text">{step.title}</h2>
                  <p className="text-sm text-text-secondary">{step.body}</p>
                  <p className="rounded-lg border border-border-subtle bg-bg-glass-subtle px-3.5 py-2.5 text-sm text-text">
                    {step.detail}
                  </p>
                </div>
              </div>
            </RwCard>
          ))}
        </Reveal>
      </SectionContainer>

      <SectionContainer className="max-w-3xl space-y-3 pb-24 pt-0 text-text-secondary sm:px-8">
        <h2 className="font-display text-xl font-semibold text-text">What gets deleted</h2>
        <p>
          A full deletion request removes your account, business/org-chart data, and every stored credential —
          including OAuth tokens for any connected service — encrypted and unreachable the moment deletion completes,
          not just flagged as inactive. Full detail on what we collect and why: our{" "}
          <a href="/privacy" className="text-accent underline underline-offset-4 hover:text-accent-strong">
            Privacy Policy
          </a>
          .
        </p>
      </SectionContainer>

      <LandingFooter />
    </>
  );
}
