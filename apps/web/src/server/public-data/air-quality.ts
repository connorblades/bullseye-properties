/**
 * Server-only air-quality integration (supporting info).
 *
 * Open-Meteo air-quality API (free, no key) gives the current European AQI and
 * key pollutants for the point. Cached 24h. Fail-soft.
 */

import type { AirQualityInfo } from '@/lib/deal-store';
import { cached, TTL } from './cache';
import { fetchJson, failSoft } from './http';

const URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

type OMResp = {
  current?: {
    european_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    nitrogen_dioxide?: number;
  };
};

// European AQI bands.
function aqiBand(aqi: number): string {
  if (aqi <= 20) return 'Good';
  if (aqi <= 40) return 'Fair';
  if (aqi <= 60) return 'Moderate';
  if (aqi <= 80) return 'Poor';
  if (aqi <= 100) return 'Very poor';
  return 'Extremely poor';
}

export async function fetchAirQuality(lat: number, lng: number): Promise<AirQualityInfo | null> {
  const key = `airQuality:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, 'airQuality', TTL.day, () =>
    failSoft('air-quality', async () => {
      const url = `${URL}?latitude=${lat}&longitude=${lng}&current=european_aqi,pm2_5,pm10,nitrogen_dioxide`;
      const data = await fetchJson<OMResp>(url);
      const c = data.current;
      if (!c || typeof c.european_aqi !== 'number') throw new Error('no air-quality data');
      return {
        aqi: Math.round(c.european_aqi),
        band: aqiBand(c.european_aqi),
        pm25: c.pm2_5,
        pm10: c.pm10,
        no2: c.nitrogen_dioxide,
      } satisfies AirQualityInfo;
    }),
  );
}
