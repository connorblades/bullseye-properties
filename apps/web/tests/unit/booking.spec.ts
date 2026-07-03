import { describe, expect, it } from 'vitest';
import {
  bookingStatus,
  buildIcs,
  propertyBrief,
  isEndOrSemi,
  DEFAULT_DURATION_MINS,
  type ViewingBooking,
} from '@/lib/booking';
import { emptyDeal, type Deal } from '@/lib/deal-store';

function deal(overrides: Partial<Deal> = {}): Deal {
  return emptyDeal('deal-abc', {
    address: '12 Test Street, Sheffield',
    postcode: 'S1 2AB',
    client: 'Jane Client',
    ...overrides,
  });
}

describe('bookingStatus', () => {
  const now = new Date('2026-07-03T12:00:00Z');

  it('reports no booking when the slot is unset', () => {
    const s = bookingStatus(undefined, now);
    expect(s).toMatchObject({ hasSlot: false, isPast: false, hasConfirmation: false });
    expect(s.label).toBe('No viewing booked');
  });

  it('marks a future slot as booked and not past', () => {
    const s = bookingStatus({ scheduledAt: '2026-07-10T10:00:00Z' }, now);
    expect(s.hasSlot).toBe(true);
    expect(s.isPast).toBe(false);
    expect(s.label).toBe('Viewing booked');
  });

  it('marks a past slot as complete', () => {
    const s = bookingStatus({ scheduledAt: '2026-07-01T10:00:00Z' }, now);
    expect(s.isPast).toBe(true);
    expect(s.label).toBe('Viewing complete');
  });

  it('detects an attached confirmation from text or image', () => {
    expect(bookingStatus({ confirmation: { text: '  ' } }, now).hasConfirmation).toBe(false);
    expect(bookingStatus({ confirmation: { text: 'Confirmed for 10am' } }, now).hasConfirmation).toBe(true);
    expect(bookingStatus({ confirmation: { imageData: 'data:image/jpeg;base64,x' } }, now).hasConfirmation).toBe(true);
  });

  it('ignores an unparseable date', () => {
    const s = bookingStatus({ scheduledAt: 'not-a-date' }, now);
    expect(s.hasSlot).toBe(true);
    expect(s.isPast).toBe(false);
  });
});

describe('propertyBrief', () => {
  it('returns only rows with values, pulling from deal + publicData', () => {
    const d = deal({
      property: { type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '£150,000', documents: [] },
      councilTaxBand: 'B',
      publicData: {
        postcode: 'S1 2AB',
        status: {},
        epc: { currentRating: 'D', currentScore: 58, potentialRating: 'B', potentialScore: 82, floorAreaM2: 74, ageBand: '1900-1929', mainHeating: 'Gas boiler' },
        pricePaid: { postcode: 'S1 2AB', transactions: [{ date: '2019-05-01', price: 120000, paon: '12', street: 'Test Street', postcode: 'S1 2AB', propertyType: 'Semi', newBuild: false, tenure: 'Freehold' }] },
      },
    });
    const rows = propertyBrief(d);
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map['Address']).toContain('12 Test Street');
    expect(map['Type']).toBe('Semi-detached');
    expect(map['Bedrooms']).toBe('3');
    expect(map['Floor area']).toBe('74 m²');
    expect(map['Tenure']).toBe('Freehold');
    expect(map['Asking price']).toBe('£150,000');
    expect(map['Council tax band']).toBe('B');
    expect(map['EPC']).toBe('D (potential B)');
    expect(map['Construction age']).toBe('1900-1929');
    expect(map['Heating']).toBe('Gas boiler');
    // No plotSize/parking rows leak through as empty.
    expect(rows.every((r) => r.value.trim().length > 0)).toBe(true);
  });

  it('prefers the entered floor area over EPC', () => {
    const d = deal({
      property: { type: '', bedrooms: '', bathrooms: '', floorArea: '900 sqft', plotSize: '', parking: '', yearBuilt: '', heating: '', askingPrice: '', documents: [] },
      publicData: { postcode: 'S1 2AB', status: {}, epc: { currentRating: 'C', currentScore: 70, potentialRating: 'B', potentialScore: 80, floorAreaM2: 74 } },
    });
    const map = Object.fromEntries(propertyBrief(d).map((r) => [r.label, r.value]));
    expect(map['Floor area']).toBe('900 sqft');
  });
});

describe('isEndOrSemi', () => {
  it('detects end-terrace and semi', () => {
    expect(isEndOrSemi(deal({ property: { ...emptyDeal('x').property, type: 'End-terrace' } }))).toBe(true);
    expect(isEndOrSemi(deal({ property: { ...emptyDeal('x').property, type: 'Semi-detached' } }))).toBe(true);
    expect(isEndOrSemi(deal({ property: { ...emptyDeal('x').property, type: 'Mid-terrace' } }))).toBe(false);
    expect(isEndOrSemi(deal({ property: { ...emptyDeal('x').property, type: 'Detached' } }))).toBe(false);
  });
});

describe('buildIcs', () => {
  const dtstamp = new Date('2026-07-03T09:00:00Z');
  const booking: ViewingBooking = {
    scheduledAt: '2026-07-10T14:30:00Z',
    durationMins: 45,
    attendee: 'Connor',
    agentName: 'Foxtons; Sheffield',
    agentPhone: '0114 000 0000',
    location: '12 Test Street, meet at front',
  };

  it('returns null without a valid slot', () => {
    expect(buildIcs(deal(), undefined, dtstamp)).toBeNull();
    expect(buildIcs(deal(), { scheduledAt: 'nope' }, dtstamp)).toBeNull();
  });

  it('builds a valid VEVENT with CRLF lines and UTC stamps', () => {
    const res = buildIcs(deal(), booking, dtstamp)!;
    expect(res).not.toBeNull();
    const c = res.content;
    expect(c.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(c.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(c).toContain('DTSTART:20260710T143000Z');
    expect(c).toContain('DTSTAMP:20260703T090000Z');
    // 14:30 + 45m = 15:15.
    expect(c).toContain('DTEND:20260710T151500Z');
    expect(c).toContain('SUMMARY:Viewing: 12 Test Street\\, Sheffield');
    expect(c).toContain('UID:viewing-deal-abc-20260710T143000Z@bullseyeproperties.co.uk');
    expect(res.filename).toBe('viewing-12-test-street-sheffield.ics');
  });

  it('escapes commas and semicolons in text values', () => {
    const c = buildIcs(deal(), booking, dtstamp)!.content;
    expect(c).toContain('Agent: Foxtons\\; Sheffield');
  });

  it('defaults the duration to 30 minutes', () => {
    const c = buildIcs(deal(), { scheduledAt: '2026-07-10T09:00:00Z' }, dtstamp)!.content;
    expect(c).toContain('DTSTART:20260710T090000Z');
    expect(c).toContain('DTEND:20260710T093000Z');
    expect(DEFAULT_DURATION_MINS).toBe(30);
  });
});
