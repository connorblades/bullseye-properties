'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { Deal, PublicDataSourceKey } from '@/lib/deal-store';
import { mapDate, validMapCentre } from '@/lib/dd-map';
import { getMapLocation } from '@/server/actions/map-data';

const RiskMap = dynamic(() => import('./risk-map').then((m) => m.RiskMap), {
  ssr: false, loading: () => <p className="p-6 text-sm" role="status">Loading interactive map…</p>,
});
const EMPTY_AMENITIES: Deal['location']['amenities'] = [];
const CONTEXT: { key: PublicDataSourceKey; label: string }[] = [
  { key: 'flood', label: 'Flood' }, { key: 'planning', label: 'Planning' },
  { key: 'epc', label: 'EPC' }, { key: 'boundary', label: 'Title boundary' },
];
const STATUS = { ok: 'Data returned · review needed', fallback: 'Partial data · review needed',
  unavailable: 'Unavailable', pending: 'Not yet returned' };
const compactPostcode = (value: string) => value.replace(/\s/g, '').toUpperCase();

export function DueDiligenceMap({ deal }: { deal: Deal }) {
  // A postcode edit must discard any map state for the previous search origin.
  return <LocalMap key={`${deal.id}:${deal.postcode}`} deal={deal} />;
}

function LocalMap({ deal }: { deal: Deal }) {
  const candidate = deal.publicData;
  const pd = candidate && compactPostcode(candidate.postcode) === compactPostcode(deal.postcode ?? '') ? candidate : undefined;
  const savedCentre = pd?.lat != null && pd?.lng != null && validMapCentre(pd.lat, pd.lng) ? { lat: pd.lat, lng: pd.lng } : null;
  const [located, setLocated] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const centre = savedCentre ?? located;
  async function locate() {
    setLoading(true);
    setError('');
    try {
      const result = await getMapLocation(deal.postcode ?? '');
      if (result && validMapCentre(result.lat, result.lng)) setLocated({ lat: result.lat, lng: result.lng });
      else setError('We could not locate this postcode. Check the postcode recorded on this deal, then retry.');
    } catch {
      setError('The postcode lookup did not complete. Check your connection and retry.');
    } finally { setLoading(false); }
  }

  return <section className="card p-4 sm:p-6 space-y-4" aria-label="Local due diligence">
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-navy mb-2">Local due diligence</div>
      <h2 className="text-xl font-black text-ink">Explore the evidence around this address</h2>
      <p className="text-sm text-ink-mid mt-2 break-words">{deal.address} {deal.postcode && `· ${deal.postcode}`}</p>
      <p className="text-xs text-ink-mid mt-2">Map origin: postcode centre from postcodes.io. The exact building and title boundary have not been confirmed by this map. Opening a layer does not mark a check as reviewed.</p>
    </div>
    {centre ? <RiskMap key={`${centre.lat}:${centre.lng}`} lat={centre.lat} lng={centre.lng}
      amenities={pd ? deal.location.amenities : EMPTY_AMENITIES} fetchedAt={pd?.fetchedAt} /> : <div className="bg-bg p-4 rounded-lg space-y-2">
      <p className="text-sm">Open the local map to inspect surrounding evidence. A full public-data pull is separate.</p>
      {!deal.postcode && <p className="text-sm">A UK postcode must be recorded on this deal first.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" disabled={loading || !deal.postcode} className="btn-secondary min-h-11" onClick={locate}>
        {loading ? 'Locating postcode…' : error ? 'Retry postcode lookup' : 'Open local map'}
      </button>
    </div>}
    <div>
      <h3 className="text-sm font-bold mb-2">Other checks for this address</h3>
      <p className="text-xs text-ink-mid mb-3">These statuses describe the last public-data pull ({mapDate(pd?.fetchedAt)}). They are not map overlays or completed property checks. Review the source results and supporting documents separately.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CONTEXT.map(({ key, label }) => <div key={key} className="rounded-lg bg-bg p-3 text-xs">
          <strong>{label}</strong><p className="mt-1">{pd?.status[key] ? STATUS[pd.status[key]] : 'Not pulled'}</p>
        </div>)}
      </div>
    </div>
  </section>;
}
