import { describe, expect, it } from 'vitest';
import { buildDigestEmail, toDigestLead, type DigestLead } from '@/lib/lead-digest';
import type { StoredCandidate } from '@/lib/lead-intake';

function candidate(overrides: Partial<StoredCandidate> = {}): StoredCandidate {
  return {
    address: '12 Blyth Road, Worksop',
    channel: 'portal',
    ...overrides,
  } as StoredCandidate;
}

describe('toDigestLead', () => {
  it('derives rank, fit, matched investor, discount and negotiability from a stored row', () => {
    const lead = toDigestLead({
      address: '12 Blyth Road',
      postcode: 'S81 0AA',
      fitPct: 80,
      candidate: candidate({
        guidePrice: 120_000,
        sourceName: 'Rightmove',
        listingUrl: 'https://rightmove.co.uk/123',
        match: { matched: true, investorName: 'Acme Capital', pct: 80, reasons: ['budget fits'] },
        radar: {
          discountConfidence: 0.7,
          estMarketValue: 150_000,
          negotiability: { probability: 0.6, reasons: ['probate area'], baseRate: 0.2 },
        },
      }),
    });
    expect(lead.fitPct).toBe(80);
    expect(lead.matched).toBe(true);
    expect(lead.investorName).toBe('Acme Capital');
    // 1 - 120k/150k = 20% below value.
    expect(lead.discountPct).toBe(20);
    expect(lead.negotiabilityPct).toBe(60);
    expect(lead.market).toBe('on-market');
    expect(lead.source).toBe('Rightmove');
    expect(lead.listingUrl).toBe('https://rightmove.co.uk/123');
    expect(lead.rankPct).toBeGreaterThan(0);
  });

  it('marks an unmatched lead and omits a discount when there is no estimated value above price', () => {
    const lead = toDigestLead({
      address: 'X',
      postcode: null,
      fitPct: 0,
      candidate: candidate({ guidePrice: 120_000, match: { matched: false, pct: 0, reasons: [] } }),
    });
    expect(lead.matched).toBe(false);
    expect(lead.investorName).toBeUndefined();
    expect(lead.discountPct).toBeUndefined();
    expect(lead.negotiabilityPct).toBeUndefined();
  });

  it('drops a non-http listing url', () => {
    const lead = toDigestLead({
      address: 'X',
      postcode: null,
      fitPct: 10,
      candidate: candidate({ listingUrl: 'javascript:alert(1)' }),
    });
    expect(lead.listingUrl).toBeUndefined();
  });
});

function digestLead(overrides: Partial<DigestLead> = {}): DigestLead {
  return {
    address: '12 Blyth Road',
    postcode: 'S81 0AA',
    rankPct: 72,
    fitPct: 80,
    matched: true,
    investorName: 'Acme Capital',
    discountPct: 20,
    negotiabilityPct: 60,
    market: 'on-market',
    source: 'Rightmove',
    listingUrl: 'https://rightmove.co.uk/123',
    ...overrides,
  };
}

describe('buildDigestEmail', () => {
  const base = {
    partnerName: 'Connor',
    dateIso: '2026-07-20T06:00:00.000Z',
    reviewUrl: 'https://os.bullseyeproperties.co.uk/review',
  };

  it('builds a subject + html + text listing the top matches best-first', () => {
    const leads = [digestLead(), digestLead({ address: '5 Oak Way', investorName: 'Beta LP', rankPct: 40 })];
    const email = buildDigestEmail({ ...base, leads, totalPending: 2 });
    expect(email.subject).toContain('2 top matches');
    expect(email.html).toContain('12 Blyth Road');
    expect(email.html).toContain('Acme Capital');
    expect(email.html).toContain('rank 72');
    expect(email.html).toContain(base.reviewUrl);
    expect(email.text).toContain('1. 12 Blyth Road');
    expect(email.text).toContain('2. 5 Oak Way');
    // The listing link is rendered.
    expect(email.html).toContain('https://rightmove.co.uk/123');
  });

  it('shows an empty-state email when there are no leads', () => {
    const email = buildDigestEmail({ ...base, leads: [], totalPending: 0 });
    expect(email.subject).toContain('no new matches');
    expect(email.text).toContain('No new leads');
    // No "rank" rows in an empty digest.
    expect(email.html).not.toContain('rank ');
  });

  it('reports how many more leads are waiting beyond the top-N', () => {
    const email = buildDigestEmail({ ...base, leads: [digestLead()], totalPending: 9 });
    expect(email.text).toContain('Plus 8 more');
    expect(email.html).toContain('Plus 8 more');
  });

  it('escapes html in lead fields', () => {
    const email = buildDigestEmail({
      ...base,
      leads: [digestLead({ address: '<script>x</script>', investorName: 'A & B <Ltd>' })],
      totalPending: 1,
    });
    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; B &lt;Ltd&gt;');
  });

  it('labels an unmatched lead as Unmatched in the summary', () => {
    const email = buildDigestEmail({
      ...base,
      leads: [digestLead({ matched: false, investorName: undefined })],
      totalPending: 1,
    });
    expect(email.text).toContain('Unmatched');
  });

  it('uses no em or en dash anywhere in the rendered email (house style)', () => {
    const email = buildDigestEmail({
      ...base,
      leads: [digestLead(), digestLead({ address: '5 Oak Way', rankPct: 40 })],
      totalPending: 9,
    });
    const dash = /[–—]/;
    expect(dash.test(email.subject)).toBe(false);
    expect(dash.test(email.text)).toBe(false);
    expect(dash.test(email.html)).toBe(false);
  });
});
