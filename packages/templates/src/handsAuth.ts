// Which auth shape each declared handsTool actually supports — the data
// apps/web's HandsConnectPanel (issue #22) drives its badge behavior off
// of, so a new template's handsTool value gets the right UI automatically
// instead of the connect panel silently assuming every service takes a
// pasted API key. Source of truth for these classifications is
// docs/design/tool-registry.md §2b (per-service auth column) and §2e (the
// audit that found the paste-a-key UI breaks every OAuth-only service) —
// this file is the machine-checkable version of that research, not a
// second opinion. handsAuth.test.ts fails CI if a template introduces a
// handsTool string with no entry here, so this can't silently drift the
// way the UI itself did.
//
// Three states, matching what the connect panel can actually offer today:
//   "key"         — a real pasteable secret exists for at least the
//                    §2b/§2c *recommended* service behind this label (may
//                    still be the less-ideal of two options — see
//                    per-entry notes below).
//   "oauth-live"   — a real OAuth connect flow exists (apps/api's
//                    /hands-oauth/:service/start, ADR-021) — the badge
//                    offers a genuine "Connect" action, not a message.
//                    oauthService names which apps/api route to hit.
//   "oauth-pending" — no pasteable credential exists (or none we're
//                    willing to recommend), and no OAuth flow has been
//                    built for it yet — renders the honest draft-mode
//                    state instead of a text input or a dead-end button.
export type HandsAuthMethod = "key" | "oauth-live" | "oauth-pending";

export interface HandsAuthEntry {
  method: HandsAuthMethod;
  /** Why this classification, and which underlying service it assumes —
   *  most handsTool labels bundle 2+ candidate services (§2's "Concrete
   *  services" column); this records which one the classification is
   *  actually about. */
  note: string;
  /** Required when method is "oauth-live" — the service id apps/api's
   *  /hands-oauth/:service/start and Vault's HandsCredentialRefresher
   *  registry both key on (e.g. "google-calendar"). */
  oauthService?: string;
}

export const HANDS_AUTH_METHOD: Record<string, HandsAuthEntry> = {
  Stripe: { method: "key", note: "OAuth preferred but a pasteable secret key works (§2b Payments (own))." },
  Square: { method: "key", note: "OAuth preferred but Square issues a pasteable access token (§2b Payments (own))." },
  "Shopify/Etsy": {
    method: "key",
    note: "Shopify's self-serve custom-app token is pasteable and is §2c's recommended default path; Etsy API v3 needs an OAuth token with no static-key fallback, so an Etsy-only business hits the same dead end this classification exists to avoid — flagged, not solved, until the label can distinguish the two services.",
  },
  "Shipping carrier": { method: "key", note: "EasyPost/Shippo are both plain API-key auth (§2b Shipping)." },
  "Payroll provider": {
    method: "oauth-pending",
    note: "Gusto/Rippling both require Runwisely to clear a partner/security-review pipeline first (§2b Payroll) — no pasteable key path exists either way, and live connect isn't realistic even once one is built (§2d).",
  },
  "Membership/payment platform": { method: "oauth-pending", note: "Mindbody/Wild Apricot — OAuth only, no static-key fallback found (§2b Membership/booking platform)." },
  "Booking platform": { method: "oauth-pending", note: "Calendly/Acuity — OAuth only (§2b Membership/booking platform)." },
  "Membership platform": { method: "oauth-pending", note: "Mindbody/Wild Apricot — OAuth only (§2b Membership/booking platform)." },
  "Google Business": { method: "oauth-pending", note: "Google Business Profile API — OAuth only, plus a separate access-request gate (§2b Local presence); stays draft-only by design even once OAuth exists (§2d)." },
  Calendar: {
    method: "oauth-live",
    oauthService: "google-calendar",
    note: "§2g's top-ranked OAuth build target (Scheduling + Event coordinator, 3/6 templates) — PR 2B wires Google Calendar specifically (docs/DECISIONS.md ADR-021). Outlook Calendar remains unbuilt; a business on Microsoft 365 still gets the real Google connect button today, since the label doesn't distinguish the two — flagged, not solved, same pattern as Shopify/Etsy below.",
  },
  POS: { method: "key", note: "Square (§2c's recommended default over Clover/Toast) issues a pasteable access token." },
  "Shared inbox": { method: "key", note: "Front and Zendesk both support a pasteable API token for internal use, alongside OAuth (§2b Shared inbox)." },
  Discord: { method: "key", note: "Bot-token install is itself a pasteable secret, not a separate OAuth redirect (§2b Social — chat community)." },
  "Instagram/Meta": { method: "oauth-pending", note: "Meta Graph API — OAuth via Facebook Login only, no API-key auth exists (§2b Social — Meta family). Meta App Review submission checklist ready (docs/design/meta-app-review-checklist.md) — code not built yet." },
  "Instagram/Facebook": { method: "oauth-pending", note: "Meta Graph API — OAuth only (§2b Social — Meta family)." },
  "Instagram/TikTok": { method: "oauth-pending", note: "Both Meta Graph API and TikTok Content Posting API are OAuth only (§2b Social)." },
  "Twitter/X": {
    method: "oauth-pending",
    note: "OAuth 2.0 is the primary path; a paid pay-per-post key tier technically exists but §2c already recommends keeping X strictly draft-only regardless of auth shape, so this stays oauth-pending (no live-connect offer) rather than exposing a paid key field.",
  },
  GitHub: { method: "oauth-pending", note: "GitHub App installation is a consent-screen flow, not a bearer key a user has sitting around (§2b Code) — a personal access token would technically parse but isn't the recommended pattern." },
  "Resend/ConvertKit": { method: "key", note: "Resend (§2c's recommended default over Postmark) is plain API-key auth; ConvertKit's legacy v3 key also works as a fallback (§2b Email sending / Newsletter)." },
  Resend: { method: "key", note: "Plain API-key auth (§2b Email sending)." },
  Email: { method: "key", note: "Resend/Postmark — plain API-key auth (§2b Email sending)." },
  CRM: { method: "key", note: "HubSpot (§2c's recommended default over Pipedrive/Salesforce) issues a pasteable private-app access token (§2b CRM)." },
  "Client-facing systems (per-client, scoped access)": {
    method: "key",
    note: "Dynamic, per-client credential by design (ADR-002) — there's no fixed service to offer OAuth for, so a pasted credential (whatever the specific client's system requires) is the only honest option, not a fallback.",
  },
};

/** Unknown handsTool values (a template drifted ahead of this registry,
 *  or a caller passes something that was never a handsTool at all)
 *  default to "oauth-pending" — the honest-draft-state UI, never the
 *  paste field and never a dead OAuth button. Silently offering either
 *  for an unrecognized service risks repeating exactly the failure this
 *  file exists to prevent; handsAuth.test.ts is what actually keeps this
 *  branch unreachable for every real template value. */
export function authMethodForTool(tool: string): HandsAuthMethod {
  return HANDS_AUTH_METHOD[tool]?.method ?? "oauth-pending";
}

/** The apps/api service id for an "oauth-live" tool's connect flow —
 *  null for every other method, including a mis-set entry where
 *  oauthService was forgotten (handsAuth.test.ts catches that case
 *  explicitly rather than letting it surface as a silently broken
 *  connect button). */
export function oauthServiceForTool(tool: string): string | null {
  const entry = HANDS_AUTH_METHOD[tool];
  return entry?.method === "oauth-live" ? (entry.oauthService ?? null) : null;
}
