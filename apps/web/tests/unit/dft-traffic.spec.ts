import { describe, expect, it } from 'vitest';
import {
  nearestCountPoint,
  aadfTotals,
  prettyRoad,
  haversineKm,
  type CountPoint,
  type AadfRow,
} from '@/server/public-data/dft-traffic';

const cp = (over: Partial<CountPoint>): CountPoint => ({
  count_point_id: 1,
  aadf_year: 2025,
  road_name: 'A630',
  road_type: 'Major',
  latitude: '53.4',
  longitude: '-1.35',
  ...over,
});

describe('prettyRoad', () => {
  it('expands DfT minor-road placeholders and passes real road names through', () => {
    expect(prettyRoad('U')).toBe('Unclassified road');
    expect(prettyRoad('C')).toBe('Classified minor road');
    expect(prettyRoad('A630')).toBe('A630');
    expect(prettyRoad('M1')).toBe('M1');
  });
});

describe('nearestCountPoint', () => {
  it('picks the closest point and returns its distance in metres', () => {
    const points = [
      cp({ count_point_id: 1, latitude: '53.50', longitude: '-1.35' }), // far
      cp({ count_point_id: 2, latitude: '53.4302', longitude: '-1.3568' }), // ~on point
    ];
    const res = nearestCountPoint(points, 53.4302, -1.3568);
    expect(res?.point.count_point_id).toBe(2);
    expect(res?.distanceM).toBeLessThan(100);
  });

  it('skips points with non-numeric coordinates and returns null when none usable', () => {
    const mixed = [cp({ count_point_id: 9, latitude: 'n/a', longitude: '' })];
    expect(nearestCountPoint(mixed, 53.4, -1.35)).toBeNull();
    const withGood = [...mixed, cp({ count_point_id: 3, latitude: '53.40', longitude: '-1.35' })];
    expect(nearestCountPoint(withGood, 53.4, -1.35)?.point.count_point_id).toBe(3);
  });
});

describe('aadfTotals', () => {
  it('sums all-motor-vehicles and HGVs across both direction rows', () => {
    const rows: AadfRow[] = [
      { count_point_id: 1, year: 2025, all_motor_vehicles: 72800, all_hgvs: 7700 },
      { count_point_id: 1, year: 2025, all_motor_vehicles: 72801, all_hgvs: 7723 },
    ];
    expect(aadfTotals(rows)).toEqual({ aadf: 145601, hgvs: 15423 });
  });

  it('treats missing flow values as zero', () => {
    const rows = [{ count_point_id: 1, year: 2025 } as AadfRow];
    expect(aadfTotals(rows)).toEqual({ aadf: 0, hgvs: 0 });
  });
});

describe('haversineKm', () => {
  it('is ~0 for identical points and positive otherwise', () => {
    expect(haversineKm(53.43, -1.35, 53.43, -1.35)).toBeCloseTo(0, 5);
    expect(haversineKm(53.43, -1.35, 53.30, -1.12)).toBeGreaterThan(10);
  });
});
