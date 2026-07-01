'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Sparkles, Plus, X, Loader2, CheckCircle2, TrendingUp, Database, AlertTriangle } from 'lucide-react';
import { WizardShell } from '@/components/wizard-shell';
import { ImageUpload } from '@/components/image-upload';
import { AmenitiesEditor } from '@/components/amenities-editor';
import { CrimeProfile } from '@/components/crime-profile';
import { DocumentsUpload } from '@/components/documents-upload';
import {
  PublicDataPanel, FloodCard, EpcCard,
  DemographicsCard, PlanningCard,
} from '@/components/public-data-panel';
import { Receipt, ExternalLink, Link2 } from 'lucide-react';
import { VendorCompanyLookup } from '@/components/vendor-company-lookup';
import { ShareLinkManager } from '@/components/share-link-manager';
import { InspectionWalkthrough } from '@/components/inspection-walkthrough';
import type { InspectionState } from '@/lib/inspection';
import { signOut } from '@/server/actions/auth';
import { updateDealById } from '@/server/actions/deals';
import { pullPublicData } from '@/server/actions/public-data';
import { publishReport, getLatestDealPackUrl } from '@/server/actions/claude';
import {
  SECTION_META,
  type ReportStreamState,
  type SectionDraft,
  type PublishSection,
} from '@/lib/report-types';
import { SECTIONS } from '@/lib/sections';
import { fmtMoney } from '@/lib/utils';
import {
  useDeal,
  setStageProgress,
  computeFinancials,
  computeGrowthProjection,
  parseSoldMonth,
  parseMoney,
  hpiAdjustValue,
  type Deal,
  type StageRating,
  type Comp,
  type RefurbItem,
  type GrowthDriver,
  type MortgageType,
  type Amenity,
  type PropertyDocument,
  type VendorCompany,
  type ViewingChecklistItem,
} from '@/lib/deal-store';
import {
  CHECKLIST_TO_CONDITION,
  checklistProgress,
  defaultViewingChecklist,
  postViewingBlockers,
  snapshotViewing,
} from '@/lib/viewing';
import { computeGdv, estimateRent, MIN_COMPS } from '@/lib/comps';

export default function WizardStepPage({ params }: { params: { id: string; step: string } }) {
  const router = useRouter();
  const id = params.id;
  const total = SECTIONS.length;
  const step = Math.max(1, Math.min(total, parseInt(params.step, 10)));
  const [deal, update, { loading }] = useDeal(id);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  // While the deal is still being fetched, show a loading state - not the
  // "not found" card (which previously flashed on every navigation between
  // wizard steps before the fetch resolved).
  if (loading || !deal) {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="flex items-center gap-3 text-ink-mid">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm font-medium">Loading deal...</span>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card p-10 max-w-md text-center">
          <h2 className="text-xl font-black text-ink mb-3">Deal not found</h2>
          <p className="text-sm text-ink-mid mb-6">This deal could not be found. It may have been removed, or you may not have access to it.</p>
          <button onClick={() => router.push('/deal/new')} className="btn-primary mx-auto">Start a new deal</button>
        </div>
      </div>
    );
  }

  const goNext = () => {
    if (step < total) {
      setStageProgress(id, Math.min(total, step + 1));
      router.push(`/deal/${id}/wizard/${step + 1}`);
    } else {
      updateDealById(id, { delivered: true, progress: total });
      router.push(`/dashboard`);
    }
  };
  const goBack = () => {
    if (step > 1) router.push(`/deal/${id}/wizard/${step - 1}`);
    else router.push('/deal/new');
  };

  return (
    <WizardShell dealId={id} currentStep={step} signOutAction={signOut}>
      {step === 2 && <CriteriaForm deal={deal} update={update} />}
      {step === 3 && <AutoPullPanel deal={deal} update={update} />}
      {step === 4 && <PropertyForm deal={deal} update={update} />}
      {step === 5 && <CompsPanel kind="sales" deal={deal} update={update} />}
      {step === 6 && <CompsPanel kind="rental" deal={deal} update={update} />}
      {step === 7 && <AuctionPanel deal={deal} update={update} />}
      {step === 8 && <ViewingPanel deal={deal} update={update} />}
      {step === 9 && <DueDiligencePanel deal={deal} update={update} />}
      {step === 10 && <GrowthDriversPanel deal={deal} update={update} />}
      {step === 11 && <RefurbPanel deal={deal} update={update} />}
      {step === 12 && <FinancialsPanel deal={deal} update={update} />}
      {step === 13 && <OfferPanel deal={deal} update={update} />}
      {step === 14 && <GeneratePanel deal={deal} onDone={goNext} />}
      {step === 15 && <DeliverPanel deal={deal} />}

      <div className="mt-8 flex items-center justify-between gap-3">
        <button onClick={goBack} className="btn-secondary"><ArrowLeft size={16} /> Back</button>
        <div className="flex items-center gap-4">
          <a
            href={`/o/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Preview the pre-viewing outline pack (your own copy)"
            className="text-xs font-semibold text-ink-muted hover:text-navy inline-flex items-center gap-1.5"
          >
            <ExternalLink size={14} /> Outline preview
          </a>
          <a
            href={`/deal/${id}/share`}
            title="Create and manage revocable share links to send to investors"
            className="text-xs font-semibold text-ink-muted hover:text-navy inline-flex items-center gap-1.5"
          >
            <Link2 size={14} /> Share links
          </a>
        </div>
        <button onClick={goNext} className="btn-primary">
          {step === total ? 'Mark delivered' : 'Save and continue'} <ArrowRight size={18} />
        </button>
      </div>
    </WizardShell>
  );
}

type UpdateFn = (patch: Partial<Deal>) => void;

function Field({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-center">
      <label className="text-xs font-bold text-ink-mid uppercase tracking-wider col-span-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="col-span-2 border border-black/[0.08] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 transition"
      />
    </div>
  );
}

function CriteriaForm({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const set = (k: keyof Deal['criteria'], v: string) => update({ criteria: { ...deal.criteria, [k]: v } });
  return (
    <div className="card p-8 space-y-5">
      <Field label="Budget (all-in)"     value={deal.criteria.budget}            onChange={(v) => set('budget', v)}            placeholder="£350,000" />
      <Field label="Preferred areas"     value={deal.criteria.areas}             onChange={(v) => set('areas', v)}             placeholder="Mansfield, Worksop, Doncaster" />
      <Field label="Property type"       value={deal.criteria.propertyType}      onChange={(v) => set('propertyType', v)}      placeholder="Semi-detached, 2-3 bed" />
      <Field label="Target gross yield"  value={deal.criteria.targetYield}       onChange={(v) => set('targetYield', v)}       placeholder="7%+" />
      <Field label="Refurb tolerance"    value={deal.criteria.refurbTolerance}   onChange={(v) => set('refurbTolerance', v)}   placeholder="Light: paint, carpets" />
      <Field label="EPC requirement"     value={deal.criteria.epcRequirement}    onChange={(v) => set('epcRequirement', v)}    placeholder="C or upgradable to C" />
      <Field label="Timeline"            value={deal.criteria.timeline}          onChange={(v) => set('timeline', v)}          placeholder="Complete within 4 months" />
      <div className="pt-4 border-t border-black/[0.06] text-xs text-ink-muted italic">
        Locked-in criteria are part of the client agreement. Changes after Stage 4 require client sign-off.
      </div>
    </div>
  );
}

function AutoPullPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPull = async () => {
    setPulling(true);
    setMessage(null);
    setError(null);
    try {
      const res = await pullPublicData(deal.id);
      if (res.applied) update(res.applied);
      if (res.ok) setMessage(res.message);
      else setError(res.message);
    } catch {
      setError('Pull failed. Check the address has a valid UK postcode and try again.');
    } finally {
      setPulling(false);
    }
  };

  const setMap = (img: string | undefined) => update({ location: { ...deal.location, mapImage: img } });
  const setContext = (i: number, img: string | undefined) => {
    const ctx = deal.location.contextImages.map((c, idx) => idx === i ? { ...c, imageData: img } : c);
    update({ location: { ...deal.location, contextImages: ctx } });
  };
  const setContextCaption = (i: number, caption: string) => {
    const ctx = deal.location.contextImages.map((c, idx) => idx === i ? { ...c, caption } : c);
    update({ location: { ...deal.location, contextImages: ctx } });
  };
  const setAmenities = (amenities: Amenity[]) => update({ location: { ...deal.location, amenities } });

  const pulled = Boolean(deal.publicData);

  return (
    <div className="space-y-4">
      <div className="card p-8">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-navy" />
            <div className="text-xs font-bold text-navy uppercase tracking-wider">Live public data</div>
          </div>
          <button onClick={runPull} disabled={pulling} className="btn-primary text-sm disabled:opacity-60">
            {pulling ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {pulled ? 'Re-pull live data' : 'Pull live data'}
          </button>
        </div>
        <div className="text-sm text-ink-mid mb-4">
          For {deal.address || '(no address)'}
          {deal.postcode ? ` · ${deal.postcode}` : ''}
        </div>

        {message && (
          <div className="bg-success-light/40 border border-success/20 rounded-lg p-3 text-sm text-success-dark mb-4">
            {message}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 bg-amber/10 border border-amber/20 rounded-lg p-3 text-sm text-amber mb-4">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}

        {pulled ? (
          <PublicDataPanel deal={deal} />
        ) : (
          <div className="text-sm text-ink-muted bg-bg rounded-lg p-6 text-center">
            No data pulled yet. Pulls HPI, crime, flood, amenities, EPC, council tax, planning,
            Land Registry sold prices and deprivation from public sources. Each is fail-soft.
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">Area map</div>
        <ImageUpload value={deal.location.mapImage} onChange={setMap} label="Upload area map" height="180px" />
        <div className="text-xs text-ink-muted mt-2">Optional manual override. Live pull renders Mapbox amenity, flood and crime maps above.</div>
      </div>

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">Local context images (3)</div>
        <div className="grid grid-cols-3 gap-3">
          {deal.location.contextImages.map((c, i) => (
            <div key={c.id}>
              <ImageUpload value={c.imageData} onChange={(d) => setContext(i, d)} label={c.caption || `Image ${i + 1}`} aspectRatio="4 / 3" />
              <input value={c.caption} onChange={(e) => setContextCaption(i, e.target.value)} placeholder="Caption" className="w-full mt-2 border border-black/[0.08] rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-navy/30" />
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">Local amenities (radius pull)</div>
        <AmenitiesEditor amenities={deal.location.amenities} onChange={setAmenities} />
      </div>
    </div>
  );
}

function PropertyForm({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const set = (k: keyof Deal['property'], v: string) => update({ property: { ...deal.property, [k]: v } });
  const setDocs = (documents: PropertyDocument[]) => update({ property: { ...deal.property, documents } });
  return (
    <div className="space-y-4">
      <div className="card p-8 space-y-5">
        <Field label="Property type"      value={deal.property.type}        onChange={(v) => set('type', v)}        placeholder="Semi-detached" />
        <Field label="Bedrooms"           value={deal.property.bedrooms}    onChange={(v) => set('bedrooms', v)}    placeholder="3" />
        <Field label="Bathrooms"          value={deal.property.bathrooms}   onChange={(v) => set('bathrooms', v)}   placeholder="1" />
        <Field label="Floor area (sqft)"  value={deal.property.floorArea}   onChange={(v) => set('floorArea', v)}   placeholder="780" />
        <Field label="Plot size (sqft)"   value={deal.property.plotSize}    onChange={(v) => set('plotSize', v)}    placeholder="2200" />
        <Field label="Parking"            value={deal.property.parking}     onChange={(v) => set('parking', v)}     placeholder="Off-street, single" />
        <Field label="Year built"         value={deal.property.yearBuilt}   onChange={(v) => set('yearBuilt', v)}   placeholder="c. 1950" />
        <Field label="Heating"            value={deal.property.heating}     onChange={(v) => set('heating', v)}     placeholder="Gas combi (2021)" />
        <Field label="Asking price (£)"   value={deal.property.askingPrice} onChange={(v) => set('askingPrice', v)} placeholder="135000" />
      </div>
      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">Property documents</div>
        <div className="text-xs text-ink-muted mb-4">Floor plan, title plan, EPC certificate. PDFs and images accepted (max 10MB each).</div>
        <DocumentsUpload documents={deal.property.documents} onChange={setDocs} />
      </div>
    </div>
  );
}

function CompsPanel({ kind, deal, update }: { kind: 'sales' | 'rental'; deal: Deal; update: UpdateFn }) {
  const list = kind === 'sales' ? deal.salesComps : deal.rentalComps;
  const key = kind === 'sales' ? 'salesComps' : 'rentalComps';
  const hpi = kind === 'sales' ? deal.publicData?.hpi : undefined;

  const add = () => {
    const item: Comp = { id: 'c-' + Math.random().toString(36).slice(2, 8), address: '', detail: '', value: '' };
    update({ [key]: [...list, item] } as Partial<Deal>);
  };
  const setRow = (compId: string, patch: Partial<Comp>) => {
    const next = list.map((c) => (c.id === compId ? { ...c, ...patch } : c));
    update({ [key]: next } as Partial<Deal>);
  };
  const remove = (compId: string) => update({ [key]: list.filter((c) => c.id !== compId) } as Partial<Deal>);

  return (
    <div className="space-y-4">
      <div className="card p-5 bg-navy/[0.03] border-navy/20">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-navy" />
          <div className="text-xs font-bold text-navy uppercase tracking-wider">{kind === 'sales' ? 'Sales' : 'Rental'} comparables</div>
        </div>
        <div className="text-sm text-ink-mid">Capture a minimum of 3, with source evidence. Bullseye accreditation requires every comp to be sourceable.</div>
      </div>

      {list.length === 0 && (
        <div className="card p-10 text-center text-ink-muted text-sm">No comparables yet. Add at least 3 to continue.</div>
      )}

      {list.map((c, i) => {
        const soldMonth = hpi ? parseSoldMonth(c.detail) : null;
        const soldPrice = hpi ? parseMoney(c.value) : null;
        const adj = hpi && soldMonth && soldPrice ? hpiAdjustValue(soldPrice, soldMonth, hpi) : null;
        return (
          <div key={c.id} className="card p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-navy/[0.08] text-navy font-black flex items-center justify-center flex-shrink-0">{i + 1}</div>
              <div className={`flex-1 grid grid-cols-1 gap-3 ${kind === 'sales' ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                <input value={c.address} onChange={(e) => setRow(c.id, { address: e.target.value })} placeholder="Address" className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
                <input value={c.detail} onChange={(e) => setRow(c.id, { detail: e.target.value })} placeholder={kind === 'sales' ? 'e.g. Sold 2025-08' : 'e.g. Let 2025-09, 2-bed'} className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
                {kind === 'sales' && (
                  <input value={c.floorArea ?? ''} onChange={(e) => setRow(c.id, { floorArea: e.target.value })} placeholder="Floor area (sqft)" inputMode="numeric" className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
                )}
                <input value={c.value} onChange={(e) => setRow(c.id, { value: e.target.value })} placeholder={kind === 'sales' ? '£128,000' : '£795 / month'} className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
              </div>
              <button onClick={() => remove(c.id)} className="text-ink-muted hover:text-red-500 transition" aria-label="Remove"><X size={18} /></button>
            </div>
            {adj && (
              <div className="mt-3 ml-14 flex items-center gap-2 text-xs">
                <TrendingUp size={13} className="text-navy" />
                <span className="text-ink-mid">
                  HPI-adjusted to {hpi!.latestMonth}:{' '}
                  <span className="font-bold text-navy">{fmtMoney(adj.adjusted)}</span>
                  <span className="text-ink-muted"> (&times;{adj.ratio.toFixed(3)} on {soldMonth})</span>
                </span>
              </div>
            )}
          </div>
        );
      })}

      <button onClick={add} className="w-full border-2 border-dashed border-black/[0.08] rounded-2xl py-4 text-sm font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition flex items-center justify-center gap-2">
        <Plus size={16} /> Add comparable {list.length + 1}
      </button>

      {kind === 'sales' ? <GdvSummary deal={deal} /> : <RentEstimateSummary deal={deal} />}
    </div>
  );
}

/** Comparable-led GDV (HPI-adjusted price-per-sqft) shown live under the sales comps. */
function GdvSummary({ deal }: { deal: Deal }) {
  const gdv = computeGdv(deal);
  const subjectSqFt = deal.property.floorArea?.trim();

  if (!gdv) {
    const reasons: string[] = [];
    if (!subjectSqFt) reasons.push('set the subject floor area on Property Details');
    if (!deal.publicData?.hpi) reasons.push('run Auto-Pull so the HPI series is available');
    const withInputs = deal.salesComps.filter(
      (c) => parseMoney(c.value) && parseSoldMonth(c.detail) && (c.floorArea || '').trim()
    ).length;
    if (withInputs < MIN_COMPS) reasons.push(`add at least ${MIN_COMPS} comps with a price, a sold month (e.g. "Sold 2025-08") and a floor area (have ${withInputs})`);
    return (
      <div className="card p-5 border-amber/40 bg-amber-50/40">
        <div className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-1">Estimated value (GDV)</div>
        <div className="text-sm text-ink-mid">To evidence a price-per-sqft GDV, {reasons.join('; ')}.</div>
      </div>
    );
  }

  return (
    <div className="card p-5 border-navy/30 bg-navy/[0.03]">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-bold text-navy uppercase tracking-wider">Estimated value (GDV)</div>
        <div className="text-2xl font-black text-navy">{fmtMoney(gdv.gdv)}</div>
      </div>
      <div className="text-xs text-ink-muted mb-3">
        HPI-adjusted price per sqft across {gdv.comps.length} comparable{gdv.comps.length > 1 ? 's' : ''}, applied to the
        subject {gdv.subjectSqFt.toLocaleString()} sqft, rounded to the nearest £5,000 (raw {fmtMoney(Math.round(gdv.rawGdv))}).
        {gdv.capped && ` ${gdv.usableCount} usable; first ${gdv.comps.length} used.`}
      </div>
      <div className="space-y-1">
        {gdv.comps.map((c) => (
          <div key={c.id} className="flex items-center justify-between text-xs text-ink-mid">
            <span className="truncate mr-3">{c.address || 'Comparable'} ({c.floorArea.toLocaleString()} sqft, {c.soldMonth})</span>
            <span className="text-ink-muted whitespace-nowrap">{fmtMoney(Math.round(c.perSqFt))}/sqft &rarr; <span className="font-semibold text-ink">{fmtMoney(Math.round(c.impliedValue))}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Like-for-like rent uplifted to today by the local growth assumption. */
function RentEstimateSummary({ deal }: { deal: Deal }) {
  const rent = estimateRent(deal);
  if (!rent) {
    return (
      <div className="card p-5 border-amber/40 bg-amber-50/40">
        <div className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-1">Estimated rent</div>
        <div className="text-sm text-ink-mid">Add rental comps with a rent and a let month (e.g. &quot;Let 2025-09&quot;) to estimate today&apos;s rent.</div>
      </div>
    );
  }
  return (
    <div className="card p-5 border-navy/30 bg-navy/[0.03]">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-bold text-navy uppercase tracking-wider">Estimated rent (pcm)</div>
        <div className="text-2xl font-black text-navy">{fmtMoney(rent.estimate)}</div>
      </div>
      <div className="text-xs text-ink-muted">
        {rent.compCount} like-for-like comp{rent.compCount > 1 ? 's' : ''}, uplifted {rent.growthPctUsed}% a year
        {rent.growthSource === 'local' ? ' (local rent trend)' : rent.growthSource === 'manual' ? ' (your assumption)' : ' (default)'} to {rent.asOfMonth},
        rounded to the nearest £25.{rent.growthSource === 'default' ? ' Set the rental growth on Growth Drivers to change the uplift.' : ''}
      </div>
    </div>
  );
}

function AuctionPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const set = (k: keyof Deal['auction'], v: string | boolean) => update({ auction: { ...deal.auction, [k]: v } });
  const isAuction = deal.source === 'auction' || deal.auction.isAuction;
  if (!isAuction) {
    return (
      <div className="card p-10 text-center">
        <div className="text-xs font-bold text-amber uppercase tracking-wider mb-3">Conditional stage</div>
        <h3 className="text-lg font-bold text-ink mb-2">Not an auction sale</h3>
        <p className="text-sm text-ink-mid mb-6">This stage is only required when the property is being sold by auction.</p>
        <button onClick={() => set('isAuction', true)} className="btn-secondary mx-auto">Mark as auction sale anyway</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="card p-5 bg-amber/5 border-amber/20">
        <div className="text-xs font-bold text-amber uppercase tracking-wider mb-1">Auction sale</div>
        <div className="text-sm text-ink-mid">Use the Legal Pack Analyser to extract fees and conditions. Integration lands in M2.</div>
      </div>
      <div className="card p-8 space-y-5">
        <Field label="Buyer-side fees (£)"   value={deal.auction.buyerFees}            onChange={(v) => set('buyerFees', v)}            placeholder="2400" />
        <Field label="Special conditions"    value={deal.auction.specialConditions}    onChange={(v) => set('specialConditions', v)}    placeholder="2 flagged: extension overage, indemnity required" />
        <Field label="Restrictive covenants" value={deal.auction.restrictiveCovenants} onChange={(v) => set('restrictiveCovenants', v)} placeholder="None" />
      </div>
    </div>
  );
}

function RatingChips({ value, onChange }: { value: StageRating; onChange: (v: StageRating) => void }) {
  return (
    <div className="flex gap-1.5">
      {(['Good', 'OK', 'Issue'] as const).map((s) => {
        const active = value === s;
        const colour = s === 'Good' ? 'success' : s === 'OK' ? 'amber' : 'red';
        return (
          <button
            key={s}
            onClick={() => onChange(active ? '' : s)}
            className={`text-[11px] font-semibold px-2 py-0.5 rounded border transition ${
              active
                ? colour === 'success' ? 'border-success bg-success-light text-success-dark'
                : colour === 'amber'   ? 'border-amber bg-amber/15 text-amber'
                :                         'border-red-400 bg-red-50 text-red-600'
                : 'border-black/[0.08] text-ink-mid hover:border-navy/30 hover:text-navy'
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function ViewingPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const v = deal.viewing;
  const checklist = v.checklist ?? defaultViewingChecklist();
  const phase = v.phase ?? 'on';
  const [signName, setSignName] = useState('');
  const [attendee, setAttendee] = useState('');

  const set = (k: keyof Deal['viewing'], val: string | number | string[]) =>
    update({ viewing: { ...v, [k]: val } });

  // Update one checklist item, and sync the core ratings + collected photos
  // back to the legacy viewing fields the PDF reads.
  const setItem = (key: string, patch: Partial<ViewingChecklistItem>) => {
    const next = checklist.map((i) => (i.key === key ? { ...i, ...patch } : i));
    const cond: Record<string, StageRating> = {};
    for (const it of next) {
      const c = CHECKLIST_TO_CONDITION[it.key];
      if (c) cond[c] = (it.rating ?? '') as StageRating;
    }
    const photos = next.map((i) => i.photo).filter((p): p is string => !!p);
    update({ viewing: { ...v, checklist: next, photos, ...cond } });
  };

  const progress = checklistProgress(checklist);
  const blockers = postViewingBlockers(v);
  const signedOff = !!v.signedOffBy;

  const logViewing = () => {
    update({ viewings: [...(deal.viewings ?? []), snapshotViewing(v, attendee.trim() || undefined)] });
    setAttendee('');
  };
  const startNewViewing = () => {
    update({
      viewing: {
        ...v, checklist: defaultViewingChecklist(), photos: [], notes: '', assessment: '', summary: '',
        outcome: '', signedOffBy: '', signedOffAt: '', roof: '', damp: '', windows: '', heating: '', electrics: '', structure: '',
      },
    });
  };

  const phases: { key: 'pre' | 'on' | 'inspect' | 'post'; label: string; sub: string }[] = [
    { key: 'pre', label: 'Before', sub: 'Prospect share + prep' },
    { key: 'on', label: 'During', sub: 'Photo checklist' },
    { key: 'inspect', label: 'Inspection', sub: 'Guided walkthrough' },
    { key: 'post', label: 'After', sub: 'Assessment + sign-off' },
  ];

  const endOrSemi = /end|semi/i.test(deal.property?.type ?? '');

  return (
    <div className="space-y-4">
      {/* Viewing history */}
      {(deal.viewings?.length ?? 0) > 0 && (
        <div className="card p-4">
          <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Viewing history</div>
          <div className="space-y-1.5">
            {deal.viewings!.map((rec) => {
              const p = checklistProgress(rec.checklist);
              return (
                <div key={rec.id} className="flex items-center justify-between text-xs bg-bg rounded-lg px-3 py-2">
                  <span className="text-ink font-semibold">
                    {new Date(rec.date).toLocaleDateString('en-GB')}{rec.attendee ? ` · ${rec.attendee}` : ''}
                  </span>
                  <span className="text-ink-muted">
                    {p.done}/{p.total} photos{rec.outcome ? ` · ${rec.outcome}` : ''}{rec.signedOffBy ? ' · signed off' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Phase switcher */}
      <div className="card p-1.5 flex gap-1">
        {phases.map((p) => {
          const active = phase === p.key;
          return (
            <button
              key={p.key}
              onClick={() => set('phase', p.key)}
              className={`flex-1 rounded-lg px-3 py-2 text-left transition ${active ? 'bg-navy text-white' : 'hover:bg-bg text-ink-mid'}`}
            >
              <div className="text-sm font-bold">{p.label}</div>
              <div className={`text-[11px] ${active ? 'text-white/70' : 'text-ink-muted'}`}>{p.sub}</div>
            </button>
          );
        })}
      </div>

      {/* BEFORE */}
      {phase === 'pre' && (
        <div className="card p-6">
          <div className="text-xs font-bold text-navy uppercase tracking-wider mb-1">Pre-viewing</div>
          <p className="text-sm text-ink-mid mb-4">This is the light pack you share with a prospect to gauge interest, before a viewing is booked. Capture any prep notes and questions for the agent here.</p>
          <textarea
            value={v.prep ?? ''}
            onChange={(e) => set('prep', e.target.value)}
            rows={5}
            placeholder="Questions to ask the agent, things to check, access details, reason for sale, chain position, what's included..."
            className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none"
          />
        </div>
      )}

      {/* DURING - photo checklist */}
      {phase === 'on' && (
        <>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Viewing photo checklist</div>
              <span className="text-xs font-bold text-navy">{progress.done} / {progress.total} captured</span>
            </div>
            <p className="text-xs text-ink-muted mb-4">Photograph each point at the viewing. Set a condition where relevant.</p>
            <div className="grid md:grid-cols-2 gap-3">
              {checklist.map((item) => {
                const captured = item.done || !!item.photo;
                return (
                  <div key={item.key} className={`border rounded-lg p-3 ${captured ? 'border-success/40 bg-success-light/30' : 'border-black/[0.08]'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <button onClick={() => setItem(item.key, { done: !item.done })} className="flex items-center gap-1.5 text-xs font-bold text-ink">
                        <span className={`w-4 h-4 rounded border flex items-center justify-center ${captured ? 'bg-success border-success text-white' : 'border-black/20'}`}>
                          {captured && <CheckCircle2 size={11} />}
                        </span>
                        {item.label}
                      </button>
                      <RatingChips value={(item.rating ?? '') as StageRating} onChange={(r) => setItem(item.key, { rating: r })} />
                    </div>
                    <ImageUpload
                      value={item.photo}
                      onChange={(img) => setItem(item.key, { photo: img, done: !!img || item.done })}
                      label={`Photo: ${item.label}`}
                      aspectRatio="4 / 3"
                    />
                    <input
                      value={item.note ?? ''}
                      onChange={(e) => setItem(item.key, { note: e.target.value })}
                      placeholder="Note (optional)"
                      className="w-full mt-2 border border-black/[0.08] rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-navy/30"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-6">
            <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">General viewing notes</div>
            <textarea
              value={v.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Anything else noticed on the day?"
              className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none"
            />
          </div>

          <button onClick={logViewing} className="btn-secondary inline-flex items-center gap-2">
            <Plus size={16} /> Log this viewing to history
          </button>
        </>
      )}

      {/* INSPECTION - guided walkthrough (M6) */}
      {phase === 'inspect' && (
        <InspectionWalkthrough
          state={v.inspection}
          onChange={(next: InspectionState) => update({ viewing: { ...v, inspection: next } })}
          endOrSemi={endOrSemi}
        />
      )}

      {/* AFTER - assessment + human sign-off */}
      {phase === 'post' && (
        <>
          <div className="card p-6">
            <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Top-level assessment</div>
            <textarea
              value={v.assessment ?? ''}
              onChange={(e) => set('assessment', e.target.value)}
              rows={4}
              placeholder="Pull it together: overall condition, key findings from the photos, anything that changes the numbers."
              className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none"
            />
            <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2 mt-4">Further comments</div>
            <textarea
              value={v.summary ?? ''}
              onChange={(e) => set('summary', e.target.value)}
              rows={3}
              placeholder="Anything else for the report or the client."
              className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none"
            />
            <div className="mt-4 text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Outcome</div>
            <div className="flex gap-2">
              {([
                { key: 'proceed', label: 'Proceed', cls: 'border-success bg-success-light text-success-dark' },
                { key: 'undecided', label: 'Undecided', cls: 'border-amber bg-amber/15 text-amber' },
                { key: 'pass', label: 'Pass', cls: 'border-red-400 bg-red-50 text-red-600' },
              ] as const).map((o) => {
                const active = (v.outcome ?? '') === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => set('outcome', o.key)}
                    className={`text-sm font-semibold px-4 py-2 rounded-lg border transition ${active ? o.cls : 'border-black/[0.08] text-ink-mid hover:border-navy/30 hover:text-navy'}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Human-in-the-loop sign-off (gates sending to client) */}
          <div className={`card p-6 ${signedOff ? 'border-success/40 bg-success-light/30' : 'border-amber/40 bg-amber-50/40'}`}>
            <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Human sign-off (required before sending to client)</div>
            {signedOff ? (
              <div className="flex items-center justify-between">
                <div className="text-sm text-success-dark font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} /> Reviewed &amp; approved by {v.signedOffBy}
                  {v.signedOffAt ? ` · ${new Date(v.signedOffAt).toLocaleDateString('en-GB')}` : ''}
                </div>
                <button onClick={() => update({ viewing: { ...v, signedOffBy: '', signedOffAt: '' } })} className="text-xs text-ink-muted hover:text-red-500 font-semibold">Undo</button>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-mid mb-3">Confirm you&rsquo;ve reviewed the report and all the information is correct. This is the human-in-the-loop check before it goes to the client.</p>
                {blockers.length > 0 && (
                  <div className="text-xs text-amber-900 mb-3">Still needed: {blockers.join(', ')}.</div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={signName}
                    onChange={(e) => setSignName(e.target.value)}
                    placeholder="Your name"
                    className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
                  />
                  <button
                    onClick={() => update({ viewing: { ...v, signedOffBy: signName.trim() || 'Accredited partner', signedOffAt: new Date().toISOString() } })}
                    disabled={!v.assessment?.trim()}
                    className="btn-primary disabled:opacity-50"
                  >
                    Sign off &amp; approve
                  </button>
                </div>
                {!v.assessment?.trim() && <p className="text-[11px] text-ink-muted mt-2">Add a top-level assessment first.</p>}
              </>
            )}
          </div>

          <button onClick={logViewing} className="btn-secondary inline-flex items-center gap-2">
            <Plus size={16} /> Log this viewing to history
          </button>
          <button onClick={startNewViewing} className="text-xs text-ink-muted hover:text-navy font-semibold ml-3">Start a fresh viewing</button>
        </>
      )}
    </div>
  );
}

function DueDiligencePanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const pd = deal.publicData;
  const setVendor = (vendorCompany: VendorCompany) => update({ vendorCompany });

  return (
    <div className="space-y-4">
      {!pd && (
        <div className="card p-5 bg-amber/5 border-amber/20 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber mt-0.5" />
          <div className="text-sm text-ink-mid">
            No live data pulled yet. Go back to <strong>Auto-Pull and Location</strong> and pull live data
            to populate flood, crime, planning, EPC, council tax and deprivation here.
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-4">Crime profile</div>
        <CrimeProfile stats={deal.location.crime} />
      </div>

      {pd && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pd.flood && <FloodCard flood={pd.flood} />}
          {pd.planning && <PlanningCard planning={pd.planning} />}
          {pd.epc && <EpcCard epc={pd.epc} />}
          {pd.demographics && <DemographicsCard d={pd.demographics} />}
        </div>
      )}

      <CouncilTaxManual deal={deal} update={update} />

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-1">Vendor company check (Companies House)</div>
        <div className="text-xs text-ink-muted mb-4">
          For auction or direct-to-vendor deals where the seller is a company: status, officers, charges and insolvency.
        </div>
        <VendorCompanyLookup dealId={deal.id} company={deal.vendorCompany} onResult={setVendor} />
      </div>
    </div>
  );
}

function CouncilTaxManual({ deal, update }: { deal: Deal; update: UpdateFn }) {
  // VOA has no API and actively blocks scraping, so the band is entered by hand.
  // Deep-link the VOA "Check your Council Tax band" service for the postcode.
  const voaUrl = 'https://www.tax.service.gov.uk/check-council-tax-band/search';
  const bands = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Receipt size={15} className="text-navy" />
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Council Tax band</div>
      </div>
      <div className="text-xs text-ink-muted mb-4">
        Entered manually - the VOA publishes no API. Look it up for {deal.postcode || 'this postcode'} and select below.
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={deal.councilTaxBand ?? ''}
          onChange={(e) => update({ councilTaxBand: e.target.value })}
          className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
        >
          <option value="">Select band</option>
          {bands.map((b) => <option key={b} value={b}>Band {b}</option>)}
        </select>
        <a
          href={voaUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary text-xs inline-flex items-center gap-1.5"
        >
          Look up on VOA <ExternalLink size={13} />
        </a>
        {deal.councilTaxBand && (
          <span className="text-sm font-black text-ink">Band {deal.councilTaxBand}</span>
        )}
      </div>
    </div>
  );
}

function GrowthDriversPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const drivers = deal.growth.drivers ?? [];

  const setDriver = (id: string, patch: Partial<GrowthDriver>) => {
    const next = drivers.map((d) => d.id === id ? { ...d, ...patch } : d);
    update({ growth: { ...deal.growth, drivers: next } });
  };
  const addDriver = () => {
    const next: GrowthDriver = { id: 'g-' + Math.random().toString(36).slice(2, 8), title: '', justification: '' };
    update({ growth: { ...deal.growth, drivers: [...drivers, next] } });
  };
  const removeDriver = (id: string) => update({ growth: { ...deal.growth, drivers: drivers.filter((d) => d.id !== id) } });

  return (
    <div className="space-y-4">
      <div className="card p-5 bg-navy/[0.03] border-navy/20">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-navy" />
          <div className="text-xs font-bold text-navy uppercase tracking-wider">Capital growth justification</div>
        </div>
        <div className="text-sm text-ink-mid">Each driver is a specific local factor that justifies the capital-growth assumption used in the financial model. Capture 4 by default; add more if relevant.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {drivers.map((d, i) => (
          <div key={d.id} className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">Driver {i + 1}</div>
              {drivers.length > 1 && (
                <button onClick={() => removeDriver(d.id)} className="text-ink-muted hover:text-red-500" aria-label="Remove driver"><X size={16} /></button>
              )}
            </div>
            <ImageUpload
              value={d.imageData}
              onChange={(img) => setDriver(d.id, { imageData: img })}
              label={d.title || `Driver ${i + 1} image`}
              aspectRatio="16 / 9"
            />
            <input
              value={d.title}
              onChange={(e) => setDriver(d.id, { title: e.target.value })}
              placeholder="Driver title (e.g. King's Mill Hospital)"
              className="w-full border border-black/[0.08] rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-navy/30"
            />
            <textarea
              value={d.justification}
              onChange={(e) => setDriver(d.id, { justification: e.target.value })}
              placeholder="Specific, evidenced. Distance, scale, timing, why it drives rental demand or capital appreciation."
              rows={3}
              className="w-full border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none"
            />
          </div>
        ))}
      </div>

      {drivers.length < 8 && (
        <button onClick={addDriver} className="w-full border-2 border-dashed border-black/[0.08] rounded-2xl py-4 text-sm font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition flex items-center justify-center gap-2">
          <Plus size={16} /> Add driver {drivers.length + 1}
        </button>
      )}
    </div>
  );
}

function RefurbPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const items = deal.refurb.items;
  const setRefurb = (patch: Partial<Deal['refurb']>) => update({ refurb: { ...deal.refurb, ...patch } });

  const addItem = () => {
    const item: RefurbItem = { id: 'r-' + Math.random().toString(36).slice(2, 8), name: '', cost: '' };
    setRefurb({ items: [...items, item] });
  };
  const setItem = (itemId: string, patch: Partial<RefurbItem>) => {
    setRefurb({ items: items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) });
  };
  const remove = (itemId: string) => setRefurb({ items: items.filter((i) => i.id !== itemId) });

  const total = items.reduce((sum, i) => sum + (parseFloat(i.cost.replace(/[^0-9.]/g, '')) || 0), 0);
  const cPct = parseFloat(deal.refurb.contingencyPct) || 0;
  const withContingency = total * (1 + cPct / 100);

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-4">Itemised refurbishment cost</div>
        <div className="space-y-2">
          {items.length === 0 && (
            <div className="text-center text-ink-muted text-sm py-6">No items yet. Add the first one below.</div>
          )}
          {items.map((it) => (
            <div key={it.id} className="grid grid-cols-12 gap-3 items-center">
              <input value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })} placeholder="e.g. Paint and decoration" className="col-span-7 border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
              <input value={it.cost} onChange={(e) => setItem(it.id, { cost: e.target.value })} placeholder="1400" className="col-span-4 border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
              <button onClick={() => remove(it.id)} className="col-span-1 text-ink-muted hover:text-red-500 transition" aria-label="Remove"><X size={18} /></button>
            </div>
          ))}
        </div>
        <button onClick={addItem} className="w-full mt-4 border-2 border-dashed border-black/[0.08] rounded-lg py-3 text-sm font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition flex items-center justify-center gap-2">
          <Plus size={16} /> Add refurb item
        </button>
      </div>
      <div className="card p-6 grid grid-cols-2 gap-5">
        <div>
          <label className="text-xs font-bold text-ink-mid uppercase tracking-wider block mb-2">Contingency %</label>
          <input value={deal.refurb.contingencyPct} onChange={(e) => setRefurb({ contingencyPct: e.target.value })} className="w-full border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
        </div>
        <div>
          <label className="text-xs font-bold text-ink-mid uppercase tracking-wider block mb-2">Timeline (weeks)</label>
          <input value={deal.refurb.weeks} onChange={(e) => setRefurb({ weeks: e.target.value })} className="w-full border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
        </div>
      </div>
      <div className="card p-6 bg-navy/[0.03] border-navy/15">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-ink">Total with contingency</div>
          <div className="text-2xl font-black text-navy">{fmtMoney(withContingency)}</div>
        </div>
        <div className="text-xs text-ink-muted mt-1">{fmtMoney(total)} items plus {deal.refurb.contingencyPct}% contingency</div>
      </div>
    </div>
  );
}

function FinancialsPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const setFin = (k: keyof Deal['financials'], v: string) => update({ financials: { ...deal.financials, [k]: v } });
  const setG = (patch: Partial<Deal['growth']>) => update({ growth: { ...deal.growth, ...patch } });
  const f = computeFinancials(deal);
  const proj = computeGrowthProjection(deal);

  return (
    <div className="space-y-4">
      <div className="card p-8 space-y-5">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Your inputs</div>
        <Field label="Intended purchase price (£)" value={deal.financials.purchasePrice} onChange={(v) => setFin('purchasePrice', v)} placeholder="112500" />
        <Field label="Expected monthly rent (£)"   value={deal.financials.monthlyRent}   onChange={(v) => setFin('monthlyRent', v)}   placeholder="800" />
        <Field label="Annual costs (£)"             value={deal.financials.annualCosts}   onChange={(v) => setFin('annualCosts', v)}   placeholder="1800" />
      </div>

      <div className="card p-8">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-4">Computed (day-one)</div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Gross yield',          value: f.purchasePrice ? `${f.grossYield.toFixed(1)}%` : '-' },
            { label: 'Net yield',            value: f.purchasePrice ? `${f.netYield.toFixed(1)}%` : '-' },
            { label: 'Annual rent',          value: fmtMoney(f.annualRent) },
            { label: 'Refurb (incl. cont.)', value: fmtMoney(f.refurbWithContingency) },
            { label: 'Total acquisition',    value: fmtMoney(f.totalAcquisition) },
            { label: 'Stress: +1% rate',     value: f.netYield > 0 ? `${(f.netYield - 1).toFixed(1)}% net` : '-' },
          ].map((m) => (
            <div key={m.label} className="bg-bg rounded-lg p-4">
              <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">{m.label}</div>
              <div className="text-xl font-black text-ink">{m.value}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-ink-muted mt-4">Includes the £3,000 Bullseye sourcing fee in total acquisition cost.</div>
      </div>

      <div className="card p-8 space-y-5">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Growth and mortgage assumptions</div>
        {deal.publicData?.hpi && (
          <div className="flex items-center gap-2 text-xs text-navy bg-navy/[0.04] border border-navy/15 rounded-lg px-3 py-2">
            <TrendingUp size={14} />
            <span>
              Default capital growth seeded from {deal.publicData.hpi.district} HPI:{' '}
              <strong>{deal.publicData.hpi.cagr10yrPct.toFixed(1)}% pa</strong> (10yr), weighted for flood/deprivation. Edit freely.
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Capital growth pa (%)"   value={deal.growth.capitalGrowthPct} onChange={(v) => setG({ capitalGrowthPct: v })} placeholder="3.0" />
          <Field label="Rental growth pa (%)"    value={deal.growth.rentalGrowthPct}  onChange={(v) => setG({ rentalGrowthPct: v })}  placeholder="2.0" />
          <div>
            <label className="text-xs font-bold text-ink-mid uppercase tracking-wider block mb-2">Mortgage type</label>
            <select
              value={deal.growth.mortgageType}
              onChange={(e) => setG({ mortgageType: e.target.value as MortgageType })}
              className="w-full border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
            >
              <option value="interest-only">Interest-only BTL</option>
              <option value="repayment">Repayment</option>
              <option value="cash">Cash purchase</option>
            </select>
          </div>
          <Field label="LTV %"                   value={deal.growth.ltvPct}           onChange={(v) => setG({ ltvPct: v })}           placeholder="75" />
          <Field label="Mortgage rate (%)"       value={deal.growth.mortgageRatePct}  onChange={(v) => setG({ mortgageRatePct: v })}  placeholder="5.8" />
          <Field label="Hold period (years)"     value={deal.growth.holdYears}        onChange={(v) => setG({ holdYears: v })}        placeholder="10" />
          <Field label="Refinance years (csv)"   value={deal.growth.refinanceYears}   onChange={(v) => setG({ refinanceYears: v })}   placeholder="2,5" />
        </div>
      </div>

      <div className="card p-8">
        <div className="text-xs font-bold text-navy uppercase tracking-wider mb-4">Equity projection preview</div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-bg rounded-lg p-4">
            <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">Cash deployed</div>
            <div className="text-lg font-black text-ink">{fmtMoney(proj.cashDeployed)}</div>
          </div>
          <div className="bg-bg rounded-lg p-4">
            <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">Refi cash extracted</div>
            <div className="text-lg font-black text-success-dark">{fmtMoney(proj.refinanceTotal)}</div>
          </div>
          <div className="bg-bg rounded-lg p-4">
            <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">Payoff year</div>
            <div className="text-lg font-black text-ink">{proj.payoffYear !== null ? `Year ${proj.payoffYear}` : 'Beyond hold'}</div>
          </div>
          <div className="bg-bg rounded-lg p-4">
            <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">Year-10 sale net</div>
            <div className="text-lg font-black text-navy">{fmtMoney(proj.exit10.cashOut)}</div>
          </div>
        </div>
        <ProjectionChart proj={proj} />
      </div>
    </div>
  );
}

function ProjectionChart({ proj }: { proj: ReturnType<typeof computeGrowthProjection> }) {
  const max = Math.max(
    ...proj.years.map((y) => y.propertyValue),
    proj.cashDeployed * 1.2
  );
  const range = Math.ceil(max / 50000) * 50000;
  const yScale = (v: number) => 200 - (v / range) * 180;
  const width = 720;
  const xStep = 60;

  return (
    <svg viewBox={`0 0 ${width} 240`} className="w-full">
      <line x1="40" y1="20" x2="40" y2="200" stroke="#cbd5e1" />
      <line x1="40" y1="200" x2={width - 20} y2="200" stroke="#cbd5e1" />
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const y = 200 - p * 180;
        return (
          <g key={p}>
            <line x1="40" y1={y} x2={width - 20} y2={y} stroke="#f1f5f9" strokeDasharray="2,2" />
            <text x="35" y={y + 3} textAnchor="end" fontSize="9" fill="#6c757d">{fmtMoney(p * range)}</text>
          </g>
        );
      })}
      {proj.years.map((y, i) => {
        const x = 50 + i * xStep;
        const mBar = (y.mortgageBalance / range) * 180;
        const eBar = (y.equity / range) * 180;
        return (
          <g key={y.year}>
            <rect x={x} y={200 - mBar} width={24} height={mBar} fill="#0d2a5e" rx="1.5" />
            <rect x={x} y={200 - mBar - eBar} width={24} height={eBar} fill="#1f5199" rx="1.5" />
            <text x={x + 12} y="218" textAnchor="middle" fontSize="9" fill="#6c757d">Y{y.year}</text>
            {y.refinanceEvent && (
              <circle cx={x + 12} cy={200 - mBar - eBar - 6} r="3.5" fill="#10b981" stroke="white" strokeWidth="1.5" />
            )}
          </g>
        );
      })}
      <line x1="40" y1={yScale(proj.cashDeployed)} x2={width - 20} y2={yScale(proj.cashDeployed)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" />
      <text x={width - 22} y={yScale(proj.cashDeployed) - 4} textAnchor="end" fontSize="9" fill="#ef4444" fontWeight="700">Cash deployed {fmtMoney(proj.cashDeployed)}</text>
      <polyline
        points={proj.years.map((y, i) => `${50 + i * xStep + 12},${yScale(y.cumulativeCash)}`).join(' ')}
        stroke="#10b981" strokeWidth="2" fill="none"
      />
    </svg>
  );
}

function OfferPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const set = (k: keyof Deal['offer'], v: string) => update({ offer: { ...deal.offer, [k]: v } });
  return (
    <div className="space-y-4">
      <div className="card p-8">
        <label className="text-xs font-bold text-ink-mid uppercase tracking-wider block mb-2">Recommended offer (£)</label>
        <input value={deal.offer.recommended} onChange={(e) => set('recommended', e.target.value)} placeholder="112500" className="w-full text-4xl font-black text-navy border border-black/[0.08] rounded-lg px-4 py-4 focus:outline-none focus:ring-2 focus:ring-navy/30" />
      </div>
      <div className="card p-8">
        <label className="text-xs font-bold text-ink-mid uppercase tracking-wider block mb-2">Negotiation strategy</label>
        <textarea value={deal.offer.strategy} onChange={(e) => set('strategy', e.target.value)} rows={5} placeholder="Anchor at, settle range, vendor motivation, contingencies..." className="w-full border border-black/[0.08] rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none" />
      </div>
    </div>
  );
}

/** Pull [VERIFY: ...] markers out of a narrative for the partner to action. */
function extractVerifyFlags(text: string): string[] {
  const flags: string[] = [];
  const re = /\[VERIFY:\s*([^\]]+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) flags.push(m[1].trim());
  return flags;
}

type GenPhase = 'idle' | 'generating' | 'review' | 'publishing' | 'published';

function SectionEditor({
  label,
  draft,
  value,
  onChange,
}: {
  label: string;
  draft: SectionDraft;
  value: string;
  onChange: (v: string) => void;
}) {
  const flags = extractVerifyFlags(value);
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          {label} &middot; <span className="text-navy">Drafted by AI &mdash; reviewed by you</span>
        </div>
        {draft.manualDraft && (
          <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Manual draft</span>
        )}
      </div>

      {draft.done ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(4, Math.ceil(value.length / 90))}
          className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm text-ink leading-relaxed focus:outline-none focus:ring-2 focus:ring-navy/30 resize-y"
        />
      ) : (
        <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap min-h-[3rem]">
          {draft.text}
          <span className="inline-block w-2 h-4 ml-0.5 align-middle bg-navy/50 animate-pulse" />
        </div>
      )}

      {flags.length > 0 && (
        <div className="mt-3 text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
          <span className="font-bold">Verify before publishing:</span>
          <ul className="list-disc ml-5 mt-1 space-y-0.5">
            {flags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function GeneratePanel({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const [phase, setPhase] = useState<GenPhase>('idle');
  const [drafts, setDrafts] = useState<ReportStreamState | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const degraded = drafts ? Object.values(drafts).some((d) => d.degraded) : false;

  const start = async () => {
    setPhase('generating');
    setError(null);
    setDrafts(null);
    setEdited({});
    try {
      const resp = await fetch(`/api/deal/${deal.id}/report-stream`, { method: 'POST' });
      if (!resp.ok || !resp.body) throw new Error('Generation failed to start.');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let last: ReportStreamState | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line) as ReportStreamState | { error: string };
          if ('error' in obj) throw new Error(obj.error);
          last = obj;
          setDrafts({ ...obj });
        }
      }
      if (last) {
        setEdited(Object.fromEntries(SECTION_META.map(({ key }) => [key, last![key].text])));
      }
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed. Please retry.');
      setPhase('idle');
    }
  };

  const publish = async () => {
    if (!drafts) return;
    // Human-in-the-loop gate: don't send to a client until the post-viewing
    // sign-off is complete (Stage 8 -> After).
    const viewingBlockers = postViewingBlockers(deal.viewing);
    if (viewingBlockers.length > 0) {
      setError(`Before sending to a client, complete the post-viewing review in Stage 8 (After): needs ${viewingBlockers.join(' and ')}.`);
      return;
    }
    setPhase('publishing');
    setError(null);
    try {
      const payload: PublishSection[] = SECTION_META.map(({ key }) => ({
        section: key,
        raw: drafts[key].raw,
        edited: edited[key] ?? drafts[key].text,
        model: drafts[key].model,
        promptVersionHash: drafts[key].promptVersionHash,
        inputTokens: drafts[key].inputTokens,
        outputTokens: drafts[key].outputTokens,
        manualDraft: drafts[key].manualDraft,
      }));
      const res = await publishReport(deal.id, payload);
      if (res.renderError) {
        setError(`Draft published, but the PDF render failed: ${res.renderError}. You can continue and retry the render from delivery.`);
      }
      setPhase('published');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed. Please retry.');
      setPhase('review');
    }
  };

  const busy = phase === 'generating' || phase === 'publishing';

  return (
    <div className="card p-8">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-12 h-12 shrink-0 bg-navy/[0.08] rounded-2xl flex items-center justify-center text-navy">
          {busy ? <Loader2 size={24} className="animate-spin" /> : phase === 'published' ? <CheckCircle2 size={24} /> : <Sparkles size={24} />}
        </div>
        <div>
          <h2 className="text-2xl font-black text-ink mb-1">
            {phase === 'generating' && 'Drafting the five narrative sections...'}
            {phase === 'review' && 'Review and edit the draft'}
            {phase === 'publishing' && 'Publishing...'}
            {phase === 'published' && 'Report published'}
            {phase === 'idle' && 'Generate the Final Report (Report 2)'}
          </h2>
          <p className="text-sm text-ink-mid max-w-xl">
            The full Standard Deal Report, built on the pre-viewing pack (Report 1) plus your viewing findings. Claude
            drafts the five narrative sections from your inputs; edit each before publishing. Sending is gated until the
            viewing is signed off (Stage 8, After).
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 text-red-800 text-sm rounded-lg px-4 py-3 mb-4">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {degraded && (
        <div className="flex items-start gap-2 bg-amber-50 text-amber-900 text-sm rounded-lg px-4 py-3 mb-4">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>AI service degraded &mdash; drafts may need extra review.</span>
        </div>
      )}

      {drafts && (
        <div className="space-y-4 mb-6">
          {SECTION_META.map(({ key, label }) => (
            <SectionEditor
              key={key}
              label={label}
              draft={drafts[key]}
              value={edited[key] ?? drafts[key].text}
              onChange={(v) => setEdited((prev) => ({ ...prev, [key]: v }))}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        {(phase === 'idle' || phase === 'review') && (
          <button onClick={start} disabled={busy} className="btn-secondary disabled:opacity-50">
            {phase === 'review' ? 'Regenerate all' : 'Generate Standard Deal Report'}
          </button>
        )}
        {phase === 'review' && (
          <button onClick={publish} className="btn-primary">Publish report</button>
        )}
        {phase === 'published' && (
          <button onClick={onDone} className="btn-primary inline-flex items-center gap-1.5">
            <CheckCircle2 size={16} /> Continue to delivery
          </button>
        )}
      </div>
    </div>
  );
}

function DeliverPanel({ deal }: { deal: Deal }) {
  const [pdf, setPdf] = useState<{ url: string; version: number; filename: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getLatestDealPackUrl(deal.id)
      .then((r) => { if (!cancelled) setPdf(r); })
      .catch(() => { if (!cancelled) setPdf(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deal.id]);

  return (
    <div className="space-y-6">
      <div className="card p-8">
        <div className="text-sm font-bold text-success bg-success-light inline-block px-3 py-1.5 rounded mb-4">
          {pdf ? `Report ready · v${pdf.version}` : 'Report'}
        </div>
        <h2 className="text-xl font-black text-ink mb-5">Send to {deal.client || '(no client yet)'}</h2>
        <div className="flex items-center justify-between p-4 bg-bg rounded-lg">
          <div>
            <div className="font-bold text-ink text-sm">Your copy (signed PDF download)</div>
            <div className="text-xs text-ink-mid">
              {loading ? 'Locating latest report...' : pdf ? pdf.filename : 'No rendered report yet. Generate one in Stage 14.'}
            </div>
          </div>
          {pdf ? (
            <a href={pdf.url} target="_blank" rel="noopener noreferrer" download={pdf.filename} className="btn-secondary text-xs">
              Download
            </a>
          ) : (
            <button disabled className="btn-secondary text-xs opacity-50">Download</button>
          )}
        </div>
        <p className="text-xs text-ink-muted mt-3">
          The download above is a short-lived signed link for your own records. To send the report to an investor, create
          a revocable share link below.
        </p>
      </div>

      <ShareLinkManager
        dealId={deal.id}
        kind="report"
        title="Investor share links (Report 2)"
        description="Revocable, expiring links to the full Standard Deal Report. Each link is pinned to the report version current when you create it, opens a clean investor view, and tracks opens and downloads."
        disabledReason={
          loading
            ? 'Checking for a rendered report...'
            : pdf
              ? undefined
              : 'Generate the full report in Stage 14 first, then create a share link here.'
        }
      />
    </div>
  );
}
