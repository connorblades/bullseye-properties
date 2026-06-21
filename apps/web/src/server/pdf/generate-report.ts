import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { deals, dealReportVersions } from '@/server/db/schema';
import { assembleDeal } from '@/server/deal/assemble';
import { loadPartnerIdentity } from '@/server/deal/partner';
import { uploadDealPack } from '@/server/storage/admin';
import { buildReportData } from './report-data';
import { renderDealReportToBuffer } from './render';

/**
 * Render a deal report version to PDF and store it (M3-T10 core).
 *
 * Pure of any request context so it can run inline in a Server Action or inside
 * the Trigger.dev generate-report task. Reloads the deal (narratives must
 * already be persisted), renders all 16 sections, uploads to deal-packs, and
 * flips the version row to 'rendered' with its storage path + byte size.
 */
export async function generateAndStoreReport(opts: {
  tenantId: string;
  dealId: string;
  versionId: string;
  version: number;
}): Promise<{ pdfPath: string; byteSize: number }> {
  const rows = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, opts.dealId), eq(deals.tenantId, opts.tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('Deal not found');

  const deal = assembleDeal(row);
  const partner = await loadPartnerIdentity(opts.tenantId);

  const data = buildReportData({
    deal,
    reference: row.reference,
    partner,
    preparedFor: deal.client || undefined,
    generatedOn: new Intl.DateTimeFormat('en-GB').format(new Date()),
    narratives: deal.narratives,
  });

  try {
    const pdf = await renderDealReportToBuffer(data);
    const pdfPath = `${opts.tenantId}/${opts.dealId}/v${opts.version}.pdf`;
    const { size } = await uploadDealPack(pdfPath, pdf);

    await db
      .update(dealReportVersions)
      .set({ pdfStoragePath: pdfPath, pdfByteSize: size, status: 'rendered' })
      .where(eq(dealReportVersions.id, opts.versionId));

    return { pdfPath, byteSize: size };
  } catch (e) {
    await db
      .update(dealReportVersions)
      .set({ status: 'failed', failureReason: e instanceof Error ? e.message.slice(0, 500) : 'render failed' })
      .where(eq(dealReportVersions.id, opts.versionId));
    throw e;
  }
}
