import 'server-only';
import { gzipSync, gunzipSync } from 'node:zlib';
import { ulid } from 'ulid';
import { db } from '@/server/db/client';
import { claudeGenerations } from '@/server/db/schema';

/**
 * claude_generations audit writer (M3-T5 / AC-07).
 *
 * One row is inserted per section at publish time, capturing the AI's raw
 * response (gzipped) and the diff to the partner's edited version. The table is
 * append-only (see migration 0003), so this is the single, immutable record of
 * what AI produced versus what the partner published - the PI-defence evidence.
 */

/** Minimal LCS line diff. Returns '' when nothing changed. */
function diffLines(a: string[], b: string[]): string {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${a[i++]}`);
    } else {
      out.push(`+ ${b[j++]}`);
    }
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out.join('\n');
}

/** Compute the partner-edits diff between the AI raw text and the published text. */
export function computeEditsDiff(raw: string, edited: string): string {
  if (raw === edited) return '';
  return diffLines(raw.split('\n'), edited.split('\n'));
}

/** Decode a gzipped raw_response back to text (for reading audit rows). */
export function decodeRawResponse(buf: Buffer): string {
  return gunzipSync(buf).toString('utf8');
}

export type GenerationAuditInput = {
  tenantId: string;
  dealId: string;
  dealReportVersionId?: string | null;
  sectionKey: string;
  modelId: string;
  promptVersionHash: string;
  rawResponse: string;
  editedText: string;
  inputTokens: number;
  outputTokens: number;
  generatedBy?: string | null;
};

/**
 * Build the exact row inserted into claude_generations. Pure + testable:
 * gzips the raw response and computes the edits diff without touching the DB.
 */
export function buildGenerationRow(input: GenerationAuditInput) {
  const diff = computeEditsDiff(input.rawResponse, input.editedText);
  return {
    id: `cg-${ulid()}`,
    tenantId: input.tenantId,
    dealId: input.dealId,
    dealReportVersionId: input.dealReportVersionId ?? null,
    sectionKey: input.sectionKey,
    modelId: input.modelId,
    promptVersionHash: input.promptVersionHash,
    rawResponse: gzipSync(Buffer.from(input.rawResponse, 'utf8')),
    partnerEditsDiff: diff || null,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    generatedBy: input.generatedBy ?? null,
  };
}

/** Insert one append-only audit row. Returns its id. */
export async function recordGeneration(input: GenerationAuditInput): Promise<string> {
  const row = buildGenerationRow(input);
  await db.insert(claudeGenerations).values(row);
  return row.id;
}
