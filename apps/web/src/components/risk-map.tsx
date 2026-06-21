'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Loader2, Flame, Users, MapPin } from 'lucide-react';
import { getCrimeHeat, getDeprivation } from '@/server/actions/map-data';

type Layer = 'property' | 'crime' | 'deprivation';

const RADII = [1, 5, 15] as const;

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    os: {
      type: 'raster',
      // proxied through our server so OS_API_KEY never reaches the browser
      tiles: ['/api/map/os/{z}/{x}/{y}'],
      tileSize: 256,
      attribution: '© Crown copyright and database rights Ordnance Survey',
    },
  },
  layers: [{ id: 'os-base', type: 'raster', source: 'os' }],
};

export function RiskMap({ lat, lng }: { lat: number; lng: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [layer, setLayer] = useState<Layer>('property');
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [ready, setReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [present, setPresent] = useState<{ crime: boolean; deprivation: boolean }>({
    crime: false,
    deprivation: false,
  });

  // Initialise the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | undefined;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASE_STYLE,
        center: [lng, lat],
        zoom: 13,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      new maplibregl.Marker({ color: '#0d2a5e' }).setLngLat([lng, lat]).addTo(map);
      map.on('load', () => {
        if (!cancelled) setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      if (map) map.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  // (Re)load the data layers whenever the radius changes; fit the view to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;
    setLoadingData(true);

    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    map.fitBounds(
      [[lng - dLng, lat - dLat], [lng + dLng, lat + dLat]],
      { padding: 24, duration: 500 },
    );

    (async () => {
      const [crime, deprivation] = await Promise.all([
        getCrimeHeat(lat, lng, radiusKm),
        getDeprivation(lat, lng, radiusKm),
      ]);
      if (cancelled || !mapRef.current) return;

      const depVis = layer === 'deprivation' ? 'visible' : 'none';
      const crimeVis = layer === 'crime' ? 'visible' : 'none';

      if (deprivation && deprivation.features.length > 0) {
        const src = map.getSource('imd') as GeoJSONSource | undefined;
        if (src) src.setData(deprivation as never);
        else {
          map.addSource('imd', { type: 'geojson', data: deprivation as never });
          map.addLayer({
            id: 'imd-fill', type: 'fill', source: 'imd', layout: { visibility: depVis },
            paint: {
              'fill-color': ['step', ['get', 'IMDDecil'], '#d0021b', 4, '#f5a623', 8, '#2e7d32'],
              'fill-opacity': 0.4,
            },
          });
          map.addLayer({
            id: 'imd-line', type: 'line', source: 'imd', layout: { visibility: depVis },
            paint: { 'line-color': '#5b6573', 'line-width': 0.5 },
          });
        }
      }

      if (crime && crime.features.length > 0) {
        const src = map.getSource('crime') as GeoJSONSource | undefined;
        if (src) src.setData(crime as never);
        else {
          map.addSource('crime', { type: 'geojson', data: crime as never });
          map.addLayer({
            id: 'crime-heat', type: 'heatmap', source: 'crime', layout: { visibility: crimeVis },
            paint: {
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 12, 9, 14, 18, 16, 32],
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 0.9, 16, 1.4],
              'heatmap-opacity': 0.7,
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,0,0)',
                0.2, '#2e7d32',
                0.45, '#f5a623',
                0.7, '#e8590c',
                1, '#d0021b',
              ],
            },
          });
        }
      }

      if (!cancelled) {
        setPresent({
          crime: Boolean(crime && crime.features.length),
          deprivation: Boolean(deprivation && deprivation.features.length),
        });
        setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lat, lng, radiusKm]);

  // Toggle layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const set = (id: string, vis: 'visible' | 'none') => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    };
    set('crime-heat', layer === 'crime' ? 'visible' : 'none');
    set('imd-fill', layer === 'deprivation' ? 'visible' : 'none');
    set('imd-line', layer === 'deprivation' ? 'visible' : 'none');
  }, [layer, ready, present]);

  const tabs: { key: Layer; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { key: 'property', label: 'Property', icon: <MapPin size={13} /> },
    { key: 'crime', label: 'Crime heat', icon: <Flame size={13} />, disabled: ready && !loadingData && !present.crime },
    { key: 'deprivation', label: 'Deprivation', icon: <Users size={13} />, disabled: ready && !loadingData && !present.deprivation },
  ];

  return (
    <div className="bg-bg rounded-lg overflow-hidden">
      <div className="flex items-center gap-1 p-2 border-b border-black/[0.06] flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setLayer(t.key)}
            disabled={t.disabled}
            className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded transition disabled:opacity-30 ${
              layer === t.key ? 'bg-navy text-white' : 'text-ink-mid hover:text-navy'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}

        {/* Radius selector */}
        <div className="flex items-center gap-1 ml-2 bg-white rounded-lg p-0.5 border border-black/[0.06]">
          {RADII.map((r) => (
            <button
              key={r}
              onClick={() => setRadiusKm(r)}
              className={`text-xs font-bold px-2.5 py-1 rounded transition ${
                radiusKm === r ? 'bg-navy text-white' : 'text-ink-mid hover:text-navy'
              }`}
            >
              {r}km
            </button>
          ))}
        </div>

        {loadingData && <Loader2 size={14} className="animate-spin text-ink-muted ml-1" />}
        <div className="ml-auto flex items-center gap-2 pr-1">
          {layer === 'crime' && <Legend items={[['Low', '#2e7d32'], ['Med', '#f5a623'], ['High', '#d0021b']]} />}
          {layer === 'deprivation' && <Legend items={[['Most deprived', '#d0021b'], ['Mid', '#f5a623'], ['Least', '#2e7d32']]} />}
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 360 }} />
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex items-center gap-2">
      {items.map(([label, colour]) => (
        <span key={label} className="flex items-center gap-1 text-[10px] text-ink-mid">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colour }} /> {label}
        </span>
      ))}
    </div>
  );
}
