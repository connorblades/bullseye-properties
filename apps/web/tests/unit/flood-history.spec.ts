import { describe, expect, it } from 'vitest';
import { dedupeFloodEvents, parseFloodDate, type RfoProps } from '@/server/public-data/flood-history';

describe('parseFloodDate', () => {
  it('parses epoch milliseconds (incl. pre-1970 negatives)', () => {
    const d = parseFloodDate(1183334400000); // 2007-07-02
    expect(d?.year).toBe(2007);
    expect(d?.iso).toBe('2007-07-02');
    const old = parseFloodDate(-719193600000); // 1947
    expect(old?.year).toBe(1947);
  });
  it('parses ISO strings and rejects junk / null', () => {
    expect(parseFloodDate('2013-12-05')?.year).toBe(2013);
    expect(parseFloodDate(null)).toBeNull();
    expect(parseFloodDate('not a date')).toBeNull();
  });
});

describe('dedupeFloodEvents', () => {
  const ms2007 = Date.UTC(2007, 6, 2);
  const ms2013 = Date.UTC(2013, 11, 5);

  it('collapses many polygons of one event into a single distinct event', () => {
    const rows: RfoProps[] = [
      { name: 'River Ryton Worksop June 2007', start_date: ms2007, flood_src: 'main river', flood_caus: 'channel capacity exceeded' },
      { name: 'River Ryton Worksop June 2007', start_date: ms2007, flood_src: 'main river' },
      { name: 'River Ryton Worksop June 2007', start_date: ms2007 },
    ];
    const { recordCount, events } = dedupeFloodEvents(rows);
    expect(recordCount).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].year).toBe(2007);
    expect(events[0].source).toBe('main river');
  });

  it('orders distinct events most-recent first and preserves fields', () => {
    const rows: RfoProps[] = [
      { name: 'Old flood', start_date: ms2007 },
      { name: 'Recent flood', start_date: ms2013, flood_caus: 'surface water' },
    ];
    const { recordCount, events } = dedupeFloodEvents(rows);
    expect(recordCount).toBe(2);
    expect(events[0].name).toBe('Recent flood');
    expect(events[0].cause).toBe('surface water');
    expect(events[1].name).toBe('Old flood');
  });

  it('handles missing names and dates without crashing', () => {
    const rows: RfoProps[] = [{ name: null, start_date: null }, { name: '  ', start_date: undefined }];
    const { recordCount, events } = dedupeFloodEvents(rows);
    expect(recordCount).toBe(1); // both collapse to the same unnamed/no-date key
    expect(events[0].name).toBe('Unnamed recorded flood');
    expect(events[0].startDate).toBeUndefined();
  });

  it('caps the events list at 8 but still counts all distinct events', () => {
    const rows: RfoProps[] = Array.from({ length: 12 }, (_, i) => ({
      name: `Flood ${i}`,
      start_date: Date.UTC(2000 + i, 0, 1),
    }));
    const { recordCount, events } = dedupeFloodEvents(rows);
    expect(recordCount).toBe(12);
    expect(events).toHaveLength(8);
    expect(events[0].name).toBe('Flood 11'); // most recent first
  });
});
