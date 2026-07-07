import 'server-only';
import { generateGuarded, type GuardedGenerateOptions } from '@/server/claude/generate';
import { recordGeneration } from '@/server/claude/audit';
import type { StreamMessageResult } from '@/server/claude/client';
import { totalBuyerFees, type LegalPackAnalysis } from '@/lib/legal-pack';
import { LEGAL_PACK_SYSTEM_PROMPT, LEGAL_PACK_PROMPT_HASH, LEGAL_PACK_SECTION_KEY } from './system-prompt';
import { parseLegalPackResponse } from './schema';
import { extractLegalPack, type UploadedDoc, type ExtractDeps, type ManualEntryReason } from './extract';

/**
 * Legal Pack Analyser orchestrator (M11 / AC-18).
 *
 * One analysis =
 *   extract text (server-side) ->
 *   generateGuarded ONCE through the hardened M3 Claude path (kill switch,
 *   token ceilings, daily per-tenant budget, retry + Haiku fallback, and exactly
 *   one ai_cost_ledger increment recorded inside generateGuarded) ->
 *   validate the four-section JSON with Zod ->
 *   write EXACTLY ONE append-only claude_generations audit row ->
 *   compute the buyer-fees total that auto-fills `auction.buyerFees`.
 *
 * A scanned / image-only pack never reaches Claude: extraction returns a typed
 * manual-entry signal and this returns `{ ok: false, manualEntry: true }` with
 * no audit row and no cost increment.
 */

/** Cap the document text so a huge pack stays inside the input token ceiling. */
export const MAX_DOC_CHARS = 24_000;
const MAX_OUTPUT_TOKENS = 1500;

export type AnalyseInput = {
  tenantId: string;
  dealId: string;
  userId?: string | null;
  doc: UploadedDoc;
  /** Purchase price used for percentage fees + the buyer-fees auto-fill. */
  purchasePrice?: number;
};

export type AnalyseOutcome =
  | { ok: true; analysis: LegalPackAnalysis }
  | { ok: false; manualEntry: true; reason: ManualEntryReason | 'disabled' | 'failed'; message: string };

export type AnalyseDeps = ExtractDeps & {
  generate?: (opts: GuardedGenerateOptions) => Promise<StreamMessageResult>;
  recordAudit?: typeof recordGeneration;
  now?: () => string;
};

function buildUserPrompt(text: string, filename: string, price?: number): string {
  const header = [
    price && price > 0 ? `Purchase Price: £${Math.round(price).toLocaleString('en-GB')}` : '',
    `Document: ${filename}`,
  ]
    .filter(Boolean)
    .join('\n');
  const body = text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + '\n\n[Document truncated]' : text;
  return `${header}\n\n${body}`;
}

export async function analyseLegalPack(input: AnalyseInput, deps: AnalyseDeps = {}): Promise<AnalyseOutcome> {
  const generate = deps.generate ?? generateGuarded;
  const recordAudit = deps.recordAudit ?? recordGeneration;
  const now = deps.now ?? (() => new Date().toISOString());

  // 1. Extract text server-side. Image-only / unreadable -> manual entry, no Claude call.
  const extracted = await extractLegalPack(input.doc, deps);
  if (!extracted.ok) {
    return { ok: false, manualEntry: true, reason: extracted.reason, message: extracted.message };
  }

  const price = input.purchasePrice && input.purchasePrice > 0 ? input.purchasePrice : 0;

  // 2. Single guarded generation (one cost increment recorded inside generateGuarded).
  let result: StreamMessageResult;
  try {
    result = await generate({
      tenantId: input.tenantId,
      system: LEGAL_PACK_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(extracted.text, input.doc.filename, price),
      maxTokens: MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    return {
      ok: false,
      manualEntry: true,
      reason: 'failed',
      message:
        err instanceof Error
          ? `Analysis could not be completed (${err.message}). Enter the buyer fees and conditions manually below.`
          : 'Analysis could not be completed. Enter the buyer fees and conditions manually below.',
    };
  }

  // 3. Validate the four-section JSON.
  const sections = parseLegalPackResponse(result.text);

  // 4. Exactly one append-only audit row for this analysis (not per section).
  await recordAudit({
    tenantId: input.tenantId,
    dealId: input.dealId,
    dealReportVersionId: null,
    sectionKey: LEGAL_PACK_SECTION_KEY,
    modelId: result.modelUsed,
    promptVersionHash: LEGAL_PACK_PROMPT_HASH,
    rawResponse: result.text,
    editedText: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    generatedBy: input.userId ?? null,
  });

  // 5. Derive the buyer-fees total that auto-fills auction.buyerFees.
  const { total } = totalBuyerFees(sections.fees, price);

  return {
    ok: true,
    analysis: {
      ...sections,
      buyerFees: total,
      purchasePriceUsed: price,
      sourceFilename: input.doc.filename,
      modelId: result.modelUsed,
      analysedAt: now(),
    },
  };
}
