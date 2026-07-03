/**
 * Viewing booking (M6-T4) - pure, testable.
 *
 * The pre-viewing logistics that sit in front of the guided inspection:
 *  - a booking slot (date/time, attendee, agent contact) held on the deal;
 *  - a downloadable .ics calendar invite so the slot lands in the partner's real
 *    calendar (we do NOT integrate a calendar API - the app is server-rendered
 *    on Vercel with no per-user OAuth, so an .ics download is the honest, robust
 *    "book from a calendar");
 *  - the "pulled" property brief the viewer arrives with (address, beds, type,
 *    tenure, EPC + age band, council tax), read from data already on the deal.
 *
 * No React, no DB, no fetch - so it is fully unit-testable and reusable from the
 * Stage 8 Before tab and the report. Confirmed against Connor's M6 flow spec.
 */

import type { Deal } from './deal-store';

// ── Booking model (nests into viewing -> inputs jsonb; no migration) ──────────

export interface ViewingConfirmation {
  /** A pasted confirmation email body. */
  text?: string;
  /** A screenshot of the confirmation (data URI), reusing the image upload. */
  imageData?: string;
  filename?: string;
  attachedAt?: string; // ISO
}

export interface ViewingBooking {
  /** ISO datetime of the booked viewing slot. */
  scheduledAt?: string;
  /** Slot length in minutes (default 30). */
  durationMins?: number;
  /** Who is attending for us. */
  attendee?: string;
  /** The estate agent / vendor contact. */
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
  /** Meeting point / access notes; defaults to the property address. */
  location?: string;
  confirmation?: ViewingConfirmation;
}

export const DEFAULT_DURATION_MINS = 30;

// ── Booking status ───────────────────────────────────────────────────────────

export interface BookingStatus {
  hasSlot: boolean;
  isPast: boolean;
  hasConfirmation: boolean;
  /** A short human label for the UI. */
  label: string;
}

/** Summarise a booking for the UI. `now` is injected so this stays pure. */
export function bookingStatus(booking?: ViewingBooking, now: Date = new Date()): BookingStatus {
  const hasSlot = Boolean(booking?.scheduledAt);
  const when = booking?.scheduledAt ? new Date(booking.scheduledAt) : null;
  const validWhen = when && !Number.isNaN(when.getTime()) ? when : null;
  const isPast = validWhen ? validWhen.getTime() < now.getTime() : false;
  const c = booking?.confirmation;
  const hasConfirmation = Boolean(c && ((c.text ?? '').trim() || c.imageData));

  let label = 'No viewing booked';
  if (hasSlot && validWhen) {
    label = isPast ? 'Viewing complete' : 'Viewing booked';
  } else if (hasSlot) {
    label = 'Viewing booked';
  }
  return { hasSlot, isPast, hasConfirmation, label };
}

// ── Property brief ("pull the booked property's details") ─────────────────────

export interface BriefRow {
  label: string;
  value: string;
}

const trimmed = (s?: string | null): string => (s ?? '').trim();

/** First non-empty tenure we can find across the pulled data. */
function tenureOf(deal: Deal): string {
  const titleTenure = deal.publicData?.landOwnership?.titles?.find((t) => trimmed(t.tenure))?.tenure;
  if (trimmed(titleTenure)) return trimmed(titleTenure);
  const paidTenure = deal.publicData?.pricePaid?.transactions?.find((t) => trimmed(t.tenure))?.tenure;
  if (trimmed(paidTenure)) return trimmed(paidTenure);
  return '';
}

/**
 * The booked property's details, "pulled" from data already on the deal +
 * publicData so the viewer arrives informed. Only rows with a value are
 * returned, so the UI never shows empty fields.
 */
export function propertyBrief(deal: Deal): BriefRow[] {
  const p = deal.property;
  const epc = deal.publicData?.epc;
  const rows: BriefRow[] = [];

  const push = (label: string, value?: string | number | null) => {
    const v = typeof value === 'number' ? String(value) : trimmed(value);
    if (v) rows.push({ label, value: v });
  };

  push('Address', deal.address);
  push('Postcode', deal.postcode ?? deal.publicData?.postcode);
  push('Type', p.type || epc?.propertyType);
  push('Bedrooms', p.bedrooms);
  push('Bathrooms', p.bathrooms);
  const area = trimmed(p.floorArea) || (epc?.floorAreaM2 ? `${epc.floorAreaM2} m²` : '');
  push('Floor area', area);
  push('Tenure', tenureOf(deal));
  push('Asking price', p.askingPrice);
  push('Council tax band', deal.councilTaxBand ?? deal.publicData?.councilTax?.band ?? '');
  if (epc?.currentRating) {
    const potential = epc.potentialRating ? ` (potential ${epc.potentialRating})` : '';
    push('EPC', `${epc.currentRating}${potential}`);
  }
  push('Construction age', epc?.ageBand);
  push('Heating', p.heating || epc?.mainHeating);
  return rows;
}

/** True for an end-terrace or semi - drives the conditional gable-caps step. */
export function isEndOrSemi(deal: Deal): boolean {
  return /end|semi/i.test(deal.property?.type ?? '');
}

// ── ICS calendar invite ──────────────────────────────────────────────────────

/** Escape a TEXT value per RFC 5545 (backslash, comma, semicolon, newlines). */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line to <=75 octets with a leading space on continuations. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
}

/** Format an ISO datetime as an ICS UTC stamp (YYYYMMDDTHHMMSSZ). */
function toIcsUtc(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

export interface IcsResult {
  filename: string;
  content: string;
}

/**
 * Build a downloadable .ics invite for a booked viewing. Returns null when no
 * valid slot is set. `dtstamp` (the invite creation time) is injected so this is
 * pure and testable - the UI passes `new Date()` at click time.
 */
export function buildIcs(
  deal: Deal,
  booking: ViewingBooking | undefined,
  dtstamp: Date = new Date(),
): IcsResult | null {
  const iso = booking?.scheduledAt;
  if (!iso) return null;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return null;

  const durationMins = booking?.durationMins && booking.durationMins > 0 ? booking.durationMins : DEFAULT_DURATION_MINS;
  const end = new Date(start.getTime() + durationMins * 60_000);

  const address = trimmed(deal.address) || 'Property viewing';
  const summary = `Viewing: ${address}`;
  const location = trimmed(booking?.location) || address;

  const descParts: string[] = [];
  if (trimmed(booking?.attendee)) descParts.push(`Attendee: ${trimmed(booking?.attendee)}`);
  if (trimmed(booking?.agentName)) descParts.push(`Agent: ${trimmed(booking?.agentName)}`);
  if (trimmed(booking?.agentPhone)) descParts.push(`Agent phone: ${trimmed(booking?.agentPhone)}`);
  if (trimmed(booking?.agentEmail)) descParts.push(`Agent email: ${trimmed(booking?.agentEmail)}`);
  if (trimmed(deal.client)) descParts.push(`Client: ${trimmed(deal.client)}`);
  descParts.push('Booked via Bullseye Platform.');
  const description = descParts.join('\n');

  const uid = `viewing-${deal.id}-${toIcsUtc(start)}@bullseyeproperties.co.uk`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bullseye Properties//Deal Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(dtstamp)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const content = lines.map(foldIcsLine).join('\r\n') + '\r\n';
  const safeAddress = address.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'viewing';
  return { filename: `viewing-${safeAddress}.ics`, content };
}
