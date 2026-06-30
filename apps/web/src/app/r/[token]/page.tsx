import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { Download, FileText } from 'lucide-react';
import { resolveReportAccess } from '@/server/share/access';
import { recordShareAccess, hashIp } from '@/server/share/tokens';
import { buildOutline, fmtOutlineGBP } from '@/lib/outline';
import { Logo } from '@/components/logo';
import { ShareNotice } from '@/components/share-notice';

/**
 * Public, token-gated investor view of the full Standard Deal Report (Report 2,
 * M4-T3). A clean delivery surface - not the wizard - that presents the headline
 * numbers and the partner, then serves the rendered 16-section PDF through a
 * token-gated route so the storage URL is never exposed.
 */
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Standard Deal Report · Bullseye Properties',
  robots: { index: false, follow: false },
};

export default async function ReportSharePage({ params }: { params: { token: string } }) {
  const access = await resolveReportAccess(params.token);
  if (access.status === 'not_found') notFound();
  if (access.status === 'revoked' || access.status === 'expired') {
    return (
      <ShareNotice
        title="This link is no longer active"
        body={`${
          access.status === 'expired' ? 'This report link has expired.' : 'This report link has been revoked.'
        } Please contact your Bullseye partner for an up-to-date link.`}
      />
    );
  }

  // Log the open (best-effort; never blocks delivery).
  try {
    const h = headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    await recordShareAccess(access.token, 'open', { ipHash: hashIp(ip), userAgent: h.get('user-agent') });
  } catch {
    // logging failure must not break delivery
  }

  if (access.status === 'not_ready') {
    return (
      <ShareNotice
        title="Your report is being prepared"
        body="This report has not finished rendering yet. Please check back shortly or contact your Bullseye partner."
      />
    );
  }

  const { deal, partner } = access;
  const o = buildOutline(deal);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const pdfHref = `/r/${params.token}/pdf`;

  const tiles: { label: string; value: string }[] = [
    { label: 'Guide price', value: o.price != null ? fmtOutlineGBP(o.price) : 'TBC' },
    { label: 'Est. rent (pcm)', value: o.monthlyRent != null ? fmtOutlineGBP(o.monthlyRent) : 'TBC' },
    { label: 'Gross yield', value: o.grossYield > 0 ? pct(o.grossYield) : 'TBC' },
    { label: 'Net yield', value: o.netYield > 0 ? pct(o.netYield) : 'TBC' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <Logo size="md" />
          <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="btn-primary text-xs inline-flex items-center gap-1.5">
            <Download size={14} /> Download PDF
          </a>
        </div>

        <div className="text-xs font-bold text-navy uppercase tracking-widest mb-2">Standard Deal Report</div>
        <h1 className="text-3xl font-black text-ink leading-tight mb-2">{deal.address}</h1>
        <p className="text-sm text-ink-mid mb-8">
          Prepared for {deal.client || 'you'} by {partner.displayName}, your Accredited Bullseye Partner.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {tiles.map((t) => (
            <div key={t.label} className="bg-bg rounded-xl p-4">
              <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">{t.label}</div>
              <div className="text-xl font-black text-ink mt-1">{t.value}</div>
            </div>
          ))}
        </div>

        {/* Inline PDF view */}
        <div className="rounded-2xl border border-black/[0.1] overflow-hidden mb-6 bg-bg" style={{ height: '80vh' }}>
          <object data={pdfHref} type="application/pdf" className="w-full h-full">
            <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
              <FileText size={28} className="text-navy" />
              <p className="text-sm text-ink-mid">
                Your browser cannot display the PDF inline.
              </p>
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="btn-primary text-xs inline-flex items-center gap-1.5">
                <Download size={14} /> Download the full report
              </a>
            </div>
          </object>
        </div>

        <div className="border-t border-black/[0.08] pt-5 text-xs text-ink-muted leading-relaxed">
          This report is confidential and prepared for the named recipient. It is not advice or a personal
          recommendation. Figures rely on the assumptions stated within. Questions? Reply to the email this was sent in,
          or speak to your partner directly.
        </div>
      </div>
    </div>
  );
}
