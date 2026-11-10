'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Amenity } from '@/lib/deal-store';
import type { GeoCollection } from '@/server/public-data/geojson';
import { getCrimeHeat, getDeprivation } from '@/server/actions/map-data';
import { amenityPins, EMPTY_GEOJSON, MAP_RADII, mapDate, searchArea, searchRing, type MapRadius } from '@/lib/dd-map';

type Layer = 'amenities' | 'crime' | 'deprivation';
type Result = { key: string; state: 'loading' | 'ready' | 'unavailable'; data: GeoCollection };
type Selection = { title: string; detail: string };
const LAYERS: { id: Layer; label: string }[] = [
  { id: 'amenities', label: 'Saved amenities' }, { id: 'crime', label: 'Reported crime' }, { id: 'deprivation', label: 'Deprivation · 2019' },
];
const OS_STYLE: StyleSpecification = {
  version: 8,
  sources: { os: { type: 'raster', tiles: ['/api/map/os/{z}/{x}/{y}'], tileSize: 256,
    attribution: '© Crown copyright and database rights Ordnance Survey' } },
  layers: [{ id: 'base', type: 'raster', source: 'os' }],
};
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
    maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' } },
  layers: [{ id: 'base', type: 'raster', source: 'osm' }],
};
const toMapData = (data: GeoCollection) => data as Parameters<GeoJSONSource['setData']>[0];

export function RiskMap({ lat, lng, amenities, fetchedAt }: {
  lat: number; lng: number; amenities: Amenity[]; fetchedAt?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [layer, setLayer] = useState<Layer>('amenities');
  const [radiusKm, setRadiusKm] = useState<MapRadius>(1);
  const [base, setBase] = useState<'os' | 'osm'>('os');
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [retry, setRetry] = useState(0);
  const [mapRetry, setMapRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const pins = useMemo(() => amenityPins(amenities, lat, lng, radiusKm), [amenities, lat, lng, radiusKm]);
  const requestKey = `${lat}:${lng}:${radiusKm}:${layer}:${retry}`;
  // An old response is never rendered for a new location, layer or radius.
  const current = result?.key === requestKey ? result : null;
  const data = layer === 'amenities' ? pins : current?.data ?? EMPTY_GEOJSON;
  const state = layer === 'amenities' ? 'ready' : current?.state ?? 'loading';

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | undefined;
    setReady(false);
    setMapError('');
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !containerRef.current) return;
        // v6 ships a separate worker. Let Next emit a same-origin hashed asset.
        ml.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
        map = new ml.Map({ container: containerRef.current, style: base === 'os' ? OS_STYLE : OSM_STYLE,
          center: [lng, lat], zoom: 13, cooperativeGestures: true, attributionControl: { compact: false } });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(new ml.ScaleControl({ unit: 'metric' }), 'bottom-left');
        const centre = document.createElement('button');
        centre.type = 'button';
        centre.className = 'w-8 h-8 rounded-full bg-navy border-4 border-white shadow text-white';
        centre.setAttribute('aria-label', 'Postcode centre — approximate location');
        centre.textContent = '+';
        centre.addEventListener('click', () => setSelection({ title: 'Postcode centre',
          detail: 'Approximate search origin from postcodes.io. Confirm the exact building and title plan separately.' }));
        new ml.Marker({ element: centre }).setLngLat([lng, lat]).addTo(map);
        map.on('error', () => { if (!cancelled) setMapError('Some map tiles or layers could not load. Evidence below remains available.'); });
        map.on('load', () => {
          if (cancelled || !map) return;
          map.addSource('search', { type: 'geojson', data: toMapData(EMPTY_GEOJSON) });
          map.addLayer({ id: 'search-fill', type: 'fill', source: 'search', paint: { 'fill-color': '#0d2a5e', 'fill-opacity': 0.03 } });
          map.addLayer({ id: 'search-line', type: 'line', source: 'search', paint: { 'line-color': '#0d2a5e', 'line-width': 2, 'line-dasharray': [3, 2] } });
          map.addSource('evidence', { type: 'geojson', data: toMapData(EMPTY_GEOJSON) });
          map.addLayer({ id: 'area-fill', type: 'fill', source: 'evidence', filter: ['==', '$type', 'Polygon'],
            paint: { 'fill-color': ['step', ['to-number', ['get', 'IMDDecil'], 0], '#9ca3af', 1, '#6b4c9a', 4, '#b3a1cd', 8, '#e4daee'], 'fill-opacity': 0.5 } });
          map.addLayer({ id: 'area-line', type: 'line', source: 'evidence', filter: ['==', '$type', 'Polygon'], paint: { 'line-color': '#6b4c9a', 'line-width': 1 } });
          map.addLayer({ id: 'evidence-points', type: 'circle', source: 'evidence', filter: ['==', '$type', 'Point'], paint: {
            'circle-radius': 6, 'circle-color': ['match', ['get', 'category'], 'groceries', '#2b6c50', 'transport', '#2563a0', 'healthcare', '#b45309', 'education', '#7048a5', '#086f7f'],
            'circle-opacity': 0.8, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
          } });
          for (const id of ['area-fill', 'evidence-points']) {
            map.on('mouseenter', id, () => { if (map) map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, () => { if (map) map.getCanvas().style.cursor = ''; });
            map.on('click', id, (event) => {
              const p = event.features?.[0]?.properties;
              if (!p) return;
              if (id === 'area-fill') {
                const decile = Number(p.IMDDecil);
                setSelection({ title: String(p.lsoa11nm ?? 'Statistical area'), detail: `IMD 2019 · ${decile >= 1 && decile <= 10 ? `decile ${decile} of 10 (1 most deprived)` : 'decile unavailable'}. Area-level context; not a property rating.` });
              } else {
                setSelection({ title: String(p.name ?? p.category ?? 'Reported incident'),
                  detail: p.detail ? String(p.detail) : `${p.month ?? 'Month not recorded'} · anonymised Police location, not an exact incident address.` });
              }
            });
          }
          setReady(true);
        });
      } catch {
        if (!cancelled) setMapError('The interactive map could not start in this browser. You can still read the evidence below.');
      }
    })();
    return () => { cancelled = true; map?.remove(); mapRef.current = null; };
  }, [lat, lng, base, mapRetry]);

  useEffect(() => {
    if (layer === 'amenities') return;
    let cancelled = false;
    setResult({ key: requestKey, state: 'loading', data: EMPTY_GEOJSON });
    (async () => {
      try {
        const response = await (layer === 'crime' ? getCrimeHeat(lat, lng, radiusKm) : getDeprivation(lat, lng, radiusKm));
        if (!cancelled) setResult({ key: requestKey, state: response ? 'ready' : 'unavailable', data: response ?? EMPTY_GEOJSON });
      } catch {
        if (!cancelled) setResult({ key: requestKey, state: 'unavailable', data: EMPTY_GEOJSON });
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng, radiusKm, layer, requestKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('evidence') as GeoJSONSource).setData(toMapData(data));
  }, [ready, data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('search') as GeoJSONSource).setData(toMapData(searchArea(lat, lng, radiusKm)));
    const ring = searchRing(lat, lng, radiusKm);
    map.fitBounds([[Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1]))],
      [Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]], { padding: 35, duration: 0 });
  }, [ready, lat, lng, radiusKm]);

  const chooseLayer = (next: Layer) => { setLayer(next); setSelection(null); };
  const selectEvidence = (index: number) => {
    const f = data.features[index];
    const p = f.properties;
    setSelection({ title: String(p.name ?? p.category ?? p.lsoa11nm ?? 'Evidence'),
      detail: String(p.detail ?? (layer === 'crime' ? `${data.period ?? 'Month not recorded'} · anonymised location.` : `IMD 2019 · decile ${p.IMDDecil ?? 'unavailable'} of 10 (1 most deprived). Area-level context.`)) });
    if (f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      mapRef.current?.easeTo({ center: f.geometry.coordinates as [number, number], zoom: 15, duration: 0 });
    }
  };

  return <div className="rounded-lg border border-black/10 overflow-hidden bg-white">
    <div className="p-3 flex flex-wrap gap-2 border-b border-black/10" role="group" aria-label="Map evidence layers">
      {LAYERS.map((item) => <button type="button" key={item.id} aria-pressed={layer === item.id}
        onClick={() => chooseLayer(item.id)} className={`min-h-11 px-3 rounded-lg text-xs font-bold ${layer === item.id ? 'bg-navy text-white' : 'bg-bg text-ink'}`}>{item.label}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 p-3 text-xs">
      <label htmlFor="dd-map-radius" className="font-bold">Search radius</label>
      <select id="dd-map-radius" value={radiusKm} onChange={(e) => { setRadiusKm(Number(e.target.value) as MapRadius); setSelection(null); }} className="min-h-11 border rounded-lg px-3 bg-white">
        {MAP_RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
      </select>
      <span>Dashed circle = search area around the postcode centre</span>
      <button type="button" className="min-h-11 px-3 underline ml-auto" onClick={() => { setSelection(null); setMapRetry((n) => n + 1); }}>Reset view</button>
    </div>
    {mapError && <div role="alert" className="bg-amber/10 px-4 py-3 text-sm">
      <p>{mapError}</p>
      <button type="button" onClick={() => setMapRetry((n) => n + 1)} className="underline min-h-11 mr-4">Retry map</button>
      {base === 'os' && <button type="button" onClick={() => setBase('osm')} className="underline min-h-11">Use OpenStreetMap base map</button>}
    </div>}
    <div ref={containerRef} role="region" aria-label="Interactive local due diligence map" className="w-full bg-bg" style={{ height: 400 }} />
    <div className="p-4 space-y-3 border-t border-black/10">
      <div role="status" aria-live="polite" className="text-sm font-bold text-ink">
        {state === 'loading' ? 'Loading selected evidence…' : state === 'unavailable' ? 'This evidence source is unavailable.' : `${data.features.length} ${layer === 'deprivation' ? 'statistical areas returned' : layer === 'crime' ? 'reported incidents returned' : 'saved amenity pins in this radius'}`}
      </div>
      {state === 'unavailable' && <p className="text-xs text-ink-mid">No conclusion can be drawn from this missing layer. Try a smaller radius or retry.
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline font-bold ml-2 min-h-11">Retry evidence</button></p>}
      {layer === 'amenities' && <p className="text-xs text-ink-mid">Saved deal amenities · last public pull: {mapDate(fetchedAt)}. Only entries with coordinates are mapped. The public pull searches within 3 km and keeps a selection per category; enlarging this map does not fetch more amenities.</p>}
      {layer === 'crime' && <p className="text-xs text-ink-mid"><a href="https://data.police.uk/docs/method/crime-street/" target="_blank" rel="noreferrer" className="underline">Police street-level data</a> · month: {data.period ?? 'not available'} · retrieved: {mapDate(data.retrievedAt)}. Anonymised locations, not exact incident addresses. Dots can overlap; this is not a crime rate or a safety verdict. Scotland coverage is limited to British Transport Police.</p>}
      {layer === 'deprivation' && <p className="text-xs text-ink-mid"><a href="https://www.gov.uk/government/statistics/english-indices-of-deprivation-2019" target="_blank" rel="noreferrer" className="underline">English IMD 2019</a> · retrieved: {mapDate(data.retrievedAt)}. Historical area context, not a current property assessment. Darker purple = more deprived. Whole statistical areas intersecting the surrounding search box are shown and can extend beyond the circle. Missing deciles are grey.</p>}
      {state === 'ready' && data.features.length === 0 && <p className="text-xs text-ink-mid">No mapped records returned. This does not establish that there are no local issues.{layer === 'amenities' ? ' Pull live data in Auto-Pull to add local evidence.' : ''}</p>}
      {selection && <div className="bg-bg rounded-lg p-3 text-sm" role="status"><strong>{selection.title}</strong><p className="mt-1 text-ink-mid">{selection.detail}</p></div>}
      {data.features.length > 0 && <details><summary className="cursor-pointer text-sm font-bold min-h-11 py-3">Browse evidence without the map ({Math.min(50, data.features.length)} shown)</summary>
        <div className="max-h-56 overflow-auto space-y-1">{data.features.slice(0, 50).map((f, index) => <button type="button" key={index} onClick={() => selectEvidence(index)} className="block w-full text-left min-h-11 px-3 py-2 bg-bg rounded text-xs hover:bg-navy/10">
          {String(f.properties.name ?? f.properties.category ?? f.properties.lsoa11nm ?? 'Evidence')} {layer === 'deprivation' ? `· decile ${f.properties.IMDDecil ?? 'unknown'}` : ''}
        </button>)}</div>
      </details>}
    </div>
  </div>;
}
