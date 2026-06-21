/**
 * Server-only OpenStreetMap Overpass + OSRM amenities integration (M2-T4).
 *
 * One Overpass union query pulls candidate amenities across 8 categories within
 * 3km. We classify each by its tags, take the nearest few per category by
 * straight-line distance, then ask OSRM for real walking/driving times. An
 * amenity is kept as a 5-min walk (<=360s on foot) or, failing that, a 5-min
 * drive (<=360s driving), matching BUILD §M2-T4. Everything else is dropped.
 *
 * Cached 7 days per (lat, lng, radius). Fully fail-soft — Overpass or OSRM
 * being down yields an empty list, never an error.
 */

import type { Amenity, AmenityCategory } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OSRM_BASE = 'https://router.project-osrm.org/route/v1';
const RADIUS_M = 3000;
const WALK_MAX_S = 360; // 5-min walk (+ a little)
const DRIVE_MAX_S = 360; // 5-min drive
const NEAREST_PER_CATEGORY = 3; // candidates routed per category before filtering
const KEEP_PER_CATEGORY = 3;    // amenities kept per category after routing

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
type OverpassResponse = { elements: OverpassElement[] };
type OsrmResponse = { code: string; routes: { duration: number; distance: number }[] };

function overpassQuery(lat: number, lng: number): string {
  const a = `(around:${RADIUS_M},${lat},${lng})`;
  return `[out:json][timeout:25];
(
  nwr["shop"~"^(supermarket|convenience)$"]${a};
  nwr["railway"="station"]${a};
  nwr["station"="subway"]${a};
  nwr["highway"="bus_stop"]${a};
  nwr["amenity"~"^(hospital|clinic|doctors|pharmacy)$"]${a};
  nwr["amenity"~"^(school|college|university|kindergarten)$"]${a};
  nwr["leisure"~"^(park|sports_centre|fitness_centre|stadium)$"]${a};
  nwr["amenity"~"^(restaurant|pub|cafe|fast_food|bar)$"]${a};
  nwr["tourism"~"^(attraction|museum|gallery|theme_park|zoo|viewpoint)$"]${a};
  nwr["office"]${a};
);
out center 400;`;
}

/** Map an element's tags to a single category (first match wins). */
function classify(tags: Record<string, string>): AmenityCategory | null {
  const { shop, railway, station, highway, public_transport, amenity, leisure, tourism, office } = tags;
  if (shop && /^(supermarket|convenience)$/.test(shop)) return 'groceries';
  if (railway === 'station' || station === 'subway' || highway === 'bus_stop' || public_transport === 'station')
    return 'transport';
  if (amenity && /^(hospital|clinic|doctors|pharmacy)$/.test(amenity)) return 'healthcare';
  if (amenity && /^(school|college|university|kindergarten)$/.test(amenity)) return 'education';
  if (leisure && /^(park|sports_centre|fitness_centre|stadium)$/.test(leisure)) return 'recreation';
  if (amenity && /^(restaurant|pub|cafe|fast_food|bar)$/.test(amenity)) return 'dining';
  if (tourism) return 'tourism';
  if (office) return 'employment';
  return null;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function osrmDuration(
  profile: 'foot' | 'driving',
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): Promise<{ duration: number; distance: number } | null> {
  return failSoft(`osrm-${profile}`, async () => {
    const url = `${OSRM_BASE}/${profile}/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const data = await fetchJson<OsrmResponse>(url);
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route) throw new Error(`OSRM ${profile} no route`);
    return { duration: route.duration, distance: route.distance };
  });
}

function milesText(meters: number): string {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

type Candidate = { category: AmenityCategory; name: string; lat: number; lng: number; straightM: number };

export async function fetchAmenities(
  _postcode: string,
  lat: number,
  lng: number,
): Promise<Amenity[] | null> {
  const key = `amenities:${lat.toFixed(4)},${lng.toFixed(4)}:${RADIUS_M}`;
  return cached(key, 'amenities', TTL.week, () =>
    failSoft('amenities', async () => {
      const data = await fetchJson<OverpassResponse>(OVERPASS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery(lat, lng))}`,
        timeoutMs: 30_000,
      });

      // Build candidates: named, classifiable, with coords.
      const byCategory = new Map<AmenityCategory, Candidate[]>();
      for (const el of data.elements ?? []) {
        const tags = el.tags ?? {};
        const name = tags.name;
        if (!name) continue;
        const category = classify(tags);
        if (!category) continue;
        const pLat = el.lat ?? el.center?.lat;
        const pLng = el.lon ?? el.center?.lon;
        if (pLat == null || pLng == null) continue;
        const straightM = haversineM(lat, lng, pLat, pLng);
        const list = byCategory.get(category) ?? [];
        list.push({ category, name, lat: pLat, lng: pLng, straightM });
        byCategory.set(category, list);
      }

      // Route the nearest few per category through OSRM, classify mode, keep.
      const out: Amenity[] = [];
      for (const [category, list] of byCategory) {
        const nearest = list.sort((a, b) => a.straightM - b.straightM).slice(0, NEAREST_PER_CATEGORY);
        const kept: { amenity: Amenity; minutes: number }[] = [];
        for (const c of nearest) {
          // Try walking first when plausibly close, else driving.
          let mode: 'walk' | 'drive' | null = null;
          let seconds = 0;
          let meters = c.straightM;
          if (c.straightM <= 700) {
            const foot = await osrmDuration('foot', lat, lng, c.lat, c.lng);
            if (foot && foot.duration <= WALK_MAX_S) {
              mode = 'walk';
              seconds = foot.duration;
              meters = foot.distance;
            }
          }
          if (!mode) {
            const drive = await osrmDuration('driving', lat, lng, c.lat, c.lng);
            if (drive && drive.duration <= DRIVE_MAX_S) {
              mode = 'drive';
              seconds = drive.duration;
              meters = drive.distance;
            }
          }
          if (!mode) continue;
          kept.push({
            minutes: Math.max(1, Math.round(seconds / 60)),
            amenity: {
              id: `a-${c.category}-${Math.round(c.lat * 1e4)}-${Math.round(c.lng * 1e4)}`,
              category,
              name: c.name,
              distanceText: milesText(meters),
              travelMinutes: Math.max(1, Math.round(seconds / 60)),
              mode,
              lat: c.lat,
              lng: c.lng,
            },
          });
        }
        kept.sort((a, b) => a.minutes - b.minutes);
        out.push(...kept.slice(0, KEEP_PER_CATEGORY).map((k) => k.amenity));
      }

      return out;
    }),
  );
}
