import { describe, expect, it, vi } from 'vitest';

// Mock the DB-backed cost module so the guarded generate path runs without
// Postgres. This also lets us assert exactly ONE ai_cost_ledger increment
// (recordCost) per analysis.
vi.mock('@/server/claude/cost', () => ({
  assertUnderDailyBudget: vi.fn(async () => {}),
  recordCost: vi.fn(async () => {}),
  spentTodayUsd: vi.fn(async () => 0),
  BudgetExceededError: class extends Error {},
}));

import { recordCost } from '@/server/claude/cost';
import {
  feeAmount,
  feeBasisLabel,
  totalBuyerFees,
  calcSdlt,
  fundsRequired,
  parseMoneyLoose,
  type Fee,
} from '@/lib/legal-pack';
import { parseLegalPackResponse, toSections, LegalPackWireSchema } from '@/server/legal-pack/schema';
import { classifyExtraction, extractLegalPack, MIN_EXTRACTABLE_CHARS } from '@/server/legal-pack/extract';
import { analyseLegalPack } from '@/server/legal-pack/analyse';
import { generateGuarded } from '@/server/claude/generate';
import type { StreamMessageParams, StreamMessageResult } from '@/server/claude/client';

const noSleep = async () => {};

function fee(partial: Partial<Fee>): Fee {
  return { name: 'Fee', fixed: 0, pct: 0, vatApplies: 'No', whenPayable: '', ...partial };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure SDLT / VAT / funds math (backs the fees section + buyer-fees auto-fill)
// ─────────────────────────────────────────────────────────────────────────────
describe('feeAmount + VAT', () => {
  it('prices a flat fee, adding VAT only when vatApplies=Yes', () => {
    expect(feeAmount(fee({ fixed: 500 }), 100_000)).toBe(500);
    expect(feeAmount(fee({ fixed: 500, vatApplies: 'Yes' }), 100_000)).toBe(600);
  });

  it('prices a percentage fee against the purchase price', () => {
    expect(feeAmount(fee({ pct: 1 }), 100_000)).toBe(1000);
  });

  it('combines a flat + percentage fee, then applies VAT to the whole', () => {
    // (500 + 1% of 100k) * 1.2 = 1800
    expect(feeAmount(fee({ fixed: 500, pct: 1, vatApplies: 'Yes' }), 100_000)).toBe(1800);
  });

  it('returns null for a variable fee (no fixed, no pct)', () => {
    expect(feeAmount(fee({}), 100_000)).toBeNull();
  });

  it('labels the basis in plain English', () => {
    expect(feeBasisLabel(fee({ fixed: 500, pct: 1, vatApplies: 'Yes' }))).toBe('£500 + 1% of price + VAT');
    expect(feeBasisLabel(fee({ vatApplies: 'TBC' }))).toBe('See note (VAT TBC)');
  });
});

describe('totalBuyerFees', () => {
  it('sums quantified fees and flags variable ones', () => {
    const fees = [fee({ fixed: 600 }), fee({ pct: 2, vatApplies: 'Yes' }), fee({})];
    const { total, hasVariable } = totalBuyerFees(fees, 100_000);
    // 600 + (2% of 100k = 2000)*1.2 = 600 + 2400 = 3000
    expect(total).toBe(3000);
    expect(hasVariable).toBe(true);
  });

  it('has no variable flag when every fee is priced', () => {
    expect(totalBuyerFees([fee({ fixed: 600 })], 100_000)).toEqual({ total: 600, hasVariable: false });
  });
});

describe('calcSdlt (UK bands from 1 April 2025)', () => {
  it('standard residence at £200k', () => {
    // 0 on first 125k, 2% on next 75k = 1500
    expect(calcSdlt(200_000, 'standard')).toBe(1500);
  });

  it('additional property / BTL adds 5% on every band', () => {
    // 5% on 125k (6250) + 7% on 75k (5250) = 11500
    expect(calcSdlt(200_000, 'additional')).toBe(11_500);
  });

  it('overseas adds a further 2% on the whole price', () => {
    // 11500 + 2% of 200k (4000) = 15500
    expect(calcSdlt(200_000, 'overseas')).toBe(15_500);
  });

  it('is zero for a non-positive price', () => {
    expect(calcSdlt(0, 'additional')).toBe(0);
  });
});

describe('fundsRequired', () => {
  it('builds the full breakdown with defaults', () => {
    const f = fundsRequired({ price: 100_000, fees: [] });
    expect(f.deposit).toBe(10_000);
    expect(f.balance).toBe(90_000);
    expect(f.additionalCosts).toBe(0);
    expect(f.sdlt).toBe(5000); // additional/BTL default: 5% of 100k
    expect(f.sourcingFee).toBe(3000);
    expect(f.legalFees).toBe(1500);
    expect(f.total).toBe(109_500);
  });

  it('folds the pack fees and the chosen SDLT mode into the total', () => {
    const f = fundsRequired({ price: 100_000, fees: [fee({ fixed: 1000 })], sdltMode: 'standard' });
    // sdlt standard on 100k = 0; total = 10000 + 90000 + 1000 + 0 + 3000 + 1500
    expect(f.additionalCosts).toBe(1000);
    expect(f.sdlt).toBe(0);
    expect(f.total).toBe(105_500);
  });
});

describe('parseMoneyLoose', () => {
  it('reads a formatted price', () => {
    expect(parseMoneyLoose('£112,500')).toBe(112_500);
    expect(parseMoneyLoose('95000')).toBe(95_000);
  });
  it('returns null for junk / empty', () => {
    expect(parseMoneyLoose('')).toBeNull();
    expect(parseMoneyLoose(null)).toBeNull();
    expect(parseMoneyLoose('n/a')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema validation of Claude's four-section JSON
// ─────────────────────────────────────────────────────────────────────────────
describe('parseLegalPackResponse (Zod)', () => {
  const good = JSON.stringify({
    property: '14 High Street',
    section1: { fees: [{ name: 'Admin fee', fixed: 600, pct: 0, vatApplies: 'No', whenPayable: 'On exchange', note: 'min £500' }] },
    section2: { clauses: [{ question: 'Who pays searches?', answer: 'The buyer reimburses them.', severity: 'Medium' }] },
    section3: { otherNotes: ['Ground rent arrears TBC', '  '] },
    section4: { clientSummary: 'Two fees apply.' },
  });

  it('parses valid JSON into the friendly four-section shape', () => {
    const s = parseLegalPackResponse(good);
    expect(s.property).toBe('14 High Street');
    expect(s.fees).toHaveLength(1);
    expect(s.fees[0]).toMatchObject({ name: 'Admin fee', fixed: 600, note: 'min £500' });
    expect(s.clauses[0].severity).toBe('Medium');
    expect(s.notes).toEqual(['Ground rent arrears TBC']); // blank note filtered out
    expect(s.clientSummary).toBe('Two fees apply.');
  });

  it('strips a ```json fence before parsing', () => {
    const s = parseLegalPackResponse('```json\n' + good + '\n```');
    expect(s.fees).toHaveLength(1);
  });

  it('defaults empty sections when keys are missing', () => {
    const s = parseLegalPackResponse('{}');
    expect(s.fees).toEqual([]);
    expect(s.clauses).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.clientSummary).toBe('');
  });

  it('coerces a bad severity/VAT to a safe default rather than throwing', () => {
    const wire = LegalPackWireSchema.parse({
      section1: { fees: [{ name: 'x', vatApplies: 'maybe' }] },
      section2: { clauses: [{ question: 'q', answer: 'a', severity: 'Critical' }] },
    });
    const s = toSections(wire);
    expect(s.fees[0].vatApplies).toBe('TBC');
    expect(s.clauses[0].severity).toBe('Low');
  });

  it('throws on non-JSON text', () => {
    expect(() => parseLegalPackResponse('Sorry, I cannot help with that.')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Extraction degrade-to-warning path (AC-18: image-only packs -> manual entry)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyExtraction', () => {
  it('accepts a pack with enough extractable text', () => {
    const r = classifyExtraction({ text: 'x'.repeat(MIN_EXTRACTABLE_CHARS + 1), pages: 4 });
    expect(r.ok).toBe(true);
  });

  it('degrades a near-empty (scanned) pack to an image-only warning', () => {
    const r = classifyExtraction({ text: 'Lot 14', pages: 30 });
    expect(r).toMatchObject({ ok: false, reason: 'image-only' });
  });

  it('degrades a fully empty extraction to an empty warning', () => {
    const r = classifyExtraction({ text: '   ', pages: 10 });
    expect(r).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('extractLegalPack (dispatch, injected parsers)', () => {
  const pdf = { filename: 'pack.pdf', mime: 'application/pdf', bytes: Buffer.from('x') };
  const docx = { filename: 'pack.docx', mime: '', bytes: Buffer.from('x') };

  it('uses the PDF parser for a PDF and returns text', async () => {
    const r = await extractLegalPack(pdf, { parsePdf: async () => ({ text: 'S'.repeat(500), pages: 12 }) });
    expect(r).toMatchObject({ ok: true, pages: 12 });
  });

  it('degrades an image-only PDF to a warning without throwing', async () => {
    const r = await extractLegalPack(pdf, { parsePdf: async () => ({ text: 'scan', pages: 40 }) });
    expect(r).toMatchObject({ ok: false, reason: 'image-only' });
  });

  it('uses the DOCX parser for a .docx by extension', async () => {
    const r = await extractLegalPack(docx, { parseDocx: async () => ({ text: 'D'.repeat(400), pages: 1 }) });
    expect(r.ok).toBe(true);
  });

  it('rejects an unsupported type', async () => {
    const r = await extractLegalPack({ filename: 'photo.jpg', mime: 'image/jpeg', bytes: Buffer.from('x') });
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('never throws when the parser errors - it degrades to a warning', async () => {
    const r = await extractLegalPack(pdf, {
      parsePdf: async () => {
        throw new Error('corrupt');
      },
    });
    expect(r).toMatchObject({ ok: false, reason: 'error' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator: one generation, one audit row, one cost increment (AC-18)
// ─────────────────────────────────────────────────────────────────────────────
const CLAUDE_JSON = JSON.stringify({
  property: '14 High Street',
  section1: {
    fees: [
      { name: "Buyer's premium", fixed: 0, pct: 2, vatApplies: 'Yes', whenPayable: 'On completion' },
      { name: 'Admin fee', fixed: 600, pct: 0, vatApplies: 'No', whenPayable: 'On exchange' },
    ],
  },
  section2: { clauses: [{ question: 'Who pays the seller costs?', answer: 'The buyer.', severity: 'High' }] },
  section3: { otherNotes: ['Ground rent arrears TBC'] },
  section4: { clientSummary: 'Two buyer fees apply beyond the price.' },
});

function cannedStreamer(text: string) {
  return async (params: StreamMessageParams): Promise<StreamMessageResult> => {
    params.onTextDelta?.(text);
    return { text, modelUsed: params.model, inputTokens: 800, outputTokens: 120, stopReason: 'end_turn' };
  };
}

describe('analyseLegalPack orchestrator', () => {
  it('runs one generation + one audit row + one cost increment and auto-fills buyer fees', async () => {
    vi.mocked(recordCost).mockClear();
    const auditSpy = vi.fn(async () => 'cg-1');
    let genCalls = 0;

    const outcome = await analyseLegalPack(
      { tenantId: 't-1', dealId: 'd-1', userId: 'u-1', doc: { filename: 'pack.pdf', mime: 'application/pdf', bytes: Buffer.from('x') }, purchasePrice: 100_000 },
      {
        parsePdf: async () => ({ text: 'Special Conditions of Sale. '.repeat(30), pages: 8 }),
        generate: (opts) => {
          genCalls += 1;
          return generateGuarded({ ...opts, streamer: cannedStreamer(CLAUDE_JSON), sleep: noSleep });
        },
        recordAudit: auditSpy,
        now: () => '2026-07-07T00:00:00.000Z',
      }
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Exactly one generation, one audit row, one cost increment.
    expect(genCalls).toBe(1);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordCost)).toHaveBeenCalledTimes(1);

    // The audit row is the single legal-pack row (not per section).
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', dealId: 'd-1', sectionKey: 'legal-pack', dealReportVersionId: null })
    );

    // Buyer-fees auto-fill: 2% of 100k (2000) * 1.2 VAT = 2400, + 600 admin = 3000.
    expect(outcome.analysis.buyerFees).toBe(3000);
    expect(outcome.analysis.fees).toHaveLength(2);
    expect(outcome.analysis.sourceFilename).toBe('pack.pdf');
    expect(outcome.analysis.analysedAt).toBe('2026-07-07T00:00:00.000Z');
  });

  it('degrades an image-only pack to manual entry with NO generation and NO audit row', async () => {
    vi.mocked(recordCost).mockClear();
    const auditSpy = vi.fn(async () => 'cg-x');
    const generate = vi.fn(async () => {
      throw new Error('should not be called');
    });

    const outcome = await analyseLegalPack(
      { tenantId: 't-1', dealId: 'd-1', doc: { filename: 'scan.pdf', mime: 'application/pdf', bytes: Buffer.from('x') }, purchasePrice: 100_000 },
      { parsePdf: async () => ({ text: 'Lot 14', pages: 60 }), generate, recordAudit: auditSpy }
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.manualEntry).toBe(true);
    expect(outcome.reason).toBe('image-only');
    expect(generate).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(vi.mocked(recordCost)).not.toHaveBeenCalled();
  });
});
