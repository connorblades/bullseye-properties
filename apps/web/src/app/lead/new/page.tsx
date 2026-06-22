'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Target } from 'lucide-react';
import { Nav } from '@/components/nav';
import { signOut } from '@/server/actions/auth';
import { createDeal } from '@/server/actions/deals';
import { emptyDeal, type Deal } from '@/lib/deal-store';
import { scoreLeadFit } from '@/lib/lead-score';

const UK_POSTCODE_RE = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;

/**
 * Quick-add lead with live criteria fit (M5 legit lead pipeline).
 *
 * Captures the client's criteria + a candidate property and scores the fit
 * live, before creating the deal pre-filled at pipeline stage 'leads'. The
 * legitimate, robust core of lead intake - no portal scraping.
 */
export default function NewLeadPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [propType, setPropType] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [price, setPrice] = useState('');
  const [rent, setRent] = useState('');
  const [budget, setBudget] = useState('');
  const [areas, setAreas] = useState('');
  const [critType, setCritType] = useState('');
  const [targetYield, setTargetYield] = useState('');

  const fit = useMemo(() => {
    const draft = emptyDeal('draft', {
      address,
      client,
      criteria: { budget, areas, propertyType: critType, targetYield, refurbTolerance: '', epcRequirement: '', timeline: '' },
      property: { type: propType, bedrooms, askingPrice: price } as Deal['property'],
      financials: { purchasePrice: price, monthlyRent: rent, annualCosts: '' },
    });
    return scoreLeadFit(draft);
  }, [address, client, budget, areas, critType, targetYield, propType, bedrooms, price, rent]);

  const fitTone = fit.pct >= 75 ? 'text-success bg-success-light' : fit.pct >= 50 ? 'text-amber-700 bg-amber-50' : 'text-red-600 bg-red-50';

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = address.trim();
    if (!UK_POSTCODE_RE.test(trimmed)) {
      setError('Enter the full property address including a valid UK postcode.');
      return;
    }
    startTransition(async () => {
      try {
        const { id } = await createDeal({
          address,
          source: 'estate-agent',
          initialInputs: {
            client,
            pipelineStage: 'leads',
            criteria: { budget, areas, propertyType: critType, targetYield, refurbTolerance: '', epcRequirement: '', timeline: '' },
            property: { type: propType, bedrooms, askingPrice: price } as Deal['property'],
            financials: { purchasePrice: price, monthlyRent: rent, annualCosts: '' },
          },
        });
        router.push(`/deal/${id}/wizard/2`);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : 'Could not create lead. Please try again.');
      }
    });
  }

  const field = 'w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 transition';
  const lbl = 'block text-[11px] font-bold text-ink-mid uppercase tracking-wider mb-1.5';

  return (
    <div className="min-h-screen">
      <Nav signOutAction={signOut} />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/pipeline" className="text-sm text-ink-muted hover:text-navy mb-6 inline-block">Back to pipeline</Link>
        <div className="badge mb-3">New lead</div>
        <h1 className="text-3xl font-black text-ink mb-2">Add a lead</h1>
        <p className="text-ink-mid mb-8 max-w-xl">Capture a candidate property against a client&rsquo;s criteria. The fit score updates as you type; creating it drops the lead into the pipeline.</p>

        <form onSubmit={onSubmit} className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <div className="card p-6 space-y-4">
              <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">Candidate property</div>
              <div>
                <label className={lbl}>Address (incl. postcode)</label>
                <input className={field} required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="6 Browning Street, Mansfield, NG18 5PH" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Property type</label><input className={field} value={propType} onChange={(e) => setPropType(e.target.value)} placeholder="Semi-detached" /></div>
                <div><label className={lbl}>Bedrooms</label><input className={field} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} placeholder="3" /></div>
                <div><label className={lbl}>Guide / asking price (£)</label><input className={field} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="120000" /></div>
                <div><label className={lbl}>Expected rent (£/mo)</label><input className={field} value={rent} onChange={(e) => setRent(e.target.value)} placeholder="800" /></div>
              </div>
            </div>

            <div className="card p-6 space-y-4">
              <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">Client</div>
              <div><label className={lbl}>Client name</label><input className={field} value={client} onChange={(e) => setClient(e.target.value)} placeholder="James W. (London)" /></div>
              <div className="text-xs font-bold text-ink-muted uppercase tracking-wider pt-2">Their criteria</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Budget (all-in)</label><input className={field} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="£130,000" /></div>
                <div><label className={lbl}>Target gross yield</label><input className={field} value={targetYield} onChange={(e) => setTargetYield(e.target.value)} placeholder="7%+" /></div>
                <div><label className={lbl}>Preferred areas</label><input className={field} value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Mansfield, Worksop" /></div>
                <div><label className={lbl}>Wanted type</label><input className={field} value={critType} onChange={(e) => setCritType(e.target.value)} placeholder="Semi, 2-3 bed" /></div>
              </div>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">{error}</div>}

            <button type="submit" disabled={isPending} className="btn-primary justify-center disabled:opacity-60">
              {isPending ? <><Loader2 size={18} className="animate-spin" /> Creating lead...</> : <>Create lead <ArrowRight size={18} /></>}
            </button>
          </div>

          {/* Live fit */}
          <div className="md:col-span-1">
            <div className="card p-6 sticky top-28">
              <div className="flex items-center gap-2 mb-3">
                <Target size={16} className="text-navy" />
                <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Fit score</div>
              </div>
              {fit.applicable === 0 ? (
                <p className="text-sm text-ink-muted">Fill in the client&rsquo;s criteria and the property to see how well they match.</p>
              ) : (
                <>
                  <div className={`inline-flex items-baseline gap-1 rounded-lg px-3 py-2 mb-3 ${fitTone}`}>
                    <span className="text-3xl font-black">{fit.pct}%</span>
                    <span className="text-xs font-semibold">fit</span>
                  </div>
                  <div className="text-[11px] text-ink-muted mb-2">{fit.met} of {fit.applicable} criteria met</div>
                  <ul className="space-y-1.5">
                    {fit.reasons.map((r, i) => (
                      <li key={i} className={`text-xs flex items-start gap-1.5 ${r.ok ? 'text-success-dark' : 'text-red-600'}`}>
                        <span>{r.ok ? '✓' : '✗'}</span> {r.text}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
