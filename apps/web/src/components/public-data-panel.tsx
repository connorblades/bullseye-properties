'use client';

import dynamic from 'next/dynamic';
import type {
  Deal, PublicData, PublicDataStatus, FloodInfo, EpcInfo,
  Demographics, CouncilTaxInfo, PlanningInfo, PricePaidInfo, HpiInfo,
  PlanningApplication, MapLayers,
} from '@/lib/deal-store';
import {
  Droplets, Zap, Landmark, Users, Receipt, TrendingUp, History,
  CheckCircle2, XCircle, MinusCircle, Image as ImageIcon, FileStack, Map as MapIcon, ExternalLink,
} from 'lucide-react';

// MapLibre needs the browser - load the interactive map client-side only.
const RiskMap = dynamic(() => import('@/components/risk-map').then((m) => m.RiskMap), {
  ssr: false,
  loading: () => (
    <div className="bg-bg rounded-lg flex items-center justify-center text-xs text-ink-muted" style={{ height: 360 }}>
      Loading interactive map…
    </div>
  ),
});

function fmtGBP(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

// ── Source status grid ───────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  geocode: 'Geocode', demographics: 'Demographics', hpi: 'House Price Index',
  crime: 'Crime', flood: 'Flood risk', amenities: 'Amenities',
  pricePaid: 'Price Paid', planning: 'Planning', planningApplications: 'Planning apps',
  councilTax: 'Council Tax', epc: 'EPC', maps: 'Maps',
};

function StatusIcon({ s }: { s: PublicDataStatus }) {
  if (s === 'ok') return <CheckCircle2 size={14} className="text-success" />;
  if (s === 'fallback') return <MinusCircle size={14} className="text-amber" />;
  return <XCircle size={14} className="text-ink-muted" />;
}

export function SourceStatusGrid({ data }: { data: PublicData }) {
  const entries = Object.entries(data.status);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {entries.map(([k, s]) => (
        <div key={k} className="flex items-center gap-2 bg-bg rounded-lg px-3 py-2">
          <StatusIcon s={s as PublicDataStatus} />
          <span className="text-xs font-semibold text-ink">{SOURCE_LABEL[k] ?? k}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-muted">{s}</span>
        </div>
      ))}
    </div>
  );
}

// ── Individual cards ─────────────────────────────────────────────────────────

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">{title}</div>
      </div>
      {children}
    </div>
  );
}

export function FloodCard({ flood }: { flood: FloodInfo }) {
  const tone =
    flood.band === 3 ? 'text-red-700 bg-red-50 border-red-200'
    : flood.band === 2 ? 'text-amber bg-amber/15 border-amber/30'
    : 'text-success-dark bg-success-light border-success/30';
  return (
    <Card icon={<Droplets size={15} className="text-navy" />} title="Flood risk (EA)">
      <div className={`inline-flex items-center gap-2 rounded border px-2.5 py-1 text-sm font-black mb-2 ${tone}`}>
        {flood.riskLabel}
      </div>
      <p className="text-xs text-ink-mid">{flood.riversAndSea}</p>
      {flood.hasActiveWarning && (
        <p className="text-xs font-bold text-red-600 mt-2">Live EA flood warning active near this location.</p>
      )}
      <p className="text-[10px] text-ink-muted mt-2">Source: {flood.source}</p>
    </Card>
  );
}

export function EpcCard({ epc }: { epc: EpcInfo }) {
  return (
    <Card icon={<Zap size={15} className="text-navy" />} title="EPC">
      <div className="flex items-center gap-4">
        <div>
          <div className="text-2xl font-black text-ink">{epc.currentRating || '-'}</div>
          <div className="text-[10px] text-ink-muted uppercase">Current ({epc.currentScore})</div>
        </div>
        <div className="text-ink-muted">&rarr;</div>
        <div>
          <div className="text-2xl font-black text-success-dark">{epc.potentialRating || '-'}</div>
          <div className="text-[10px] text-ink-muted uppercase">Potential ({epc.potentialScore})</div>
        </div>
      </div>
      <div className="text-xs text-ink-mid mt-2 space-y-0.5">
        {epc.floorAreaM2 != null && <div>Floor area: {epc.floorAreaM2} m&sup2;</div>}
        {epc.propertyType && <div>{epc.propertyType}{epc.builtForm ? ` · ${epc.builtForm}` : ''}</div>}
        {epc.ageBand && <div>Age: {epc.ageBand}</div>}
        {epc.mainHeating && <div className="truncate" title={epc.mainHeating}>Heating: {epc.mainHeating}</div>}
        {epc.lodgementDate && <div className="text-[10px] text-ink-muted">Lodged {epc.lodgementDate}</div>}
      </div>
    </Card>
  );
}

export function CouncilTaxCard({ ct }: { ct: CouncilTaxInfo }) {
  return (
    <Card icon={<Receipt size={15} className="text-navy" />} title="Council Tax">
      <div className="text-2xl font-black text-ink">Band {ct.band ?? '-'}</div>
      <div className="text-[10px] text-ink-muted mt-1">{ct.source}</div>
    </Card>
  );
}

export function DemographicsCard({ d }: { d: Demographics }) {
  return (
    <Card icon={<Users size={15} className="text-navy" />} title="Area context">
      <div className="text-xs text-ink-mid space-y-0.5">
        {d.imdDecile != null && (
          <div>
            Deprivation: <span className="font-bold text-ink">decile {d.imdDecile}/10</span>
            <span className="text-ink-muted"> (1 = most deprived)</span>
          </div>
        )}
        {d.ward && <div>Ward: {d.ward}</div>}
        {d.constituency && <div>Constituency: {d.constituency}</div>}
        {d.adminCounty && <div>County: {d.adminCounty}</div>}
        {d.region && <div>Region: {d.region}</div>}
        {d.lsoa && <div className="text-[10px] text-ink-muted">LSOA: {d.lsoa}</div>}
      </div>
    </Card>
  );
}

export function HpiCard({ hpi }: { hpi: HpiInfo }) {
  return (
    <Card icon={<TrendingUp size={15} className="text-navy" />} title="House Price Index">
      <div className="text-xs text-ink-mid space-y-0.5">
        <div>{hpi.district} ({hpi.latestMonth})</div>
        <div>Avg price: <span className="font-bold text-ink">{fmtGBP(hpi.latestAvgPrice)}</span></div>
        <div>10yr growth: <span className="font-bold text-ink">{hpi.cagr10yrPct.toFixed(1)}% pa</span></div>
      </div>
    </Card>
  );
}

export function PlanningCard({ planning }: { planning: PlanningInfo }) {
  return (
    <Card icon={<Landmark size={15} className="text-navy" />} title="Planning designations">
      {planning.designations.length === 0 ? (
        <p className="text-xs text-ink-mid">No conservation area, listing, green belt or article-4 at this point.</p>
      ) : (
        <ul className="text-xs text-ink-mid space-y-1">
          {planning.designations.slice(0, 8).map((d, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-navy" />
              <span className="font-semibold text-ink">{d.name}</span>
              <span className="text-ink-muted">({d.dataset.replace(/-/g, ' ')})</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PricePaidTable({ pp }: { pp: PricePaidInfo }) {
  return (
    <div className="bg-bg rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <History size={15} className="text-navy" />
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Land Registry sold prices ({pp.postcode})</div>
      </div>
      <div className="space-y-1">
        {pp.transactions.slice(0, 8).map((t, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 text-xs items-baseline">
            <div className="col-span-2 text-ink-muted tabular-nums">{t.date.slice(0, 7)}</div>
            <div className="col-span-6 text-ink truncate" title={`${t.paon} ${t.street}`}>
              {t.paon} {t.street}
            </div>
            <div className="col-span-2 text-ink-muted">{t.propertyType}</div>
            <div className="col-span-2 text-right font-bold text-ink tabular-nums">{fmtGBP(t.price)}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-ink-muted mt-2 italic">Source: HM Land Registry Price Paid Data.</div>
    </div>
  );
}

export function MapsRow({ maps }: { maps: NonNullable<PublicData['maps']> }) {
  const layers: { key: 'amenities' | 'crime'; label: string }[] = [
    { key: 'amenities', label: 'Amenities' },
    { key: 'crime', label: 'Crime catchment' },
  ];
  const present = layers.filter((l) => maps[l.key]);
  if (present.length === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {present.map((l) => (
        <div key={l.key} className="bg-bg rounded-lg overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={maps[l.key]} alt={`${l.label} map`} className="w-full h-40 object-cover" />
          <div className="px-3 py-2 text-xs font-bold text-ink-mid uppercase tracking-wider flex items-center gap-1.5">
            <ImageIcon size={12} /> {l.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A government WMS overlay stacked over a Mapbox aerial base for the same bbox. */
function StackedMap({
  base, overlay, label, icon,
}: { base?: string; overlay?: string; label: string; icon: React.ReactNode }) {
  if (!overlay) return null;
  return (
    <div className="bg-bg rounded-lg overflow-hidden">
      <div className="relative w-full" style={{ aspectRatio: '1 / 1', maxHeight: 320 }}>
        {base && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={base} alt={`${label} base`} className="absolute inset-0 w-full h-full object-cover" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={overlay} alt={label} className="absolute inset-0 w-full h-full object-cover" />
      </div>
      <div className="px-3 py-2 text-xs font-bold text-ink-mid uppercase tracking-wider flex items-center gap-1.5">
        {icon} {label}
      </div>
    </div>
  );
}

export function FloodAreaMap({ maps }: { maps: MapLayers }) {
  return (
    <StackedMap
      base={maps.floodBase}
      overlay={maps.floodOverlay}
      label="Flood risk area (EA Flood Zones 2 & 3)"
      icon={<Droplets size={12} />}
    />
  );
}

export function PlanningApplicationsCard({ apps }: { apps: PlanningApplication[] }) {
  if (apps.length === 0) {
    return (
      <div className="bg-bg rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <FileStack size={15} className="text-navy" />
          <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Planning applications</div>
        </div>
        <p className="text-xs text-ink-mid">No recent planning applications within ~500m.</p>
      </div>
    );
  }
  return (
    <div className="bg-bg rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileStack size={15} className="text-navy" />
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">
          Planning applications ({apps.length}, ~500m)
        </div>
      </div>
      <div className="space-y-2">
        {apps.slice(0, 8).map((a, i) => (
          <div key={i} className="text-xs border-b border-black/[0.05] last:border-0 pb-2 last:pb-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-ink truncate" title={a.reference}>{a.reference || 'Application'}</span>
              <span className="text-ink-muted whitespace-nowrap">
                {a.status}{a.distanceKm != null ? ` · ${a.distanceKm} km` : ''}
              </span>
            </div>
            <div className="text-ink-mid line-clamp-2">{a.description}</div>
            <div className="text-[10px] text-ink-muted">
              {a.appType ? `${a.appType} · ` : ''}{a.startDate ?? ''}
              {a.url ? <> · <a href={a.url} target="_blank" rel="noreferrer" className="text-navy underline">view</a></> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-ink-muted mt-2 italic">Source: PlanIt (local-authority planning data).</div>
    </div>
  );
}

/**
 * The legal title register + plan is paid HMLR data (no free API), so we link
 * straight to HMLR's "Search for land and property information" service where a
 * sourcer can buy the official copy (~GBP 7) for the exact address.
 */
export function TitleRegisterLink({ postcode }: { postcode?: string }) {
  const href = 'https://search-property-information.landregistry.gov.uk/';
  return (
    <div className="bg-bg rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-2">
        <MapIcon size={15} className="text-navy mt-0.5" />
        <div>
          <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Title register & plan</div>
          <div className="text-xs text-ink-mid mt-1">
            The legal title (registered owner, tenure, charges, covenants) is paid HM Land Registry data.
            Buy the official copy for {postcode || 'this address'} direct from HMLR.
          </div>
        </div>
      </div>
      <a href={href} target="_blank" rel="noreferrer" className="btn-secondary text-xs inline-flex items-center gap-1.5 flex-shrink-0">
        Buy from HMLR <ExternalLink size={13} />
      </a>
    </div>
  );
}

// ── Composite panel for the Auto-Pull stage ──────────────────────────────────

export function PublicDataPanel({ deal }: { deal: Deal }) {
  const data = deal.publicData;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <SourceStatusGrid data={data} />
      {data.lat != null && data.lng != null && (
        <div>
          <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">
            Interactive risk map (OS · crime heat · deprivation)
          </div>
          <RiskMap lat={data.lat} lng={data.lng} />
        </div>
      )}
      {data.maps && <MapsRow maps={data.maps} />}
      {data.maps?.floodOverlay && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FloodAreaMap maps={data.maps} />
        </div>
      )}
      <TitleRegisterLink postcode={data.postcode} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.flood && <FloodCard flood={data.flood} />}
        {data.epc && <EpcCard epc={data.epc} />}
        {data.hpi && <HpiCard hpi={data.hpi} />}
        {data.demographics && <DemographicsCard d={data.demographics} />}
        {data.planning && <PlanningCard planning={data.planning} />}
      </div>
      {data.planningApplications && <PlanningApplicationsCard apps={data.planningApplications} />}
      {data.pricePaid && <PricePaidTable pp={data.pricePaid} />}
      {data.fetchedAt && (
        <p className="text-[10px] text-ink-muted text-right">
          Last pulled {new Date(data.fetchedAt).toLocaleString('en-GB')}
        </p>
      )}
    </div>
  );
}
