export interface EmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(input: EmailInput): Promise<void>;
}

/**
 * Real send via Resend's HTTP API
 * (https://resend.com/docs/api-reference/emails/send-email) — chosen as
 * the smallest thing that actually works: one API key, one fetch call, no
 * SMTP setup, no heavy SDK dependency to add to the tree. This codebase
 * had zero email-sending infrastructure of any kind before this (checked:
 * no Resend/SendGrid/nodemailer/Postmark/Mailgun/SES dependency anywhere)
 * — see issue #140.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(input: EmailInput): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.fromAddress, to: input.to, subject: input.subject, text: input.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend API returned ${res.status} sending to ${input.to}: ${body}`);
    }
  }
}

/**
 * The fallback when no email provider is configured. Deliberately NOT a
 * silent no-op: issue #140's entire finding was that a schedule pause was
 * invisible to the user with nobody finding out — a notification path
 * that silently does nothing when misconfigured would just move that same
 * failure one layer down. Every attempted send is logged loudly instead,
 * so a deploy missing RESEND_API_KEY is visible in the logs, not just
 * quietly not sending emails.
 */
export class LoggingEmailSender implements EmailSender {
  async send(input: EmailInput): Promise<void> {
    console.error(
      `[notifications] Email NOT sent (no email provider configured — set RESEND_API_KEY) — would have sent to ${input.to}: "${input.subject}"`,
    );
  }
}

export function createEmailSender(config: { resendApiKey?: string; fromAddress: string }): EmailSender {
  if (!config.resendApiKey) {
    console.error("[notifications] RESEND_API_KEY not configured — schedule pause/resume emails are disabled until it's set.");
    return new LoggingEmailSender();
  }
  return new ResendEmailSender(config.resendApiKey, config.fromAddress);
}
