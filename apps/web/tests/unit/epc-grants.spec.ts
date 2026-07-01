import { describe, expect, it } from 'vitest';
import {
  bandMeets,
  parseIndicativeCost,
  selectMeasuresToBand,
  summariseGrantWorks,
  sumMeasureCosts,
  type EpcMeasure,
} from '@/lib/epc-grants';

describe('parseIndicativeCost', () => {
  it('parses a range', () => {
    expect(parseIndicativeCost('£100 - £350')).toEqual({ low: 100, high: 350, mid: 225 });
  });
  it('parses thousands with commas', () => {
    expect(parseIndicativeCost('£1,500 - £2,000')).toEqual({ low: 1500, high: 2000, mid: 1750 });
  });
  it('parses a single value', () => {
    expect(parseIndicativeCost('£350')).toEqual({ low: 350, high: 350, mid: 350 });
  });
  it('returns empty for missing or non-numeric text', () => {
    expect(parseIndicativeCost(undefined)).toEqual({});
    expect(parseIndicativeCost('n/a')).toEqual({});
  });
});

describe('bandMeets', () => {
  it('true when equal or better than target', () => {
    expect(bandMeets('C', 'C')).toBe(true);
    expect(bandMeets('B', 'C')).toBe(true);
    expect(bandMeets('A', 'C')).toBe(true);
  });
  it('false when worse than target or unknown', () => {
    expect(bandMeets('D', 'C')).toBe(false);
    expect(bandMeets('', 'C')).toBe(false);
    expect(bandMeets(undefined, 'C')).toBe(false);
  });
});

const measures: EpcMeasure[] = [
  { summary: 'Loft insulation', indicativeCostText: '£100 - £350', resultingBand: 'E' },
  { summary: 'Cavity wall insulation', indicativeCostText: '£500 - £1,500', resultingBand: 'D' },
  { summary: 'New condensing boiler', indicativeCostText: '£1,500 - £2,000', resultingBand: 'C' },
  { summary: 'Solar water heating', indicativeCostText: '£4,000 - £6,000', resultingBand: 'B' },
];

describe('selectMeasuresToBand', () => {
  it('stops at the first measure that reaches the target', () => {
    const { measures: picked, reaches } = selectMeasuresToBand(measures, 'C');
    expect(reaches).toBe(true);
    expect(picked.map((m) => m.summary)).toEqual([
      'Loft insulation',
      'Cavity wall insulation',
      'New condensing boiler',
    ]);
  });
  it('returns all with reaches=false when the target is never met', () => {
    const short = measures.slice(0, 2); // only reaches D
    const { measures: picked, reaches } = selectMeasuresToBand(short, 'C');
    expect(reaches).toBe(false);
    expect(picked).toHaveLength(2);
  });
});

describe('sumMeasureCosts', () => {
  it('sums the low/high across measures', () => {
    expect(sumMeasureCosts(measures.slice(0, 3))).toEqual({
      low: 100 + 500 + 1500,
      high: 350 + 1500 + 2000,
      mid: Math.round((2100 + 3850) / 2),
    });
  });
});

describe('summariseGrantWorks', () => {
  it('needs no works and costs nothing when already at C or better', () => {
    const g = summariseGrantWorks('B', measures, 'C');
    expect(g.alreadyAtTarget).toBe(true);
    expect(g.measuresToTarget).toHaveLength(0);
    expect(g.cost).toEqual({ low: 0, high: 0, mid: 0 });
  });

  it('selects the works and sums the cost to reach C from a D', () => {
    const g = summariseGrantWorks('D', measures, 'C');
    expect(g.alreadyAtTarget).toBe(false);
    expect(g.reachesTarget).toBe(true);
    expect(g.measuresToTarget).toHaveLength(3);
    expect(g.cost.low).toBe(2100);
    expect(g.cost.high).toBe(3850);
  });

  it('flags when the recommendations do not reach C', () => {
    const g = summariseGrantWorks('E', measures.slice(0, 2), 'C');
    expect(g.reachesTarget).toBe(false);
  });
});
