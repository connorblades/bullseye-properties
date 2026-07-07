import { describe, expect, it } from 'vitest';
import {
  postcodeDistrict,
  normaliseTown,
  canonicalTown,
  buildCompIndex,
  matchListing,
  auctionConfidence,
  auctionReasons,
  listingToCandidate,
  AUCTION_DISCOUNT_THRESHOLD,
  type AuctionComp,
  type AuctionListing,
} from '@/server/deal-radar/auction-match';
import {
  feedPropertyType,
  normaliseFeedListing,
  fetchLiveListings,
  FIXTURE_LISTINGS,
  type RawFeedListing,
} from '@/server/deal-radar/live-listings';

// A terraced comp on Church Street, Swinton (S64). Prices chosen so the like-for-
// like median is a clean £120,000 and the max £145,000.
const comp = (price: number, over: Partial<AuctionComp> = {}): AuctionComp => ({
  district: 'S64',
  town: 'swinton',
  street: 'CHURCH STREET',
  ptype: 'T',
  price,
  date: '2024-06-01',
  ...over,
});

const CHURCH_STREET_COMPS: AuctionComp[] = [95, 100, 105, 110, 115, 118, 122, 128, 132, 138, 142, 145].map((k) =>
  comp(k * 1000)
);

const listing = (over: Partial<AuctionListing> = {}): AuctionListing => ({
  address: '14 CHURCH STREET, SWINTON, S64 8QA',
  postcode: 'S64 8QA',
  district: 'S64',
  town: 'swinton',
  street: 'Church Street',
  ptype: 'T',
  guidePrice: 96000,
  listingUrl: 'https://feed.example/lot/14-church-street',
  ...over,
});

describe('normalisation helpers', () => {
  it('postcodeDistrict pulls the leading district', () => {
    expect(postcodeDistrict('S64 8QA')).toBe('S64');
    expect(postcodeDistrict('ng18 5qh')).toBe('NG18');
    expect(postcodeDistrict('not a postcode')).toBe('');
  });

  it('normaliseTown resolves aliases and parses addresses', () => {
    expect(normaliseTown('New Ollerton')).toBe('ollerton'); // alias
    expect(normaliseTown('12 High Street, Worksop, Nottinghamshire')).toBe('worksop');
    expect(normaliseTown('1 Some Road, Gainsborough')).toBe('gainsborough'); // address-parsed, no alias
    expect(normaliseTown('12 Nowhere')).toBe('');
  });

  it('canonicalTown keeps towns outside the alias map', () => {
    expect(canonicalTown('Forest Town')).toBe('mansfield'); // alias
    expect(canonicalTown('GAINSBOROUGH')).toBe('gainsborough'); // kept, lower-cased
  });
});

describe('buildCompIndex', () => {
  it('indexes each comp by both its district and town key', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    expect(index.byDistrict.get('s64|church street|t')?.length).toBe(12);
    expect(index.byTown.get('swinton|church street|t')?.length).toBe(12);
  });

  it('skips comps with no street or type', () => {
    const index = buildCompIndex([comp(100000, { street: '' }), comp(100000, { ptype: '' as AuctionComp['ptype'] })]);
    expect(index.byDistrict.size).toBe(0);
    expect(index.byTown.size).toBe(0);
  });
});

describe('matchListing', () => {
  const index = buildCompIndex(CHURCH_STREET_COMPS);

  it('flags a guide 20% below the district comp median', () => {
    const m = matchListing(listing(), index)!;
    expect(m.discounted).toBe(true);
    expect(m.matchBasis).toBe('district');
    expect(m.bucketLabel).toBe('S64');
    expect(m.medianComp).toBe(120000);
    expect(m.maxComp).toBe(145000);
    expect(m.compCount).toBe(12);
    expect(m.discountVsMedian).toBe(20);
    expect(m.discountVsMax).toBe(33.8);
    expect(m.priceLabel).toBe('guide');
  });

  it('falls back to the town key when the district key misses', () => {
    // No postcode district on the listing, so the district lookup is empty.
    const m = matchListing(listing({ district: '', postcode: '' }), index)!;
    expect(m.discounted).toBe(true);
    expect(m.matchBasis).toBe('town');
    expect(m.bucketLabel).toBe('swinton');
  });

  it('prefers asking price only when there is no guide', () => {
    const m = matchListing(listing({ guidePrice: undefined, askingPrice: 96000 }), index)!;
    expect(m.priceLabel).toBe('asking');
    expect(m.discounted).toBe(true);
  });

  it('does not flag a listing at or above the comp median', () => {
    const m = matchListing(listing({ guidePrice: undefined, askingPrice: 145000 }), index)!;
    expect(m.discounted).toBe(false);
    expect(m.discountVsMedian).toBeLessThan(15);
  });

  it('treats exactly 15% below the median as discounted (threshold boundary)', () => {
    // Four identical £100k comps -> median 100,000. 0.85 * 100000 = 85,000.
    const flat = buildCompIndex([comp(100000), comp(100000), comp(100000), comp(100000)]);
    const atThreshold = matchListing(listing({ guidePrice: 85000 }), flat)!;
    expect(atThreshold.discountVsMedian).toBe(15);
    expect(atThreshold.discounted).toBe(true);
    const justAbove = matchListing(listing({ guidePrice: 85001 }), flat)!;
    expect(justAbove.discounted).toBe(false);
  });

  it('falls back to all comps when fewer than two survive the like-for-like band', () => {
    // A single in-band comp forces the <2 fallback to the full (capped) set.
    const index2 = buildCompIndex([comp(100000), comp(260000), comp(280000)]);
    // Guide 90k: band [36k,144k] keeps only the 100k comp (1 < 2) -> fall back to all.
    const m = matchListing(listing({ guidePrice: 90000 }), index2)!;
    expect(m.compCount).toBe(3);
    expect(m.medianComp).toBe(260000);
  });

  it('drops comps above the sanity cap before computing the median', () => {
    // 300k cap: the 320k comp is excluded from allPrices entirely.
    const index2 = buildCompIndex([comp(100000), comp(120000), comp(320000)]);
    const m = matchListing(listing({ guidePrice: 80000 }), index2)!;
    expect(m.maxComp).toBe(120000);
  });

  it('returns null when no cohort matches or there is no price', () => {
    expect(matchListing(listing({ street: 'NOWHERE LANE' }), index)).toBeNull();
    expect(matchListing(listing({ guidePrice: undefined, askingPrice: undefined }), index)).toBeNull();
  });
});

describe('auctionConfidence', () => {
  it('is the median discount depth tempered by comp-sample reliability', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    // 20% below, 12 comps (>= 8) -> reliability 1 -> 0.20.
    expect(auctionConfidence(matchListing(listing(), index)!)).toBe(0.2);
    // Same depth but only 4 comps -> reliability 0.5 -> 0.075 at 15% below.
    const flat = buildCompIndex([comp(100000), comp(100000), comp(100000), comp(100000)]);
    expect(auctionConfidence(matchListing(listing({ guidePrice: 85000 }), flat)!)).toBe(0.075);
  });
});

describe('auctionReasons', () => {
  it('ranks the plain-English reasons strongest-first', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const m = matchListing(listing(), index)!;
    expect(auctionReasons(listing(), m)).toEqual([
      'guide 20% below S64 terraced median of 12 comps',
      '34% below the top comp of £145,000',
      'guide £96,000 vs £120,000 median',
      'matched on postcode district S64',
    ]);
  });

  it('names the town when matched via the town key', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const l = listing({ district: '', postcode: '' });
    const m = matchListing(l, index)!;
    expect(auctionReasons(l, m).at(-1)).toBe('matched on town swinton');
  });
});

describe('listingToCandidate (emit contract)', () => {
  it('produces an auction ScrapedCandidate carrying guide price + the radar block', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const l = listing();
    const m = matchListing(l, index)!;
    const c = listingToCandidate(l, m, { run: 'run-9', capturedAt: '2026-07-06T09:00:00.000Z' });
    expect(c.channel).toBe('auction');
    expect(c.propertyType).toBe('Terraced');
    expect(c.guidePrice).toBe(96000);
    expect(c.sourceRef).toBe('arf:run-9:https://feed.example/lot/14-church-street');
    expect(c.capturedAt).toBe('2026-07-06T09:00:00.000Z');
    expect(c.radar?.discountConfidence).toBe(0.2);
    expect(c.radar?.estMarketValue).toBe(120000); // comp median, 5k-rounded
    expect(c.radar?.estAchievable).toBe(95000); // guide 96,000 -> nearest 5k
    expect(c.radar?.discountReasons?.[0]).toBe('guide 20% below S64 terraced median of 12 comps');
  });

  it('HPI-adjusts the market value before rounding', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const l = listing();
    const m = matchListing(l, index)!;
    const c = listingToCandidate(l, m, { run: 'r', capturedAt: '', hpiFactor: 1.04 });
    // 120000 * 1.04 = 124800 -> 125000.
    expect(c.radar?.estMarketValue).toBe(125000);
  });

  it('falls back to postcode:address for sourceRef when there is no listing url', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const l = listing({ listingUrl: undefined });
    const c = listingToCandidate(l, matchListing(l, index)!, { run: 'r', capturedAt: '' });
    expect(c.sourceRef).toBe('arf:r:S64 8QA:14 CHURCH STREET, SWINTON, S64 8QA');
  });
});

describe('feed adapter (live-listings, no scraper)', () => {
  it('feedPropertyType maps free text to a Land Registry code', () => {
    expect(feedPropertyType('Terraced house')).toBe('T');
    expect(feedPropertyType('Semi-detached house')).toBe('S');
    expect(feedPropertyType('Detached bungalow')).toBe('D');
    expect(feedPropertyType('2 bed flat')).toBe('F');
    expect(feedPropertyType('Maisonette')).toBe('F');
    expect(feedPropertyType('Land')).toBeNull();
  });

  it('normaliseFeedListing resolves district/town/street and drops half-formed rows', () => {
    const l = normaliseFeedListing({
      address: '14 Church Street, Swinton, S64 8QA',
      postcode: 'S64 8QA',
      propertyType: 'Terraced house',
      guidePrice: 96000,
    })!;
    expect(l.district).toBe('S64');
    expect(l.town).toBe('swinton');
    expect(l.street).toBe('Church Street'); // parsed from the address
    expect(l.ptype).toBe('T');

    expect(normaliseFeedListing({ address: 'x', propertyType: 'Terraced', guidePrice: 1 } as RawFeedListing)).not.toBeNull();
    expect(normaliseFeedListing({ address: '', propertyType: 'Terraced', guidePrice: 1 })).toBeNull(); // no address
    expect(normaliseFeedListing({ address: '1 A St, Worksop', propertyType: 'Land', guidePrice: 1 })).toBeNull(); // bad type
    expect(normaliseFeedListing({ address: '1 A St, Worksop', propertyType: 'Terraced' })).toBeNull(); // no price
  });

  it('fetchLiveListings returns [] when no source is configured (never scrapes)', async () => {
    expect(await fetchLiveListings()).toEqual([]);
  });

  it('fetchLiveListings normalises an injected fixture feed', async () => {
    const listings = await fetchLiveListings({ fixture: FIXTURE_LISTINGS });
    // Three fixture rows, all well-formed and mappable.
    expect(listings.length).toBe(3);
    expect(listings[0].ptype).toBe('T');
    expect(listings[1].town).toBe('worksop');
  });
});

describe('golden end-to-end (fixture feed -> auction candidate)', () => {
  it('a fixture listing 20% below a real-shaped cohort emits the expected candidate', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const raw = FIXTURE_LISTINGS[0]; // 14 Church Street, guide 96,000
    const l = normaliseFeedListing(raw)!;
    const m = matchListing(l, index)!;
    expect(m.discounted).toBe(true);
    const c = listingToCandidate(l, m, { run: 'golden', capturedAt: '2026-07-06T00:00:00.000Z' });
    expect(c.channel).toBe('auction');
    expect(c.radar).toEqual({
      discountConfidence: 0.2,
      discountReasons: [
        'guide 20% below S64 terraced median of 12 comps',
        '34% below the top comp of £145,000',
        'guide £96,000 vs £120,000 median',
        'matched on postcode district S64',
      ],
      estMarketValue: 120000,
      estAchievable: 95000,
    });
  });

  it('the control fixture listing (priced above median) does not flag', () => {
    const index = buildCompIndex(CHURCH_STREET_COMPS);
    const l = normaliseFeedListing(FIXTURE_LISTINGS[2])!; // asking 145,000
    expect(matchListing(l, index)!.discounted).toBe(false);
  });

  it('AUCTION_DISCOUNT_THRESHOLD is the proof 0.85 (15% below)', () => {
    expect(AUCTION_DISCOUNT_THRESHOLD).toBe(0.85);
  });
});
