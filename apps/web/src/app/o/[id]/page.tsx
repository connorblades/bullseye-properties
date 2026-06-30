import { notFound } from 'next/navigation';
import { loadDealPublic } from '@/server/deal/public';
import { buildOutline, fmtOutlineGBP } from '@/lib/outline';
import { Logo } from '@/components/logo';

/**
 * Public, read-only Outline Deal page (M5) - the shareable pre-viewing teaser a
 * partner sends a prospect to gauge interest. Calm, reader-oriented; no app
 * chrome, no auth.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Outline Deal · Bullseye Properties' };

export default async function OutlineSharePage({ params }: { params: { id: string } }) {
  const res = await loadDealPublic(params.id);
  if (!res) notFound();
  const { deal, partner } = res;
  const o = buildOutline(deal);
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const tiles: { label: string; value: string }[] = [
    { label: 'Guide price', value: o.price != null ? fmtOutlineGBP(o.price) : 'TBC' },
    { label: 'Est. rent (pcm)', value: o.monthlyRent != null ? fmtOutlineGBP(o.monthlyRent) : 'TBC' },
    { label: 'Gross yield', value: o.grossYield > 0 ? pct(o.grossYield) : 'TBC' },
    { label: 'Net yield', value: o.netYield > 0 ? pct(o.netYield) : 'TBC' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <Logo size="md" />
          <a href={`/o/${params.id}/pdf`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
            Download PDF
          </a>
        </div>

        <div className="text-xs font-bold text-navy uppercase tracking-widest mb-2">Outline Deal</div>
        <h1 className="text-3xl font-black text-ink leading-tight mb-2">{deal.address}</h1>
        <p className="text-sm text-ink-mid mb-8">
          Prepared for {deal.client || 'you'} by {partner.displayName}, your Accredited Bullseye Partner.
        </p>

        {/* Pre-viewing visuals */}
        {o.images.length > 0 && (
          <div className={`grid gap-3 mb-8 ${o.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {o.images.map((img, i) => (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt={img.caption || 'Area visual'} className="w-full h-44 object-cover rounded-xl" />
                {img.caption && <figcaption className="text-[11px] text-ink-muted mt-1">{img.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}

        {/* Recommendation */}
        <div className="rounded-2xl border border-navy/30 p-5 mb-8">
          <div className="text-[11px] font-bold text-navy uppercase tracking-wide mb-1">Our recommendation</div>
          <p className="text-lg text-ink leading-relaxed">{o.recommendation}</p>
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {tiles.map((t) => (
            <div key={t.label} className="bg-bg rounded-xl p-4">
              <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">{t.label}</div>
              <div className="text-xl font-black text-ink mt-1">{t.value}</div>
            </div>
          ))}
        </div>

        {/* Indicative offer (pre-condition) */}
        {o.indicative.suggestedOffer != null && (
          <div className="rounded-2xl bg-navy text-white p-5 mb-8">
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/70 mb-1">Indicative opening offer</div>
            <div className="text-3xl font-black">{fmtOutlineGBP(o.indicative.suggestedOffer)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs text-white/85">
              {o.indicative.marketValue != null && (
                <div>Estimated value: <span className="font-semibold">{fmtOutlineGBP(o.indicative.marketValue)}</span> ({o.indicative.marketValueBasis.toLowerCase()})</div>
              )}
              {o.indicative.yieldMaxPrice != null && o.indicative.targetYieldPct != null && (
                <div>Max for {o.indicative.targetYieldPct}% target yield: <span className="font-semibold">{fmtOutlineGBP(o.indicative.yieldMaxPrice)}</span></div>
              )}
            </div>
            <p className="text-[11px] text-white/70 mt-3 leading-relaxed">
              A desktop estimate from comparables and your yield target. It is the starting point only and is subject to
              the viewing and refurbishment assessment, which may move it down.
            </p>
          </div>
        )}

        {/* Why it fits */}
        {o.fitApplicable > 0 && (
          <div className="mb-8">
            <h2 className="text-base font-black text-ink mb-3">Why this fits your criteria ({o.fitMet} of {o.fitApplicable})</h2>
            <ul className="space-y-1.5">
              {o.matched.map((m, i) => (
                <li key={i} className="text-sm text-ink-mid flex items-start gap-2">
                  <span className="text-success font-bold">✓</span> {m}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Highlights */}
        {o.highlights.length > 0 && (
          <div className="mb-8">
            <h2 className="text-base font-black text-ink mb-3">Location highlights</h2>
            <ul className="space-y-1.5">
              {o.highlights.map((h, i) => (
                <li key={i} className="text-sm text-ink-mid flex items-start gap-2">
                  <span className="text-navy">•</span> {h}
                </li>
              ))}
            </ul>
          </div>
        )}

        {o.projected5yr != null && o.projected5yr > 0 && (
          <p className="text-sm text-ink-muted mb-8">
            Illustrative projected value in 5 years: <span className="font-semibold text-ink">{fmtOutlineGBP(o.projected5yr)}</span> (on the assumptions in the full report).
          </p>
        )}

        <div className="border-t border-black/[0.08] pt-5 text-xs text-ink-muted leading-relaxed">
          This is an outline summary to gauge interest. It is not advice or a valuation. Full comparable evidence, condition
          assessment and financial detail follow in the complete report after a viewing. Questions? Reply to the email this
          was sent in, or speak to your partner directly.
        </div>
      </div>
    </div>
  );
}
