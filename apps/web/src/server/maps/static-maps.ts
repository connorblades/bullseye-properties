/**
 * Server-only Mapbox Static Images URL builders (M2-T5).
 *
 * Three deterministic map URLs per deal, embedded directly in the report:
 *   - amenities : streets style, property pin + category-coloured amenity pins
 *   - flood     : satellite (aerial) style, property pin; band shown in caption
 *   - crime     : streets style, property pin + a translucent ~1-mile catchment
 *                 circle tinted by 12-month crime volume
 *
 * Requires MAPBOX_PUBLIC_TOKEN; without it every builder returns undefined and
 * the maps report "unavailable" (fail-soft). The URLs are deterministic, so the
 * 30-day map cache is effectively the report version itself - re-rendering the
 * same deal reuses the same URLs. (Byte-caching into the partner-assets bucket
 * to spare the 50k/mo render quota is a documented follow-up; a single-partner
 * load is far under quota.)
 *
 * EA flood-tile compositing isn't supported by the static API (it overlays only
 * markers/paths/geojson, not external WMS), so the flood layer is aerial + pin;
 * the band travels as text. Likewise a true per-incident heatmap needs a custom
 * style + tilequery; the crime layer approximates with a volume-tinted circle.
 */

import type { Amenity, MapLayers, AmenityCategory } from '@/lib/deal-store';

const BASE = 'https://api.mapbox.com/styles/v1/mapbox';
const SIZE = '640x420@2x';

// Category pin colours (hex without '#') matching the wizard's category tones.
const PIN_COLOUR: Record<AmenityCategory, string> = {
  groceries: 'f5a623',
  transport: '1f5199',
  healthcare: 'd0021b',
  education: '7b3fbf',
  recreation: '2e7d32',
  tourism: 'd81b8c',
  dining: 'e8590c',
  employment: '64748b',
};

const PROPERTY_PIN_COLOUR = '0d2a5e';

function token(): string | undefined {
  return process.env.MAPBOX_PUBLIC_TOKEN || undefined;
}

function propertyPin(lat: number, lng: number): string {
  return `pin-l-home+${PROPERTY_PIN_COLOUR}(${lng},${lat})`;
}

/** A closed circle path (GeoJSON-free, encoded polyline-free) via many pins is
 * ugly; instead we draw an approximate circle with the `path` overlay using a
 * ring of points around the centre. */
function circlePath(lat: number, lng: number, radiusM: number, stroke: string, fill: string): string {
  const pts: string[] = [];
  const steps = 32;
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    pts.push(`${(lng + dLng * Math.cos(a)).toFixed(5)},${(lat + dLat * Math.sin(a)).toFixed(5)}`);
  }
  // path-{width}+{stroke}-{opacity}+{fill}-{fillOpacity}(geojson-ish coord list)
  return `path-2+${stroke}-0.8+${fill}-0.25(${pts.join(';')})`;
}

function url(style: string, overlays: string[], lat: number, lng: number, zoom: number, t: string): string {
  const overlay = overlays.filter(Boolean).join(',');
  const path = overlay ? `${overlay}/` : '';
  return `${BASE}/${style}/static/${path}${lng},${lat},${zoom}/${SIZE}?access_token=${t}`;
}

export type MapInputs = {
  lat: number;
  lng: number;
  amenities: Amenity[];
  crimeTotal: number;
};

export function buildMapLayers(input: MapInputs): MapLayers | undefined {
  const t = token();
  if (!t) return undefined;
  const { lat, lng, amenities, crimeTotal } = input;

  // Amenities: property pin + up to 18 category pins (URL length budget).
  const amenityPins = amenities
    .filter((a) => a.lat != null && a.lng != null)
    .slice(0, 18)
    .map((a) => `pin-s+${PIN_COLOUR[a.category]}(${a.lng},${a.lat})`);
  const amenitiesUrl = url('streets-v12', [...amenityPins, propertyPin(lat, lng)], lat, lng, 13, t);

  // Crime: streets + ~1-mile catchment circle tinted by volume + property pin.
  // (A true red/amber/green heat map is rendered client-side from crime points.)
  const intensity = crimeTotal > 1500 ? 'd0021b' : crimeTotal > 600 ? 'e8590c' : 'f5a623';
  const crimeUrl = url(
    'streets-v12',
    [circlePath(lat, lng, 1609, intensity, intensity), propertyPin(lat, lng)],
    lat,
    lng,
    13,
    t,
  );

  return { amenities: amenitiesUrl, crime: crimeUrl };
}

// EA Flood Map for Planning (Rivers and Sea) flood-zone WMS. No token needed.
const EA_FLOOD_WMS =
  'https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones/wms';

/** Square-in-degrees bbox + matching base/overlay sizes, ~radiusDeg each side. */
function bboxBaseOverlay(
  lat: number,
  lng: number,
  radiusDeg: number,
  wmsBase: string,
  wmsLayer: string,
): { base?: string; overlay: string } {
  const minLat = (lat - radiusDeg).toFixed(6);
  const maxLat = (lat + radiusDeg).toFixed(6);
  const minLng = (lng - radiusDeg).toFixed(6);
  const maxLng = (lng + radiusDeg).toFixed(6);
  const px = 600;
  const overlay =
    `${wmsBase}?service=WMS&version=1.3.0&request=GetMap` +
    `&layers=${wmsLayer}&styles=&crs=EPSG:4326` +
    `&bbox=${minLat},${minLng},${maxLat},${maxLng}` +
    `&width=${px}&height=${px}&format=image/png&transparent=true`;
  const t = token();
  const base = t
    ? `${BASE}/satellite-v9/static/${propertyPin(lat, lng)}/[${minLng},${minLat},${maxLng},${maxLat}]/${px}x${px}?access_token=${t}`
    : undefined;
  return { overlay, ...(base ? { base } : {}) };
}

/** Flood map: aerial base + EA flood-zone polygons shaded for the risk area. */
export function buildFloodMap(lat: number, lng: number): Partial<MapLayers> {
  const { base, overlay } = bboxBaseOverlay(lat, lng, 0.005, EA_FLOOD_WMS, 'Flood_Zones_2_3_Rivers_and_Sea');
  return { floodOverlay: overlay, ...(base ? { floodBase: base } : {}) };
}

// HMLR INSPIRE title-boundary map was removed: its WMS rendering dumped parcel
// labels and wasn't controllable. The legal title is paid HMLR data - the UI
// links out to buy it instead (see TitleRegisterLink). Property context is the
// OS map.
