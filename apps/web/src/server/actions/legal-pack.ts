'use server';

/**
 * Legal Pack Analyser Server Action (M11 / AC-18).
 *
 * The Stage 7 panel uploads a PDF/DOCX as base64 and calls this action. All
 * extraction and Claude work happens here, server-side: the Anthropic key never
 * reaches the client bundle. Returns the validated four-section analysis (with
 * the derived buyer-fees total) or a manual-entry warning.
 */

import { requireTenant } from '@/server/auth/tenant';
import { loadDeal } from '@/server/actions/deals';
import { analyseLegalPack } from '@/server/legal-pack/analyse';
import { parseMoneyLoose, type LegalPackAnalysis } from '@/lib/legal-pack';

/** Cap the uploaded document at ~15MB decoded, so a huge scan can't wedge the action. */
const MAX_BYTES = 15 * 1024 * 1024;

export type AnalyseLegalPackInput = {
  dealId: string;
  filename: string;
  mime: string;
  /** base64 (no data: prefix) of the PDF/DOCX bytes. */
  dataBase64: string;
  /** Optional explicit price override; otherwise resolved from the deal. */
  purchasePrice?: number;
};

export type AnalyseLegalPackResult =
  | { ok: true; analysis: LegalPackAnalysis }
  | { ok: false; manualEntry?: boolean; error: string };

/** Resolve the purchase price to use for percentage fees + the buyer-fees total. */
function resolvePrice(deal: { inputs: unknown }, override?: number): number {
  if (override && override > 0) return override;
  const inputs = (deal.inputs as Record<string, unknown>) ?? {};
  const financials = (inputs.financials as { purchasePrice?: string } | undefined) ?? undefined;
  const property = (inputs.property as { askingPrice?: string } | undefined) ?? undefined;
  return parseMoneyLoose(financials?.purchasePrice) ?? parseMoneyLoose(property?.askingPrice) ?? 0;
}

export async function analyseLegalPackAction(input: AnalyseLegalPackInput): Promise<AnalyseLegalPackResult> {
  try {
    const { tenantId, userId } = await requireTenant();
    const row = await loadDeal(input.dealId);
    if (!row) return { ok: false, error: 'Deal not found.' };

    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length === 0) return { ok: false, error: 'The uploaded file was empty.' };
    if (bytes.length > MAX_BYTES) {
      return { ok: false, error: 'File too large (max 15MB). Upload the Special Conditions and addendum only.' };
    }

    const price = resolvePrice(row, input.purchasePrice);

    const outcome = await analyseLegalPack({
      tenantId,
      dealId: input.dealId,
      userId,
      doc: { filename: input.filename, mime: input.mime, bytes },
      purchasePrice: price,
    });

    if (!outcome.ok) {
      return { ok: false, manualEntry: true, error: outcome.message };
    }
    return { ok: true, analysis: outcome.analysis };
  } catch (e) {
    // Never surface as a thrown Server Action error (Next masks those in prod).
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : 'Analysis failed.' };
  }
}
