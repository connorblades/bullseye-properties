/**
 * Daily review digest (BSE-OPP-P01 M4, AC-07).
 *
 * Pure + client-safe: no server imports, so the digest is fully unit-testable and
 * the Resend send stays a thin wrapper (mirroring share-template.ts). It renders
 * the top-N ranked pending leads into a branded email a partner reads each morning
 * before opening /review.
 *
 * The digest does NOT re-score: `toDigestLead` reads the signals the earlier
 * milestones already stored on a candidate (fitPct, radar.discountConfidence,
 * radar.negotiability) and orders by the SAME M4 combined score the inbox uses, so
 * the email and the inbox agree on what "the top matches" are.
 */

import {
  candidateSources,
  leadMarket,
  leadSourceLabel,
  type StoredCandidate,
} from './lead-intake';
import { rankScorePct, signalsOf } from './lead-rank';

const NAVY = '#1f5199';
const INK = '#1a1a1a';
const MUTED = '#6b7280';

/** One lead as it appears in the digest - a flat, already-derived view. */
export interface DigestLead {
  address: string;
  postcode?: string;
  /** M4 combined rank 0..100 (the inbox order). */
  rankPct: number;
  /** Client-fit 0..100. */
  fitPct: number;
  matched: boolean;
  investorName?: string;
  /** Discount below estimated market value 0..100, when the lead is discounted. */
  discountPct?: number;
  /** Off-market negotiability 0..100, when scored. */
  negotiabilityPct?: number;
  market: 'on-market' | 'off-market';
  source: string;
  listingUrl?: string;
}

export interface DigestInput {
  partnerName: string;
  /** ISO date string for the digest day. */
  dateIso: string;
  /** Absolute URL of the /review inbox. */
  reviewUrl: string;
  /** The top-N leads, already ranked best-first. */
  leads: DigestLead[];
  /** Total pending leads in the inbox (so "N more waiting" can show). */
  totalPending: number;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' }).format(new Date(iso));
}

const isHttp = (u?: string): u is string => typeof u === 'string' && /^https?:\/\//.test(u);

/**
 * Derive the discount-below-estimated-value percent for a candidate, mirroring the
 * review card's headline: only when an estimated market value exceeds the guide /
 * asking price. Returns undefined when there is no discount to show.
 */
function discountBelowEst(c: StoredCandidate): number | undefined {
  const est = c.radar?.estMarketValue;
  const price = typeof c.guidePrice === 'number' ? c.guidePrice
    : typeof c.askingPrice === 'number' ? c.askingPrice
    : undefined;
  if (typeof est === 'number' && typeof price === 'number' && est > price) {
    return Math.round((1 - price / est) * 100);
  }
  return undefined;
}

/** Map a stored candidate row to a flat DigestLead (pure; reuses the M4 rank). */
export function toDigestLead(row: {
  address: string | null;
  postcode: string | null;
  fitPct: number | null;
  candidate: StoredCandidate;
}): DigestLead {
  const c = row.candidate;
  const match = c.match;
  const sources = candidateSources(c);
  const firstLink = sources.find((s) => isHttp(s.listingUrl))?.listingUrl ?? c.listingUrl;
  const neg = c.radar?.negotiability?.probability;
  return {
    address: row.address ?? 'Unknown address',
    postcode: row.postcode ?? undefined,
    rankPct: rankScorePct(signalsOf({ fitPct: row.fitPct, radar: c.radar })),
    fitPct: row.fitPct ?? 0,
    matched: !!match?.matched,
    investorName: match?.matched ? match.investorName : undefined,
    discountPct: discountBelowEst(c),
    negotiabilityPct: typeof neg === 'number' ? Math.round(neg * 100) : undefined,
    market: leadMarket({ channel: c.channel, market: c.market }),
    source: leadSourceLabel({ channel: c.channel, sourceName: c.sourceName }),
    listingUrl: isHttp(firstLink) ? firstLink : undefined,
  };
}

/** The one-line summary under each lead: match, discount, negotiability. */
function leadSummaryParts(lead: DigestLead): string[] {
  const parts: string[] = [];
  parts.push(lead.matched && lead.investorName ? `${lead.fitPct}% fit for ${lead.investorName}` : 'Unmatched');
  if (typeof lead.discountPct === 'number') parts.push(`${lead.discountPct}% below value`);
  if (typeof lead.negotiabilityPct === 'number') parts.push(`${lead.negotiabilityPct}% likely to negotiate`);
  return parts;
}

/**
 * Build the daily review digest email. Pure: returns subject + html + text. The
 * caller (the scheduled Trigger task) resolves the recipient and sends via Resend.
 * `leads` is expected already ranked and capped to the top-N by the caller.
 */
export function buildDigestEmail(input: DigestInput): BuiltEmail {
  const day = fmtDate(input.dateIso);
  const count = input.leads.length;
  const extra = Math.max(0, input.totalPending - count);

  const subject = count === 0
    ? `Deal Review - no new matches for ${day}`
    : `Deal Review - ${count} top ${count === 1 ? 'match' : 'matches'} for ${day}`;

  const intro = count === 0
    ? `No new leads are waiting in your review inbox for ${day}. New matches will appear here as they come in.`
    : `Your top ${count} ranked ${count === 1 ? 'opportunity' : 'opportunities'} for ${day}, best match first. Open the inbox to approve or discard.`;

  // ── Plain text ──
  const textLeads = input.leads.map((lead, i) => {
    const head = `${i + 1}. ${lead.address}${lead.postcode ? `, ${lead.postcode}` : ''} — rank ${lead.rankPct}`;
    const sub = `   ${leadSummaryParts(lead).join(' · ')} · ${lead.market} · ${lead.source}`;
    const link = lead.listingUrl ? `\n   Listing: ${lead.listingUrl}` : '';
    return `${head}\n${sub}${link}`;
  });
  const text = [
    `Hi ${input.partnerName},`,
    '',
    intro,
    ...(count > 0 ? ['', ...textLeads] : []),
    ...(extra > 0 ? ['', `Plus ${extra} more waiting in the inbox.`] : []),
    '',
    `Review them here: ${input.reviewUrl}`,
    '',
    'Bullseye Properties',
  ].join('\n');

  // ── HTML ──
  const leadRows = input.leads.map((lead, i) => {
    const eAddr = escapeHtml(lead.address);
    const ePc = lead.postcode ? escapeHtml(lead.postcode) : '';
    const summary = escapeHtml(leadSummaryParts(lead).join('  ·  '));
    const marketTag = escapeHtml(lead.market === 'on-market' ? 'On-market' : 'Off-market');
    const eSource = escapeHtml(lead.source);
    const link = lead.listingUrl
      ? `<a href="${lead.listingUrl}" style="color:${NAVY};font-size:12px;text-decoration:none;font-weight:bold;">View listing &rarr;</a>`
      : '';
    return `
      <tr><td style="padding:14px 0;border-top:1px solid #eceef1;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;">
            <div style="font-size:15px;font-weight:bold;color:${INK};">${i + 1}. ${eAddr}${ePc ? ` <span style="font-weight:normal;color:${MUTED};">${ePc}</span>` : ''}</div>
            <div style="font-size:13px;color:${INK};margin-top:3px;">${summary}</div>
            <div style="font-size:12px;color:${MUTED};margin-top:3px;">${marketTag} · ${eSource}${link ? ' · ' : ''}</div>
            ${link ? `<div style="margin-top:4px;">${link}</div>` : ''}
          </td>
          <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
            <span style="display:inline-block;background:${NAVY};color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:8px;">rank ${lead.rankPct}</span>
          </td>
        </tr></table>
      </td></tr>`;
  }).join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
          <tr><td style="background:${NAVY};padding:20px 28px;">
            <span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.5px;">Bullseye Properties · Deal Review</span>
          </td></tr>
          <tr><td style="padding:26px 28px 8px 28px;">
            <p style="margin:0 0 14px 0;font-size:15px;">Hi ${escapeHtml(input.partnerName)},</p>
            <p style="margin:0 0 6px 0;font-size:15px;line-height:1.55;">${escapeHtml(intro)}</p>
          </td></tr>
          ${count > 0 ? `<tr><td style="padding:8px 28px 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${leadRows}</table></td></tr>` : ''}
          ${extra > 0 ? `<tr><td style="padding:10px 28px 0 28px;"><p style="margin:0;font-size:13px;color:${MUTED};">Plus ${extra} more waiting in the inbox.</p></td></tr>` : ''}
          <tr><td style="padding:22px 28px 28px 28px;">
            <a href="${input.reviewUrl}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 26px;border-radius:10px;">Open the review inbox</a>
          </td></tr>
          <tr><td style="padding:0 28px 26px 28px;border-top:1px solid #eceef1;">
            <p style="margin:16px 0 0 0;font-size:12px;color:${MUTED};line-height:1.5;">
              You are receiving this because you are an Accredited Bullseye Partner. Leads are ranked by
              client-fit, discount and negotiability. This is an internal sourcing summary, not advice.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
