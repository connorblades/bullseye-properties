import 'server-only';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { registerFonts } from './fonts';
import { DealReport } from './DealReport';
import type { ReportData } from './report-data';

/**
 * Render the Standard Deal Report to a PDF Buffer (M3-T6).
 *
 * Registers fonts (once) before rendering. Called by the Trigger.dev
 * generate-report task (M3-T10), which uploads the buffer to the deal-packs
 * bucket and writes the deal_report_versions row.
 */
export async function renderDealReportToBuffer(data: ReportData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<DealReport data={data} />);
}
