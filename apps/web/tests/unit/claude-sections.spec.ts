import { describe, expect, it } from 'vitest';
import {
  SECTION_ORDER,
  buildUserPrompt,
  sectionPromptHash,
  parseSectionOutput,
  generateSection,
  SectionResultSchema,
  type SectionKey,
} from '@/server/claude/prompts';
import { buildDealContext } from '@/server/claude/context';
import { emptyDeal, type Deal } from '@/lib/deal-store';
import type { StreamMessageResult } from '@/server/claude/client';

// A Browning Street-style deal, built from the same defaults the wizard uses.
function browningStreet(): Deal {
  return emptyDeal('d-browning-test', {
    address: '12 Browning Street, Mansfield, NG18 5QH',
    postcode: 'NG18 5QH',
    source: 'auction',
    criteria: {
      budget: '£130,000', areas: 'Mansfield, Worksop', propertyType: 'Semi-detached, 2-3 bed',
      targetYield: '7%+', refurbTolerance: 'Light', epcRequirement: 'C or upgradable', timeline: '4 months',
    },
    property: {
      type: 'Semi-detached', bedrooms: '3', bathrooms: '1', floorArea: '780', plotSize: '2200',
      parking: 'Off-street', yearBuilt: 'c. 1950', heating: 'Gas combi (2021)', askingPrice: '120000', documents: [],
    },
    financials: { purchasePrice: '112500', monthlyRent: '800', annualCosts: '1800' },
    viewing: { roof: 'OK', damp: 'Issue', windows: 'Good', heating: 'Good', electrics: 'OK', structure: 'Good', notes: 'Minor damp in rear bedroom.', photos: [] },
    salesComps: [
      { id: 's1', address: '8 Browning Street', detail: 'Sold 2025-08, 740 sqft', value: '£128,000' },
      { id: 's2', address: '21 Tennyson Ave', detail: 'Sold 2025-05, semi', value: '£124,500' },
    ],
    rentalComps: [{ id: 'r1', address: '15 Browning Street', detail: 'Listed 2025-09, 3-bed', value: '£795 / month' }],
    offer: { recommended: '112500', strategy: 'Anchor at 108k citing damp; settle 110-113k. Vendor motivated, probate.' },
  });
}

describe('buildDealContext', () => {
  it('includes the headline partner facts and drops empty fields', () => {
    const ctx = buildDealContext(browningStreet());
    expect(ctx).toContain('12 Browning Street');
    expect(ctx).toContain('Asking price (£): 120000');
    expect(ctx).toContain('Gross yield (%)');
    expect(ctx).toContain('8 Browning Street');
    expect(ctx).toContain('Damp: Issue');
    // No labelled blanks that could tempt invention.
    expect(ctx).not.toMatch(/: \s*$/m);
  });
});

describe('section prompts', () => {
  it('exposes all five sections', () => {
    expect(SECTION_ORDER).toEqual(['why-this-fits', 'location', 'condition', 'offer-rationale', 'next-steps']);
  });

  it('builds a prompt that carries both the template and the deal context', () => {
    const ctx = buildDealContext(browningStreet());
    const prompt = buildUserPrompt('why-this-fits', ctx);
    expect(prompt).toContain('Why this property fits');
    expect(prompt).toContain('--- DEAL DATA ---');
    expect(prompt).toContain('12 Browning Street');
  });

  it('produces a stable 16-char hex prompt-version hash per section', () => {
    for (const key of SECTION_ORDER) {
      const h = sectionPromptHash(key);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    }
    // Distinct templates -> distinct hashes.
    const hashes = SECTION_ORDER.map(sectionPromptHash);
    expect(new Set(hashes).size).toBe(SECTION_ORDER.length);
  });
});

describe('parseSectionOutput', () => {
  it('lifts [VERIFY: ...] markers into verifyFlags while keeping them in the narrative', () => {
    const text = 'The property suits the brief. [VERIFY: confirm the EPC rating] Rents are strong.';
    const r = parseSectionOutput(text);
    expect(r.verifyFlags).toEqual(['confirm the EPC rating']);
    expect(r.narrative).toContain('[VERIFY: confirm the EPC rating]');
  });

  it('rejects empty narrative via the Zod schema', () => {
    expect(() => parseSectionOutput('   ')).toThrow();
  });
});

describe('generateSection with a mocked SDK response', () => {
  // Stand-in for the SDK: returns a recorded response without any network/db.
  function recordedGenerator(text: string) {
    return async (): Promise<StreamMessageResult> => ({
      text,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 1234,
      outputTokens: 256,
      stopReason: 'end_turn',
    });
  }

  it('returns a Zod-valid, audited result for every section on the Browning Street deal', async () => {
    const ctx = buildDealContext(browningStreet());
    for (const key of SECTION_ORDER) {
      const recorded = `Recorded ${key} narrative for Browning Street. [VERIFY: partner to confirm comparable dates]`;
      const out = await generateSection({
        section: key as SectionKey,
        context: ctx,
        tenantId: 't-test',
        generate: recordedGenerator(recorded),
      });
      // Zod-valid shape.
      expect(() => SectionResultSchema.parse({ narrative: out.narrative, verifyFlags: out.verifyFlags })).not.toThrow();
      expect(out.section).toBe(key);
      expect(out.verifyFlags).toEqual(['partner to confirm comparable dates']);
      expect(out.promptVersionHash).toMatch(/^[0-9a-f]{16}$/);
      expect(out.modelUsed).toBe('claude-sonnet-4-6');
      expect(out.outputTokens).toBe(256);
    }
  });
});
