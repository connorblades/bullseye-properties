'use server';

/**
 * Claude report Server Actions (M3).
 *
 * - publishReport: on partner publish, writes one append-only claude_generations
 *   audit row per section (raw response + edits diff), creates a draft
 *   deal_report_versions row, persists the edited narratives onto the deal, then
 *   renders + stores the 16-section PDF.
 * - getLatestDealPackUrl: signed download URL for the latest rendered pack.
 *
 * The live section streaming is a Route Handler (app/api/deal/[id]/report-stream)
 * rather than a Server Action, so we don't pull `ai/rsc` (and its incompatible
 * zod-to-json-schema transitive dep) into the build.
 */

import { and, desc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '@/server/db/client';
import { dealReportVersions } from '@/server/db/schema';
import { requireTenant } from '@/server/auth/tenant';
import { loadDeal, updateDealById } from '@/server/actions/deals';
import { recordGeneration } from '@/server/claude/audit';
import { generateAndStoreReport } from '@/server/pdf/generate-report';
import { signDealPackUrl } from '@/server/storage/admin';
import type { PublishSection } from '@/lib/report-types';

async function nextReportVersion(tenantId: string, dealId: string): Promise<number> {
  const rows = await db
    .select({ v: dealReportVersions.version })
    .from(dealReportVersions)
    .where(and(eq(dealReportVersions.tenantId, tenantId), eq(dealReportVersions.dealId, dealId)))
    .orderBy(desc(dealReportVersions.version))
    .limit(1);
  return (rows[0]?.v ?? 0) + 1;
}

export type PublishResult =
  | { ok: true; versionId: string; version: number; pdfPath: string | null; renderError: string | null }
  | { ok: false; error: string };

export async function publishReport(dealId: string, sections: PublishSection[]): Promise<PublishResult> {
  // The whole pre-render write path is wrapped so a failure returns the real
  // message to the UI instead of throwing (Next masks thrown Server Action
  // errors in production as a generic "Server Components render" message).
  try {
    const { tenantId, userId } = await requireTenant();
    const row = await loadDeal(dealId);
    if (!row) return { ok: false, error: 'Deal not found' };

    const version = await nextReportVersion(tenantId, dealId);
    const versionId = `drv-${ulid()}`;

    // Draft version row; the render step below fills pdf_storage_path + flips
    // status to 'rendered' (or 'failed').
    await db.insert(dealReportVersions).values({
      id: versionId,
      tenantId,
      dealId,
      version,
      inputsSnapshot: (row.inputs as Record<string, unknown>) ?? {},
      status: 'draft',
      renderedBy: userId,
    });

    // One append-only audit row per section (raw AI response + partner edits diff).
    for (const s of sections) {
      await recordGeneration({
        tenantId,
        dealId,
        dealReportVersionId: versionId,
        sectionKey: s.section,
        modelId: s.model || 'manual',
        promptVersionHash: s.promptVersionHash,
        rawResponse: s.raw,
        editedText: s.edited,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        generatedBy: userId,
      });
    }

    // Persist the published narratives onto the deal BEFORE rendering (the render
    // reloads the deal and reads deal.narratives).
    const narratives = Object.fromEntries(sections.map((s) => [s.section, s.edited]));
    await updateDealById(dealId, { narratives });

    // Render the 16-section PDF and store it. Audit rows are already committed, so
    // a render failure does not lose the published draft - the version row is
    // marked 'failed' and the partner can retry from delivery.
    let pdfPath: string | null = null;
    let renderError: string | null = null;
    try {
      const stored = await generateAndStoreReport({ tenantId, dealId, versionId, version });
      pdfPath = stored.pdfPath;
    } catch (e) {
      renderError = e instanceof Error ? `${e.name}: ${e.message}` : 'PDF render failed';
    }

    return { ok: true, versionId, version, pdfPath, renderError };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : 'Publish failed' };
  }
}

/**
 * Signed download URL for the latest rendered deal pack (Stage 15 / M3-T10).
 * Returns null if no PDF has been rendered yet.
 */
export async function getLatestDealPackUrl(
  dealId: string
): Promise<{ url: string; version: number; filename: string } | null> {
  const { tenantId } = await requireTenant();
  const rows = await db
    .select()
    .from(dealReportVersions)
    .where(
      and(
        eq(dealReportVersions.tenantId, tenantId),
        eq(dealReportVersions.dealId, dealId),
        eq(dealReportVersions.status, 'rendered')
      )
    )
    .orderBy(desc(dealReportVersions.version))
    .limit(1);
  const v = rows[0];
  if (!v?.pdfStoragePath) return null;
  const url = await signDealPackUrl(v.pdfStoragePath, 3600);
  return { url, version: v.version, filename: `Deal_Pack_v${v.version}.pdf` };
}
