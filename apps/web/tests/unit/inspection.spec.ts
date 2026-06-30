import { describe, expect, it } from 'vitest';
import {
  CONTINGENCY_PCT,
  INSPECTION_KIT,
  INSPECTION_STEPS,
  MIN_CONTINGENCY_GBP,
  PRICE_BOOK,
  ZONE_ORDER,
  architraveTakeoff,
  contingencyFor,
  itemCost,
  kitForSteps,
  paintTakeoff,
  plasterTakeoff,
  refurbEstimate,
  roomGeometry,
  roomTakeoff,
  skirtingTakeoff,
  stepsForProperty,
  summariseRefurb,
} from '@/lib/inspection';

describe('INSPECTION_STEPS model', () => {
  it('every cost-bearing step references a real price-book key', () => {
    for (const s of INSPECTION_STEPS) {
      if (s.costMode) {
        expect(s.priceKey, `${s.key} needs a priceKey`).toBeTruthy();
        expect(PRICE_BOOK[s.priceKey!], `${s.priceKey} missing from PRICE_BOOK`).toBeDefined();
      }
    }
  });

  it('an area step uses an area price and a unit step uses a unit price', () => {
    for (const s of INSPECTION_STEPS) {
      if (!s.costMode) continue;
      expect(PRICE_BOOK[s.priceKey!].kind).toBe(s.costMode);
    }
  });

  it('covers all zones in the outside-in order', () => {
    const zones = new Set(INSPECTION_STEPS.map((s) => s.zone));
    for (const z of ZONE_ORDER) expect(zones.has(z.zone)).toBe(true);
    expect(ZONE_ORDER[0].zone).toBe('external-roof');
    expect(ZONE_ORDER[1].zone).toBe('loft');
  });

  it('the spray-foam step is a walk-away signal, not a costed item', () => {
    const sf = INSPECTION_STEPS.find((s) => s.key === 'spray-foam');
    expect(sf?.walkAwaySignal).toBe(true);
    expect(sf?.costMode).toBeUndefined();
  });
});

describe('stepsForProperty', () => {
  it('hides gable caps for a mid-terrace and shows them for an end/semi', () => {
    const mid = stepsForProperty({ endOrSemi: false });
    const end = stepsForProperty({ endOrSemi: true });
    expect(mid.some((s) => s.key === 'gable-caps')).toBe(false);
    expect(end.some((s) => s.key === 'gable-caps')).toBe(true);
  });
});

describe('itemCost', () => {
  it('prices an area item by captured area x rate', () => {
    // loft-insulation: 8 material + 7 labour per sqm; 20 sqm
    const c = itemCost({ label: 'Loft insulation', priceKey: 'loft-insulation', areaSqm: 20 });
    expect(c.material).toBe(160);
    expect(c.labour).toBe(140);
    expect(c.total).toBe(300);
  });

  it('prices a unit item by quantity x rate', () => {
    // window: 450 material + 150 labour each; 3 windows
    const c = itemCost({ label: 'Windows', priceKey: 'window', quantity: 3 });
    expect(c.material).toBe(1350);
    expect(c.labour).toBe(450);
    expect(c.total).toBe(1800);
  });

  it('honours per-item overrides', () => {
    const c = itemCost({ label: 'Board', priceKey: 'consumer-unit', quantity: 1, overrideLabour: 300 });
    expect(c.material).toBe(150); // book material kept
    expect(c.labour).toBe(300); // override applied
  });

  it('costs nothing for an unknown price key or zero quantity', () => {
    expect(itemCost({ label: 'x', priceKey: 'nope', quantity: 5 }).total).toBe(0);
    expect(itemCost({ label: 'win', priceKey: 'window', quantity: 0 }).total).toBe(0);
  });

  it('never goes negative on a negative input', () => {
    expect(itemCost({ label: 'win', priceKey: 'window', quantity: -2 }).total).toBe(0);
  });
});

describe('contingencyFor', () => {
  it('is the £3,000 floor when 15% is below it', () => {
    expect(contingencyFor(10_000)).toBe(MIN_CONTINGENCY_GBP); // 15% = 1500 < 3000
  });

  it('is 15% once that exceeds the floor', () => {
    expect(contingencyFor(40_000)).toBe(40_000 * (CONTINGENCY_PCT / 100)); // 6000
  });

  it('is zero when nothing needs doing', () => {
    expect(contingencyFor(0)).toBe(0);
  });
});

describe('refurbEstimate', () => {
  it('sums lines, splits material/labour, and adds the contingency', () => {
    const est = refurbEstimate([
      { label: 'Windows', priceKey: 'window', quantity: 4 }, // 1800 + 600 = 2400
      { label: 'Loft insulation', priceKey: 'loft-insulation', areaSqm: 30 }, // 240 + 210 = 450
    ]);
    expect(est.materialSubtotal).toBe(1800 + 240);
    expect(est.labourSubtotal).toBe(600 + 210);
    expect(est.subtotal).toBe(2850);
    expect(est.contingency).toBe(MIN_CONTINGENCY_GBP); // 15% of 2850 = 427.5 < 3000
    expect(est.total).toBe(2850 + 3000);
  });

  it('applies a percentage contingency on a large refurb', () => {
    const est = refurbEstimate([{ label: 'Kitchen', priceKey: 'kitchen-refit', quantity: 10 }]); // 40000
    expect(est.subtotal).toBe(40_000);
    expect(est.contingency).toBe(6000); // 15%
    expect(est.total).toBe(46_000);
  });
});

describe('kit list', () => {
  it('lists the three tools (ladder, laser, damp meter) for a normal property', () => {
    const kit = kitForSteps(stepsForProperty());
    const keys = kit.map((k) => k.key);
    expect(keys).toContain('laser-measure');
    expect(keys).toContain('telescopic-ladder');
    expect(keys).toContain('damp-meter');
  });

  it('keeps INSPECTION_KIT order', () => {
    const keys = kitForSteps(stepsForProperty()).map((k) => k.key);
    const order = INSPECTION_KIT.map((k) => k.key);
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
  });
});

describe('roomGeometry', () => {
  it('derives floor, perimeter and wall areas from L x W x H', () => {
    const g = roomGeometry({ name: 'Lounge', lengthM: 5, widthM: 4, heightM: 2.4 });
    expect(g.floorArea).toBe(20);
    expect(g.perimeter).toBe(18);
    expect(g.wallArea).toBe(43.2);
  });
});

describe('measured take-offs', () => {
  const g = roomGeometry({ name: 'Lounge', lengthM: 5, widthM: 4, heightM: 2.4 }); // walls 43.2 sqm, perimeter 18 m

  it('plaster: walls + 10% waste / 12 sqm per bag, rounded up', () => {
    const l = plasterTakeoff(g);
    expect(l.quantity).toBe(4); // 43.2 * 1.1 = 47.52 / 12 = 3.96 -> 4 bags
    expect(l.material).toBe(48); // 4 @ £12
    expect(l.labour).toBe(691); // 43.2 @ £16
    expect(l.basis).toContain('bag');
  });

  it('paint: walls x 2 coats + 10% / 12 sqm per litre, rounded up', () => {
    const l = paintTakeoff(g);
    expect(l.quantity).toBe(8); // 86.4 * 1.1 = 95.04 / 12 = 7.92 -> 8 L
    expect(l.material).toBe(40); // 8 @ £5
  });

  it('skirting: perimeter + 10%, rounded up to whole metres', () => {
    const l = skirtingTakeoff(g);
    expect(l.quantity).toBe(20); // 18 * 1.1 = 19.8 -> 20 m
    expect(l.material).toBe(120); // 20 @ £6
  });

  it('architrave: door count x 5.1 m + 10%', () => {
    const l = architraveTakeoff(2);
    expect(l.quantity).toBe(12); // 10.2 * 1.1 = 11.22 -> 12 m
    expect(l.material).toBe(60); // 12 @ £5
  });

  it('roomTakeoff prefixes lines with the room name and feeds the estimate', () => {
    const lines = roomTakeoff({ name: 'Lounge', lengthM: 5, widthM: 4, heightM: 2.4, doors: 2 }, [
      'plaster',
      'paint',
      'skirting',
      'architrave',
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0].label).toBe('Lounge: Plastering');
    const est = summariseRefurb(lines);
    expect(est.subtotal).toBe(lines.reduce((s, l) => s + l.total, 0));
    expect(est.contingency).toBe(MIN_CONTINGENCY_GBP); // small job -> £3k floor
  });
});
