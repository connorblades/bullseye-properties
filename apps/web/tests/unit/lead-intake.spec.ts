import { describe, expect, it } from 'vitest';
import {
  normaliseCandidate,
  mapSource,
  composeAddress,
  dedupeKey,
  candidateToDealInput,
  leadMarket,
  leadSourceLabel,
  type ScrapedCandidate,
} from '@/lib/lead-intake';

function candidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    address: '12 Browning Street, Mansfield, NG18 5QH',
    channel: 'portal',
    ...overrides,
  };
}

describe('normaliseCandidate', () => {
  it('trims strings and drops empties', () => {
    const c = normaliseCandidate(candidate({
      address: '  12 Browning Street,   Mansfield, NG18 5QH ',
      propertyType: '  Semi-detached ',
      tenure: '   ',
      client: '',
    }));
    expect(c.address).toBe('12 Browning Street, Mansfield, NG18 5QH');
    expect(c.propertyType).toBe('Semi-detached');
    expect(c.tenure).toBeUndefined();
    expect(c.client).toBeUndefined();
  });

  it('drops non-positive/invalid numbers but keeps 0 bedrooms', () => {
    const c = normaliseCandidate(candidate({
      guidePrice: 0,
      askingPrice: -5,
      expectedRent: NaN,
      bedrooms: 0,
    }));
    expect(c.guidePrice).toBeUndefined();
    expect(c.askingPrice).toBeUndefined();
    expect(c.expectedRent).toBeUndefined();
    expect(c.bedrooms).toBe(0);
  });

  it('backfills postcode from the address when missing', () => {
    const c = normaliseCandidate(candidate({ postcode: undefined }));
    expect(c.postcode).toBe('NG18 5QH');
  });

  it('normalises an explicit postcode to canonical form', () => {
    const c = normaliseCandidate(candidate({ postcode: 'ng185qh' }));
    expect(c.postcode).toBe('NG18 5QH');
  });

  it('upper-cases the EPC rating', () => {
    const c = normaliseCandidate(candidate({ epcRating: 'd' }));
    expect(c.epcRating).toBe('D');
  });

  it('cleans nested criteria and radar', () => {
    const c = normaliseCandidate(candidate({
      criteria: { budget: ' £130,000 ', areas: 'Mansfield ', propertyType: '', targetYield: '7%+' },
      radar: {
        discountConfidence: 0.8,
        discountReasons: ['Below comps', '', '  Long listing '],
        estMarketValue: 150000,
        estAchievable: 0,
      },
    }));
    expect(c.criteria?.budget).toBe('£130,000');
    expect(c.criteria?.areas).toBe('Mansfield');
    expect(c.criteria?.propertyType).toBeUndefined();
    expect(c.radar?.discountConfidence).toBe(0.8);
    expect(c.radar?.discountReasons).toEqual(['Below comps', 'Long listing']);
    expect(c.radar?.estMarketValue).toBe(150000);
    expect(c.radar?.estAchievable).toBeUndefined();
  });

  it('is idempotent', () => {
    const once = normaliseCandidate(candidate({ postcode: 'ng185qh', epcRating: 'd' }));
    const twice = normaliseCandidate(once);
    expect(twice).toEqual(once);
  });
});

describe('mapSource', () => {
  it('maps each channel', () => {
    expect(mapSource(candidate({ channel: 'portal' }))).toBe('estate-agent');
    expect(mapSource(candidate({ channel: 'auction' }))).toBe('auction');
    expect(mapSource(candidate({ channel: 'open-data' }))).toBe('direct-to-vendor');
    expect(mapSource(candidate({ channel: 'direct' }))).toBe('direct-to-vendor');
  });
});

describe('composeAddress', () => {
  it('returns the address unchanged when it already has a postcode', () => {
    const c = normaliseCandidate(candidate());
    expect(composeAddress(c)).toBe('12 Browning Street, Mansfield, NG18 5QH');
  });

  it('appends the postcode when the address lacks one', () => {
    const c = normaliseCandidate(candidate({ address: '12 Browning Street, Mansfield', postcode: 'NG18 5QH' }));
    const out = composeAddress(c);
    expect(out).toBe('12 Browning Street, Mansfield, NG18 5QH');
  });

  it('always contains a postcode extractable by the UK postcode regex', () => {
    const c = normaliseCandidate(candidate({ address: '5 New Lane', postcode: 'S1 2HH' }));
    const out = composeAddress(c);
    expect(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i.test(out)).toBe(true);
  });

  it('returns just the postcode when there is no street text', () => {
    const c = normaliseCandidate(candidate({ address: '', postcode: 'S1 2HH' }));
    expect(composeAddress(c)).toBe('S1 2HH');
  });
});

describe('dedupeKey', () => {
  it('is compact postcode + first house-number token', () => {
    const c = normaliseCandidate(candidate());
    expect(dedupeKey(c)).toBe('NG185QH:12');
  });

  it('collapses the same door across channels', () => {
    const portal = normaliseCandidate(candidate({ channel: 'portal' }));
    const auction = normaliseCandidate(candidate({ channel: 'auction' }));
    expect(dedupeKey(portal)).toBe(dedupeKey(auction));
  });

  it('captures a house-number letter suffix', () => {
    const c = normaliseCandidate(candidate({ address: '12a Browning Street, NG18 5QH' }));
    expect(dedupeKey(c)).toBe('NG185QH:12A');
  });
});

describe('candidateToDealInput', () => {
  it('produces the createDeal shape with pipelineStage leads', () => {
    const input = candidateToDealInput(candidate({
      channel: 'auction',
      propertyType: 'Terraced',
      bedrooms: 3,
      guidePrice: 100000,
      askingPrice: 115000,
      expectedRent: 800,
      client: 'Jane Investor',
      listingUrl: 'https://example.com/lot/1',
      sourceRef: 'LOT-1',
      capturedAt: '2026-07-01T00:00:00.000Z',
      criteria: { budget: '£130,000', areas: 'Mansfield', propertyType: 'Terraced', targetYield: '7%+' },
      radar: { discountConfidence: 0.7, discountReasons: ['Below comps'], estMarketValue: 150000, estAchievable: 140000 },
    }));

    expect(input.address).toContain('NG18 5QH');
    expect(input.source).toBe('auction');
    expect(input.initialInputs.pipelineStage).toBe('leads');
    expect(input.initialInputs.client).toBe('Jane Investor');

    // purchasePrice comes from the guide price, asking mirrored on property.
    expect(input.initialInputs.financials?.purchasePrice).toBe('100000');
    expect(input.initialInputs.financials?.monthlyRent).toBe('800');
    expect(input.initialInputs.property?.askingPrice).toBe('115000');
    expect(input.initialInputs.property?.type).toBe('Terraced');
    expect(input.initialInputs.property?.bedrooms).toBe('3');

    expect(input.initialInputs.criteria?.budget).toBe('£130,000');
    expect(input.initialInputs.criteria?.targetYield).toBe('7%+');

    expect(input.initialInputs.leadSource?.channel).toBe('auction');
    expect(input.initialInputs.leadSource?.listingUrl).toBe('https://example.com/lot/1');
    expect(input.initialInputs.leadSource?.discountConfidence).toBe(0.7);
    expect(input.initialInputs.leadSource?.estMarketValue).toBe(150000);
  });

  it('falls back to askingPrice for purchasePrice when there is no guide', () => {
    const input = candidateToDealInput(candidate({ guidePrice: undefined, askingPrice: 120000 }));
    expect(input.initialInputs.financials?.purchasePrice).toBe('120000');
  });

  it('maps portal channel to estate-agent and leaves empty fields blank', () => {
    const input = candidateToDealInput(candidate({ channel: 'portal' }));
    expect(input.source).toBe('estate-agent');
    expect(input.initialInputs.financials?.purchasePrice).toBe('');
    expect(input.initialInputs.financials?.monthlyRent).toBe('');
    expect(input.initialInputs.property?.type).toBe('');
    expect(input.initialInputs.leadSource?.channel).toBe('portal');
  });

  it('omits client and criteria when not provided', () => {
    const input = candidateToDealInput(candidate());
    expect(input.initialInputs.client).toBeUndefined();
    expect(input.initialInputs.criteria).toBeUndefined();
  });

  it('stamps the market tag and source label onto leadSource', () => {
    const fb = candidateToDealInput(
      candidate({ channel: 'direct', market: 'on-market', sourceName: 'Facebook Marketplace' })
    );
    expect(fb.initialInputs.leadSource?.market).toBe('on-market');
    expect(fb.initialInputs.leadSource?.sourceName).toBe('Facebook Marketplace');

    const radar = candidateToDealInput(candidate({ channel: 'open-data' }));
    expect(radar.initialInputs.leadSource?.market).toBe('off-market');
    expect(radar.initialInputs.leadSource?.sourceName).toBe('Deal Radar');
  });
});

describe('leadMarket', () => {
  it('defaults portal and auction to on-market', () => {
    expect(leadMarket({ channel: 'portal' })).toBe('on-market');
    expect(leadMarket({ channel: 'auction' })).toBe('on-market');
  });

  it('defaults open-data and direct to off-market', () => {
    expect(leadMarket({ channel: 'open-data' })).toBe('off-market');
    expect(leadMarket({ channel: 'direct' })).toBe('off-market');
  });

  it('lets an explicit market override the channel default (Facebook/Gumtree)', () => {
    expect(leadMarket({ channel: 'direct', market: 'on-market' })).toBe('on-market');
    expect(leadMarket({ channel: 'portal', market: 'off-market' })).toBe('off-market');
  });
});

describe('leadSourceLabel', () => {
  it('prefers an explicit source name', () => {
    expect(leadSourceLabel({ channel: 'direct', sourceName: 'Gumtree' })).toBe('Gumtree');
    expect(leadSourceLabel({ channel: 'portal', sourceName: '  Rightmove ' })).toBe('Rightmove');
  });

  it('falls back to a per-channel label', () => {
    expect(leadSourceLabel({ channel: 'portal' })).toBe('Estate agent');
    expect(leadSourceLabel({ channel: 'auction' })).toBe('Auction');
    expect(leadSourceLabel({ channel: 'open-data' })).toBe('Deal Radar');
    expect(leadSourceLabel({ channel: 'direct' })).toBe('Direct to vendor');
  });
});

describe('normaliseCandidate carries provenance', () => {
  it('keeps a valid market and source name, drops an invalid market', () => {
    const c = normaliseCandidate(candidate({ market: 'on-market', sourceName: '  Facebook Marketplace ' }));
    expect(c.market).toBe('on-market');
    expect(c.sourceName).toBe('Facebook Marketplace');

    const bad = normaliseCandidate(candidate({ market: 'sold' as unknown as 'on-market' }));
    expect(bad.market).toBeUndefined();
  });
});
