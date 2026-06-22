import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { parseInspireFeatures, unzipFirst } from '@/server/public-data/boundaries';

describe('parseInspireFeatures', () => {
  const xml = `<?xml version="1.0"?>
  <wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml">
    <gml:featureMember>
      <Land><INSPIREID>11111</INSPIREID>
        <geometry><gml:Polygon srsName="EPSG:27700"><gml:exterior><gml:LinearRing>
          <gml:posList>1 2 3 4 5 6 1 2</gml:posList>
        </gml:LinearRing></gml:exterior></gml:Polygon></geometry>
      </Land>
    </gml:featureMember>
    <gml:featureMember>
      <Land><INSPIREID>22222</INSPIREID>
        <geometry><gml:Polygon><gml:exterior><gml:LinearRing>
          <gml:posList>7 8 9 10 11 12 7 8</gml:posList>
        </gml:LinearRing></gml:exterior></gml:Polygon></geometry>
      </Land>
    </gml:featureMember>
  </wfs:FeatureCollection>`;

  it('extracts an id + geometry fragment per feature', () => {
    const f = parseInspireFeatures(xml);
    expect(f).toHaveLength(2);
    expect(f[0].inspireId).toBe('11111');
    expect(f[0].gml).toContain('<gml:Polygon');
    expect(f[0].gml).toContain('</gml:Polygon>');
    expect(f[1].inspireId).toBe('22222');
  });

  it('returns [] when there are no feature members', () => {
    expect(parseInspireFeatures('<root/>')).toEqual([]);
  });
});

describe('unzipFirst', () => {
  // Build a minimal single-entry ZIP (deflate) in-memory and round-trip it.
  function makeZip(name: string, content: Buffer): Buffer {
    const comp = deflateRawSync(content);
    const nameBuf = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); // local file header sig
    h.writeUInt16LE(8, 8); // method = deflate
    h.writeUInt32LE(comp.length, 18); // compressed size
    h.writeUInt32LE(content.length, 22); // uncompressed size
    h.writeUInt16LE(nameBuf.length, 26); // name length
    h.writeUInt16LE(0, 28); // extra length
    return Buffer.concat([h, nameBuf, comp]);
  }

  it('extracts and inflates the matching entry', () => {
    const gml = Buffer.from('<gml:Polygon>boundary</gml:Polygon>', 'utf8');
    const zip = makeZip('Mansfield.gml', gml);
    const out = unzipFirst(zip);
    expect(out?.toString('utf8')).toBe('<gml:Polygon>boundary</gml:Polygon>');
  });

  it('returns null when no entry matches the pattern', () => {
    const zip = makeZip('readme.txt', Buffer.from('hi'));
    expect(unzipFirst(zip)).toBeNull();
  });
});
