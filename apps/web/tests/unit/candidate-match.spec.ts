import { describe, expect, it } from 'vitest';
import { candidateToDealInput, type ScrapedCandidate, type LeadMatchSummary } from '@/lib/lead-intake';

/**
 * Approve-attaches-investor (BSE-OPP-P01 M1, AC-04). approveCandidate() passes
 * the stored match summary into candidateToDealInput(); the created deal must
 * carry the matched investor as its client and a matchedInvestor block. Without
 * a match it falls back to any client the candidate itself carried.
 */

function candidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return { address: '12 Browning Street, Mansfield, NG18 5QH', channel: 'portal', ...overrides };
}

const match: LeadMatchSummary = {
  matched: true,
  investorId: 'ic-patel',
  investorName: 'J. Patel',
  pct: 84,
  reasons: ['Within budget', 'Type matches'],
};

describe('candidateToDealInput with a match', () => {
  it('attaches the matched investor as the deal client and a matchedInvestor block', () => {
    const { initialInputs } = candidateToDealInput(candidate(), match);
    expect(initialInputs.client).toBe('J. Patel');
    expect(initialInputs.matchedInvestor).toMatchObject({
      id: 'ic-patel', name: 'J. Patel', pct: 84, reasons: ['Within budget', 'Type matches'],
    });
  });

  it('a matched investor wins over a client the candidate carried', () => {
    const { initialInputs } = candidateToDealInput(candidate({ client: 'Someone Else' }), match);
    expect(initialInputs.client).toBe('J. Patel');
  });

  it('does not attach an investor when the lead is unmatched', () => {
    const unmatched: LeadMatchSummary = { matched: false, pct: 0, reasons: [] };
    const { initialInputs } = candidateToDealInput(candidate({ client: 'Carried Client' }), unmatched);
    expect(initialInputs.matchedInvestor).toBeUndefined();
    expect(initialInputs.client).toBe('Carried Client'); // falls back to the candidate's own
  });

  it('works with no match argument at all (back-compat)', () => {
    const { initialInputs } = candidateToDealInput(candidate({ client: 'Carried Client' }));
    expect(initialInputs.matchedInvestor).toBeUndefined();
    expect(initialInputs.client).toBe('Carried Client');
  });
});
