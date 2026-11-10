import { beforeEach, describe, expect, it, vi } from 'vitest';
import { amenityPins, assertMapRequest, distanceKm, mapDate, searchRing } from '@/lib/dd-map';
import type { Amenity } from '@/lib/deal-store';

const fakes = vi.hoisted(() => ({ auth: vi.fn(), geocode: vi.fn(), json: vi.fn() }));
vi.mock('@/server/auth/tenant', () => ({ requireTenant: fakes.auth }));
vi.mock('@/server/public-data/geocode', () => ({ geocodePostcode: fakes.geocode, normalisePostcode: (v: string) => v.replace(/\s/g, '').toUpperCase().replace(/(.+)(.{3})$/, '$1 $2') }));
vi.mock('@/server/public-data/cache', () => ({ TTL: { day: 1, month: 30 }, cached: (_key: string, _source: string, _ttl: number, fn: () => unknown) => fn() }));
vi.mock('@/server/public-data/http', () => ({ fetchJson: fakes.json, failSoft: async (_name: string, fn: () => Promise<unknown>) => { try { return await fn(); } catch { return null; } } }));
import { getMapLocation, getCrimeHeat, getDeprivation } from '@/server/actions/map-data';

beforeEach(() => { vi.resetAllMocks(); fakes.auth.mockResolvedValue({ tenantId: 'test' }); });

describe('map coverage and evidence', () => {
  it('draws a closed ring at the requested distance in kilometres', () => {
    const ring = searchRing(53.5, -1.2, 3);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const [lng, lat] of ring) expect(distanceKm(53.5, -1.2, lat, lng)).toBeCloseTo(3, 6);
  });
  it.each([[NaN, -1, 1], [53, Infinity, 1], [0, 0, 1], [53, -1, 15], [53, -1, -1]])('rejects invalid or excessive searches: %j', (lat, lng, radius) => {
    expect(() => assertMapRequest(lat, lng, radius)).toThrow();
  });
  it('does not pin missing coordinates at zero or include points outside the circle', () => {
    const a = { id: 'test', category: 'transport', name: 'Example amenity', distanceText: '', travelMinutes: 0, mode: 'walk' } satisfies Amenity;
    const result = amenityPins([a, { ...a, lat: 53.5, lng: -1.2 }, { ...a, lat: 53.55, lng: -1.2 }, { ...a, lat: NaN, lng: -1.2 }], 53.5, -1.2, 1);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.distanceKm).toBe('0.00');
  });
  it('does not invent a retrieval date for old data', () => {
    expect(mapDate()).toBe('Date not recorded');
    expect(mapDate('not a date')).toBe('Date not recorded');
    expect(mapDate('2026-11-10T12:00:00Z')).toBe('10 Nov 2026');
  });
});

describe('protected map sources', () => {
  it('rejects all source requests before upstream work when signed out', async () => {
    fakes.auth.mockRejectedValue(new Error('Not authenticated'));
    await expect(getMapLocation('SW1A 1AA')).rejects.toThrow('Not authenticated');
    await expect(getCrimeHeat(53.5, -1.2, 1)).rejects.toThrow('Not authenticated');
    await expect(getDeprivation(53.5, -1.2, 1)).rejects.toThrow('Not authenticated');
    expect(fakes.geocode).not.toHaveBeenCalled(); expect(fakes.json).not.toHaveBeenCalled();
  });
  it('validates postcode and search size before external requests', async () => {
    expect(await getMapLocation('Example address')).toBeNull();
    await expect(getCrimeHeat(53.5, -1.2, 15)).rejects.toThrow();
    expect(fakes.json).not.toHaveBeenCalled(); expect(fakes.geocode).not.toHaveBeenCalled();
    await getMapLocation('sw1a1aa');
    expect(fakes.geocode).toHaveBeenCalledWith('SW1A 1AA');
  });
  it('queries the drawn Police search ring and retains the real data month', async () => {
    fakes.json.mockResolvedValueOnce([{ date: '2026-08' }]).mockResolvedValueOnce([
      { category: 'anti-social-behaviour', location: { latitude: '53.5', longitude: '-1.2' } },
      { category: 'other', location: { latitude: 'invalid', longitude: '-1.2' } },
    ]);
    const result = await getCrimeHeat(53.5, -1.2, 1);
    const query = new URL(fakes.json.mock.calls[1][0]).searchParams;
    expect(query.get('date')).toBe('2026-08');
    const coords = query.get('poly')!.split(':').map((pair) => pair.split(',').map(Number));
    expect(coords).toHaveLength(64);
    for (const [lat, lng] of coords) expect(distanceKm(53.5, -1.2, lat, lng)).toBeCloseTo(1, 3);
    expect(result?.features).toHaveLength(1);
    expect(result?.period).toBe('2026-08'); expect(result?.retrievedAt).toBeTruthy();
  });
  it('distinguishes a genuine empty Police response from an unavailable service', async () => {
    fakes.json.mockResolvedValueOnce([{ date: '2026-08' }]).mockResolvedValueOnce([]);
    expect((await getCrimeHeat(53.5, -1.2, 1))?.features).toEqual([]);
    fakes.json.mockRejectedValueOnce(new Error('upstream failed'));
    expect(await getCrimeHeat(53.5, -1.2, 1)).toBeNull();
  });
  it('does not treat a truncated deprivation response as full coverage', async () => {
    fakes.json.mockResolvedValue({ type: 'FeatureCollection', features: [], exceededTransferLimit: true });
    expect(await getDeprivation(53.5, -1.2, 5)).toBeNull();
    fakes.json.mockResolvedValue({ type: 'FeatureCollection', features: [], properties: { exceededTransferLimit: true } });
    expect(await getDeprivation(53.5, -1.2, 5)).toBeNull();
    fakes.json.mockResolvedValue({ type: 'FeatureCollection', features: [] });
    expect(await getDeprivation(53.5, -1.2, 1)).toMatchObject({ features: [], period: '2019' });
  });
});
