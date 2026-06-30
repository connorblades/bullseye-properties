import type { ShareTokenKind } from '@/server/share/tokens';

/**
 * Branded transactional email for a share link (M4-T4). Pure - returns subject +
 * html + text so it is fully unit-testable and the Resend send stays a thin
 * wrapper. Inline styles only (email clients ignore <style>/external CSS).
 */

export interface ShareEmailInput {
  kind: ShareTokenKind;
  url: string;
  dealAddress: string;
  partnerName: string;
  recipientName?: string | null;
  /** ISO date string, or null for no expiry. */
  expiresAt?: string | null;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const NAVY = '#1f5199';
const INK = '#1a1a1a';
const MUTED = '#6b7280';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(iso));
}

export function buildShareEmail(input: ShareEmailInput): BuiltEmail {
  const isReport = input.kind === 'report';
  const artifact = isReport ? 'Standard Deal Report' : 'outline';
  const greetingName = input.recipientName?.trim() ? input.recipientName.trim() : 'there';
  const expiryLine = input.expiresAt
    ? `This link is valid until ${fmtDate(input.expiresAt)}.`
    : 'This link does not expire, but can be revoked at any time.';

  const subject = isReport
    ? `Your Standard Deal Report for ${input.dealAddress}`
    : `An outline for ${input.dealAddress}`;

  const intro = isReport
    ? `${input.partnerName} has prepared your full Standard Deal Report for ${input.dealAddress}. You can view it and download the PDF using the secure link below.`
    : `${input.partnerName} has put together a short outline for ${input.dealAddress} for you to review. Open it using the secure link below.`;

  const text = [
    `Hi ${greetingName},`,
    '',
    intro,
    '',
    `View it here: ${input.url}`,
    '',
    expiryLine,
    '',
    'This link is personal to you, please do not forward it.',
    '',
    `${input.partnerName}`,
    'Bullseye Properties',
  ].join('\n');

  const eAddr = escapeHtml(input.dealAddress);
  const ePartner = escapeHtml(input.partnerName);
  const eGreeting = escapeHtml(greetingName);
  const eIntro = escapeHtml(intro);
  const eExpiry = escapeHtml(expiryLine);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
          <tr><td style="background:${NAVY};padding:20px 28px;">
            <span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.5px;">Bullseye Properties</span>
          </td></tr>
          <tr><td style="padding:28px 28px 8px 28px;">
            <p style="margin:0 0 14px 0;font-size:15px;">Hi ${eGreeting},</p>
            <p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;">${eIntro}</p>
            <p style="margin:0 0 24px 0;">
              <a href="${input.url}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 26px;border-radius:10px;">View your ${escapeHtml(artifact)}</a>
            </p>
            <p style="margin:0 0 6px 0;font-size:13px;color:${MUTED};">${eExpiry}</p>
            <p style="margin:0 0 24px 0;font-size:13px;color:${MUTED};">This link is personal to you, please do not forward it.</p>
          </td></tr>
          <tr><td style="padding:0 28px 28px 28px;border-top:1px solid #eceef1;">
            <p style="margin:18px 0 2px 0;font-size:14px;font-weight:bold;">${ePartner}</p>
            <p style="margin:0;font-size:13px;color:${MUTED};">Your Accredited Bullseye Partner</p>
            <p style="margin:14px 0 0 0;font-size:12px;color:${MUTED};line-height:1.5;">
              This message relates to ${eAddr}. It is not advice or a personal recommendation.
              If you were not expecting it, you can ignore this email.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
