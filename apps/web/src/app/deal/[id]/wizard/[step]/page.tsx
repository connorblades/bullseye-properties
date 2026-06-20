'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Sparkles, Plus, X, Loader2, CheckCircle2, TrendingUp } from 'lucide-react';
import { WizardShell } from '@/components/wizard-shell';
import { ImageUpload, ImageGallery } from '@/components/image-upload';
import { AmenitiesEditor } from '@/components/amenities-editor';
import { CrimeProfile } from '@/components/crime-profile';
import { DocumentsUpload } from '@/components/documents-upload';
import { signOut } from '@/server/actions/auth';
import { updateDealById } from '@/server/actions/deals';
import { SECTIONS } from '@/lib/sections';
import { fmtMoney } from '@/lib/utils';
import {
  useDeal,
  setStageProgress,
  computeFinancials,
  computeGrowthProjection,
  type Deal,
  type StageRating,
  type Comp,
  type RefurbItem,
  type GrowthDriver,
  type MortgageType,
  type Amenity,
  type PropertyDocument,
} from '@/lib/deal-store';

export default function WizardStepPage({ params }: { params: { id: string; step: string } }) {
  const router = useRouter();
  const id = params.id;
  const total = SECTIONS.length;
  const step = Math.max(1, Math.min(total, parseInt(params.step, 10)));
  const [deal, update] = useDeal(id);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  if (!deal) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card p-10 max-w-md text-center">
          <h2 className="text-xl font-black text-ink mb-3">Deal not found</h2>
          <p className="text-sm text-ink-mid mb-6">This deal does not exist in local storage. Start a new one.</p>
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
      {step === 9 && <DueDiligencePanel deal={deal} />}
      {step === 10 && <GrowthDriversPanel deal={deal} update={update} />}
      {step === 11 && <RefurbPanel deal={deal} update={update} />}
      {step === 12 && <FinancialsPanel deal={deal} update={update} />}
      {step === 13 && <OfferPanel deal={deal} update={update} />}
      {step === 14 && <GeneratePanel deal={deal} onDone={goNext} />}
      {step === 15 && <DeliverPanel deal={deal} />}

      <div className="mt-8 flex items-center justify-between">
        <button onClick={goBack} className="btn-secondary"><ArrowLeft size={16} /> Back</button>
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
  const data: [string, string][] = [
    ['UPRN',                                       '100012345678'],
    ['Title number',                               'NT' + deal.id.toUpperCase().slice(-6)],
    ['Tenure',                                     'Freehold'],
    ['EPC current',                                'D (62)'],
    ['EPC potential',                              'C (74)'],
    ['Council tax band',                           'A'],
    ['Flood risk',                                 'Very Low'],
    ['Last sold',                                  '£82,000 (2014)'],
    ['Comparable street median (Land Registry)',   '£135,000'],
    ['Crime per 1,000',                            '34.2 (district avg 38.1)'],
  ];

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

  return (
    <div className="space-y-4">
      <div className="card p-8">
        <div className="flex items-center gap-2 mb-5">
          <Sparkles size={16} className="text-navy" />
          <div className="text-xs font-bold text-navy uppercase tracking-wider">Auto-pulled from public sources</div>
        </div>
        <div className="text-sm text-ink-mid mb-5">For {deal.address || '(no address)'}</div>
        <div className="grid md:grid-cols-2 gap-3 mb-6">
          {data.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between bg-bg rounded-lg px-4 py-3">
              <div className="text-xs text-ink-mid font-semibold uppercase tracking-wider">{k}</div>
              <div className="text-sm font-bold text-ink">{v}</div>
            </div>
          ))}
        </div>
        <div className="bg-success-light/40 border border-success/20 rounded-lg p-4 text-sm text-success-dark">
          <strong>10 fields prefilled from public sources.</strong> Review and correct anything wrong on the next stage. M2 wires these to live data.gov.uk, EPC register, and data.police.uk feeds.
        </div>
      </div>

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">Area map</div>
        <ImageUpload value={deal.location.mapImage} onChange={setMap} label="Upload area map" height="180px" />
        <div className="text-xs text-ink-muted mt-2">Drop a screenshot from Google Maps or a borough map. M2 replaces this with a Mapbox static render.</div>
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

      {list.map((c, i) => (
        <div key={c.id} className="card p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-navy/[0.08] text-navy font-black flex items-center justify-center flex-shrink-0">{i + 1}</div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input value={c.address} onChange={(e) => setRow(c.id, { address: e.target.value })} placeholder="Address" className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
              <input value={c.detail} onChange={(e) => setRow(c.id, { detail: e.target.value })} placeholder={kind === 'sales' ? 'e.g. Sold 2025-08, 740 sqft' : 'e.g. Listed 2025-09, 2-bed'} className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
              <input value={c.value} onChange={(e) => setRow(c.id, { value: e.target.value })} placeholder={kind === 'sales' ? '£128,000' : '£795 / month'} className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
            </div>
            <button onClick={() => remove(c.id)} className="text-ink-muted hover:text-red-500 transition" aria-label="Remove"><X size={18} /></button>
          </div>
        </div>
      ))}

      <button onClick={add} className="w-full border-2 border-dashed border-black/[0.08] rounded-2xl py-4 text-sm font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition flex items-center justify-center gap-2">
        <Plus size={16} /> Add comparable {list.length + 1}
      </button>
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

function ViewingPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const set = (k: keyof Deal['viewing'], v: string | number | string[]) =>
    update({ viewing: { ...deal.viewing, [k]: v } });

  const categories: { key: keyof Deal['viewing']; label: string }[] = [
    { key: 'roof', label: 'Roof' },
    { key: 'damp', label: 'Damp' },
    { key: 'windows', label: 'Windows' },
    { key: 'heating', label: 'Heating' },
    { key: 'electrics', label: 'Electrics' },
    { key: 'structure', label: 'Structure' },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-4">Condition assessment</div>
        <div className="grid grid-cols-2 gap-3">
          {categories.map((cat) => {
            const value = deal.viewing[cat.key] as StageRating;
            return (
              <div key={cat.key} className="border border-black/[0.08] rounded-lg p-4">
                <div className="text-xs font-bold text-ink uppercase tracking-wider mb-2">{cat.label}</div>
                <div className="flex gap-2">
                  {(['Good', 'OK', 'Issue'] as const).map((s) => {
                    const active = value === s;
                    const colour = s === 'Good' ? 'success' : s === 'OK' ? 'amber' : 'red';
                    return (
                      <button
                        key={s}
                        onClick={() => set(cat.key, s)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded border transition ${
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
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Viewing notes</div>
        <textarea
          value={deal.viewing.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={4}
          placeholder="What did you notice on the day? Anything to flag in the report?"
          className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none"
        />
      </div>

      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">
          Photos ({deal.viewing.photos.length} / 30)
        </div>
        <ImageGallery
          images={deal.viewing.photos}
          onChange={(imgs) => set('photos', imgs)}
          max={30}
          label="Add photo"
        />
      </div>
    </div>
  );
}

function DueDiligencePanel({ deal }: { deal: Deal }) {
  const checks = [
    'Crime rates', 'Flood risk', 'EPC current and potential', 'Street Checker',
    'Local planning', 'Title and tenure', 'Council tax', 'Deprivation index',
    'Local development plans', 'Schools and transport', 'Demographics', 'Rental demand signal',
  ];
  return (
    <div className="space-y-4">
      <div className="card p-5 bg-success-light/40 border-success/20">
        <div className="text-xs font-bold text-success-dark uppercase tracking-wider mb-1">All checks complete</div>
        <div className="text-sm text-ink-mid">12 of 12 checks ran automatically against public data sources. 1 amber flag (planning).</div>
      </div>
      <div className="card p-6">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-4">Crime profile</div>
        <CrimeProfile stats={deal.location.crime} />
      </div>
      <div>
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">All 12 checks</div>
        <div className="grid grid-cols-2 gap-3">
          {checks.map((c) => (
            <div key={c} className="card p-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">{c}</div>
              <span className="text-xs font-bold text-success bg-success-light px-2 py-1 rounded">Auto</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GrowthDriversPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const drivers = deal.growth.drivers;

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

function GeneratePanel({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  const start = () => {
    setGenerating(true);
    window.setTimeout(() => { setDone(true); setGenerating(false); }, 1800);
  };

  if (done) {
    return (
      <div className="card p-10 text-center">
        <div className="w-16 h-16 mx-auto bg-success-light rounded-2xl flex items-center justify-center text-success-dark mb-5">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="text-2xl font-black text-ink mb-2">Report ready</h2>
        <p className="text-ink-mid mb-6 max-w-md mx-auto">The Standard Deal Report for {deal.address} has been compiled. Real Claude-powered generation lands in M2.</p>
        <button onClick={onDone} className="btn-primary mx-auto">Continue to delivery</button>
      </div>
    );
  }

  return (
    <div className="card p-10 text-center">
      <div className="w-16 h-16 mx-auto bg-navy/[0.08] rounded-2xl flex items-center justify-center text-navy mb-5">
        {generating ? <Loader2 size={28} className="animate-spin" /> : <Sparkles size={28} />}
      </div>
      <h2 className="text-2xl font-black text-ink mb-3">{generating ? 'Generating report...' : 'Ready to generate'}</h2>
      <p className="text-ink-mid mb-6 max-w-md mx-auto">
        {generating ? 'Compiling 16 sections, evidence, photos, growth drivers and equity projection into a branded PDF.' : 'All stages complete. Compile the Standard Deal Report. Placeholder for M1: real Claude generation arrives in M2.'}
      </p>
      {!generating && (
        <button onClick={start} className="btn-primary mx-auto">Generate Standard Deal Report</button>
      )}
    </div>
  );
}

function DeliverPanel({ deal }: { deal: Deal }) {
  const shareUrl = `app.bullseyeproperties.co.uk/r/${deal.id}/${deal.id.slice(-6)}`;
  const pdfName = (deal.address.split(',')[0] || 'Property').replace(/[^a-zA-Z0-9]/g, '_') + '_Deal_Pack.pdf';
  return (
    <div className="card p-8">
      <div className="text-sm font-bold text-success bg-success-light inline-block px-3 py-1.5 rounded mb-4">Report ready</div>
      <h2 className="text-xl font-black text-ink mb-5">Send to {deal.client || '(no client yet)'}</h2>
      <div className="space-y-3 mb-6">
        <div className="flex items-center justify-between p-4 bg-bg rounded-lg">
          <div>
            <div className="font-bold text-ink text-sm">Shareable link</div>
            <div className="text-xs text-ink-mid font-mono">{shareUrl}</div>
          </div>
          <button className="btn-secondary text-xs">Copy</button>
        </div>
        <div className="flex items-center justify-between p-4 bg-bg rounded-lg">
          <div>
            <div className="font-bold text-ink text-sm">PDF download</div>
            <div className="text-xs text-ink-mid">{pdfName}</div>
          </div>
          <button className="btn-secondary text-xs">Download</button>
        </div>
      </div>
      <p className="text-xs text-ink-muted italic mb-4">Delivery flow placeholder. M2 ships real share link generation, engagement analytics, and partner-led delivery prompts.</p>
      <button className="btn-primary">Email to client</button>
    </div>
  );
}
