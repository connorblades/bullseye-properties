'use client';

import dynamic from 'next/dynamic';
import type {
  Deal, PublicData, PublicDataStatus, FloodInfo, EpcInfo,
  Demographics, CouncilTaxInfo, PlanningInfo, PricePaidInfo, HpiInfo,
  PlanningApplication, MapLayers, SchoolInfo, AreaStats, AirQualityInfo, RiverLevelInfo, LandOwnershipInfo,
} from '@/lib/deal-store';
import {
  Droplets, Zap, Landmark, Users, Receipt, TrendingUp, History,
  CheckCircle2, XCircle, MinusCircle, Image as ImageIcon, FileStack, ExternalLink,
  GraduationCap, Building2, Wind, Waves,
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
  schools: 'Schools', areaStats: 'Population & jobs', airQuality: 'Air quality',
  councilTax: 'Council Tax', epc: 'EPC', maps: 'Maps', riverLevels: 'River levels',
  landOwnership: 'Land ownership',
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

export function LandOwnershipCard({ owned }: { owned: LandOwnershipInfo }) {
  return (
    <Card icon={<Landmark size={15} className="text-navy" />} title="Corporate ownership (HMLR)">
      <div className="space-y-2">
        {owned.titles.slice(0, 6).map((t) => (
          <div key={t.titleNumber} className="text-xs">
            <div className="font-semibold text-ink">
              {t.proprietors.map((p) => p.name).join(', ') || 'Company owner'}
            </div>
            <div className="text-ink-muted">
              {t.address ? `${t.address} · ` : ''}{t.tenure ?? ''}{t.proprietors[0]?.companyRegNo ? ` · Co. ${t.proprietors[0].companyRegNo}` : ''}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-muted mt-2">
        Company-owned titles at this postcode (HMLR CCOD/OCOD, free). Individual owners are not in the open data.
      </p>
    </Card>
  );
}

export function RiverLevelsCard({ rivers }: { rivers: RiverLevelInfo }) {
  return (
    <Card icon={<Waves size={15} className="text-navy" />} title="River-level stations (EA)">
      <div className="space-y-1.5">
        {rivers.stations.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-ink font-semibold">
              {s.riverName ? `${s.riverName} — ` : ''}{s.label}
              {s.town ? <span className="text-ink-muted font-normal"> · {s.town}</span> : null}
            </span>
            <span className="text-ink-muted">{s.distanceKm} km</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-muted mt-2">Source: {rivers.source}</p>
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

export function AreaStatsCard({ stats }: { stats: AreaStats }) {
  const pct = (v?: number) => (v != null ? `${v.toFixed(1)}%` : '-');
  return (
    <Card icon={<Building2 size={15} className="text-navy" />} title="Population & jobs (Census 2021)">
      <div className="text-xs text-ink-mid space-y-0.5">
        <div>{stats.areaName}</div>
        <div>Population: <span className="font-bold text-ink">{stats.population.toLocaleString('en-GB')}</span> <span className="text-ink-muted">({stats.densityPerKm2.toLocaleString('en-GB')}/km&sup2;)</span></div>
        <div>In employment: <span className="font-bold text-ink">{pct(stats.employmentRate)}</span></div>
        <div>Economically active: {pct(stats.economicActivityRate)} · inactive: {pct(stats.inactiveRate)}</div>
      </div>
    </Card>
  );
}

export function AirQualityCard({ aq }: { aq: AirQualityInfo }) {
  const tone =
    aq.aqi <= 40 ? 'text-success-dark bg-success-light border-success/30'
    : aq.aqi <= 60 ? 'text-amber bg-amber/15 border-amber/30'
    : 'text-red-700 bg-red-50 border-red-200';
  return (
    <Card icon={<Wind size={15} className="text-navy" />} title="Air quality">
      <div className={`inline-flex items-center gap-2 rounded border px-2.5 py-1 text-sm font-black mb-2 ${tone}`}>
        AQI {aq.aqi} · {aq.band}
      </div>
      <div className="text-xs text-ink-mid space-y-0.5">
        {aq.pm25 != null && <div>PM2.5: {aq.pm25} µg/m&sup3;</div>}
        {aq.pm10 != null && <div>PM10: {aq.pm10} µg/m&sup3;</div>}
        {aq.no2 != null && <div>NO&#8322;: {aq.no2} µg/m&sup3;</div>}
      </div>
      <div className="text-[10px] text-ink-muted mt-1 italic">European AQI (Open-Meteo).</div>
    </Card>
  );
}

function ofstedTone(rating?: string): string {
  const r = (rating ?? '').toLowerCase();
  if (r.includes('outstanding')) return 'text-success-dark bg-success-light border-success/30';
  if (r.includes('good')) return 'text-navy bg-navy/[0.08] border-navy/20';
  if (r.includes('requires')) return 'text-amber bg-amber/15 border-amber/30';
  if (r.includes('inadequate')) return 'text-red-700 bg-red-50 border-red-200';
  return 'text-ink-mid bg-bg border-black/10';
}

export function SchoolsCard({ schools }: { schools: SchoolInfo[] }) {
  if (schools.length === 0) return null;
  return (
    <div className="bg-bg rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <GraduationCap size={15} className="text-navy" />
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">
          Schools & Ofsted ({schools.length} nearest)
        </div>
      </div>
      <div className="space-y-1.5">
        {schools.slice(0, 8).map((s, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2 text-xs">
            <div className="col-span-6 text-ink font-semibold truncate" title={s.name}>{s.name}</div>
            <div className="col-span-3 text-ink-muted truncate">{s.type}</div>
            <div className="col-span-2">
              {s.ofstedRating ? (
                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${ofstedTone(s.ofstedRating)}`}>
                  {s.ofstedRating}
                </span>
              ) : (
                <span className="text-[10px] text-ink-muted">No rating</span>
              )}
            </div>
            <div className="col-span-1 text-right text-ink-muted tabular-nums">{s.distanceMi}mi</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-ink-muted mt-2 italic">Source: DfE / Ofsted. Catchment areas vary by council.</div>
    </div>
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
  const residential = apps.filter((a) => a.residential);
  const totalUnits = residential.reduce((sum, a) => sum + (a.units ?? 0), 0);
  return (
    <div className="bg-bg rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileStack size={15} className="text-navy" />
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">
          Planning applications ({apps.length}, ~500m)
        </div>
      </div>
      {residential.length > 0 && (
        <div className="text-xs text-navy bg-navy/[0.04] border border-navy/15 rounded-lg px-3 py-2 mb-3">
          <strong>New-homes pipeline:</strong> {residential.length} residential scheme{residential.length === 1 ? '' : 's'} nearby
          {totalUnits > 0 ? <> · ~<strong>{totalUnits.toLocaleString('en-GB')} dwellings</strong> where stated</> : null}
        </div>
      )}
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
 * Deep-links for further/official checks the buyer may want to run themselves -
 * including the paid ones we deliberately don't pull (title register, broadband,
 * detailed flood). Pre-filled with the postcode where the service supports it.
 */
export function OfficialLinks({ postcode }: { postcode?: string }) {
  const pc = (postcode ?? '').trim();
  const enc = encodeURIComponent(pc);
  const links: { label: string; sub: string; href: string; paid?: boolean }[] = [
    { label: 'Title register & plan', sub: 'Registered owner, tenure, charges, covenants', href: 'https://search-property-information.landregistry.gov.uk/', paid: true },
    { label: 'Council tax band', sub: 'Confirm the VOA band', href: 'https://www.tax.service.gov.uk/check-council-tax-band/search' },
    { label: 'Detailed flood risk', sub: 'Rivers, sea, surface water + history', href: 'https://check-long-term-flood-risk.service.gov.uk/postcode' },
    { label: 'Energy certificate (EPC)', sub: 'Full certificate + recommendations', href: pc ? `https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${enc}` : 'https://find-energy-certificate.service.gov.uk/' },
    { label: 'Broadband & mobile', sub: 'Ofcom coverage checker', href: 'https://checker.ofcom.org.uk/en-gb/broadband-coverage' },
    { label: 'Ground stability & geology', sub: 'BGS Geology of Britain viewer', href: 'https://mapapps.bgs.ac.uk/geologyofbritain/home.html' },
    { label: 'Coal mining risk', sub: 'Coal Authority interactive map (mining areas)', href: 'https://mapapps2.bgs.ac.uk/coalauthority/home.html' },
    { label: 'Local crime detail', sub: 'Street-level on police.uk', href: 'https://www.police.uk/' },
    { label: 'Planning & local council', sub: "The property's planning authority", href: 'https://www.gov.uk/find-local-council' },
    { label: 'School admissions & catchments', sub: 'Council admissions (catchments vary)', href: 'https://www.gov.uk/schools-admissions' },
    { label: 'Vendor company check', sub: 'Companies House (if selling via a company)', href: 'https://find-and-update.company-information.service.gov.uk/' },
  ];
  return (
    <div className="bg-bg rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <ExternalLink size={15} className="text-navy" />
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Further checks & official sources</div>
      </div>
      <div className="text-xs text-ink-muted mb-3">
        Free data is pulled above. These open the official services for deeper or paid checks{pc ? ` for ${pc}` : ''}.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-start justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-black/[0.06] hover:border-navy/30 transition group"
          >
            <div>
              <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                {l.label}
                {l.paid && <span className="text-[9px] font-bold text-amber bg-amber/15 px-1 py-0.5 rounded uppercase">Paid</span>}
              </div>
              <div className="text-[10px] text-ink-muted">{l.sub}</div>
            </div>
            <ExternalLink size={12} className="text-ink-muted group-hover:text-navy mt-0.5 flex-shrink-0" />
          </a>
        ))}
      </div>
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
      <OfficialLinks postcode={data.postcode} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.flood && <FloodCard flood={data.flood} />}
        {data.riverLevels && <RiverLevelsCard rivers={data.riverLevels} />}
        {data.landOwnership && <LandOwnershipCard owned={data.landOwnership} />}
        {data.epc && <EpcCard epc={data.epc} />}
        {data.hpi && <HpiCard hpi={data.hpi} />}
        {data.areaStats && <AreaStatsCard stats={data.areaStats} />}
        {data.airQuality && <AirQualityCard aq={data.airQuality} />}
        {data.demographics && <DemographicsCard d={data.demographics} />}
        {data.planning && <PlanningCard planning={data.planning} />}
      </div>
      {data.schools && <SchoolsCard schools={data.schools} />}
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
