import { describe, expect, it } from 'vitest';
import {
  candidateToDealInput,
  type ScrapedCandidate,
  type LeadMatchSummary,
} from '@/lib/lead-intake';
import { emptyDeal } from '@/lib/deal-store';
import { buildReportData } from '@/server/pdf/report-data';

/**
 * Approve-to-report handoff, end to end (BSE-OPP-P01 M4, AC-07).
 *
 * Stitches the whole matched-lead -> pipeline-deal -> Standard-Deal-Report chain
 * that is otherwise split across candidate-match.spec (the approve seam) and
 * pdf-render.spec (the report seam). It proves the ONE property AC-07 turns on:
 * approving a matched lead produces a report PREPARED FOR the matched investor.
 *
 * Mirrors the runtime path exactly:
 *   approveCandidate -> candidateToDealInput(candidate, match)   [lead-review.ts]
 *   createDeal(...) lands the deal at pipelineStage 'leads'      [deals.ts]
 *   generate-report: buildReportData({ preparedFor: deal.client })  [generate-report.ts:40]
 */

const PARTNER = {
  displayName: 'Connor Blades',
  accreditationNo: 'BSE-CB-001',
  accreditedAt: '2025-01-10',
  amlRegistration: 'AML123',
  icoRegistration: 'ICO456',
  piPolicy: 'PI789',
  contactEmail: 'connor@bullseyeproperties.co.uk',
  contactPhone: '07000 000000',
  shortBio: 'Accredited sourcing partner for the East Midlands.',
};

function candidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return { address: '12 Browning Street, Mansfield, NG18 5QH', channel: 'portal', ...overrides };
}

describe('approve-to-report handoff (AC-07)', () => {
  it('a matched lead becomes a deal at stage leads, prepared for the matched investor', () => {
    const match: LeadMatchSummary = {
      matched: true,
      investorId: 'ic-patel',
      investorName: 'J. Patel',
      pct: 84,
      reasons: ['Within budget', 'Type matches'],
    };

    // 1. Approve maps the candidate + its stored match into a deal input.
    const { address, initialInputs } = candidateToDealInput(candidate(), match);
    expect(initialInputs.pipelineStage).toBe('leads');
    expect(initialInputs.client).toBe('J. Patel');
    expect(initialInputs.matchedInvestor).toMatchObject({ id: 'ic-patel', name: 'J. Patel', pct: 84 });

    // 2. createDeal seeds a Deal from that input (emptyDeal is the same factory).
    const deal = emptyDeal('d-approved', { ...initialInputs, address });
    expect(deal.client).toBe('J. Patel');

    // 3. The report is built for that deal, prepared for its client - exactly as
    //    generate-report.ts does (preparedFor: deal.client || undefined).
    const data = buildReportData({
      deal,
      reference: 'BSE-CB-001-001',
      partner: PARTNER,
      preparedFor: deal.client || undefined,
    });
    expect(data.preparedFor).toBe('J. Patel');
    expect(data.deal.address).toContain('12 Browning Street');
  });

  it('an unmatched lead still produces a report, prepared for the candidate-carried client', () => {
    const unmatched: LeadMatchSummary = { matched: false, pct: 0, reasons: [] };
    const { address, initialInputs } = candidateToDealInput(
      candidate({ client: 'Carried Client' }),
      unmatched
    );
    const deal = emptyDeal('d-unmatched', { ...initialInputs, address });
    const data = buildReportData({
      deal,
      reference: 'BSE-CB-001-002',
      partner: PARTNER,
      preparedFor: deal.client || undefined,
    });
    expect(data.preparedFor).toBe('Carried Client');
  });
});
