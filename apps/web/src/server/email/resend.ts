import 'server-only';
import { Resend } from 'resend';

/**
 * Thin Resend wrapper for transactional email (M4-T4).
 *
 * The sender domain (default app.bullseyeproperties.co.uk) must be verified in
 * Resend before anything sends. `server-only` keeps the API key off the client.
 */

const DEFAULT_FROM = 'Bullseye Properties <reports@app.bullseyeproperties.co.uk>';

let _resend: Resend | null = null;

function client(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Email is not configured (RESEND_API_KEY is missing).');
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

export function emailFrom(): string {
  return process.env.SHARE_EMAIL_FROM || DEFAULT_FROM;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/** Send one transactional email. Throws on a missing key or a provider error. */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { data, error } = await client().emails.send({
    from: emailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
  if (error) throw new Error(`Email send failed: ${error.message}`);
  if (!data) throw new Error('Email send failed: no response from provider.');
  return { id: data.id };
}
