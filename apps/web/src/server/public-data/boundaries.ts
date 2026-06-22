/**
 * Server-only HMLR INSPIRE freehold boundary polygons.
 *
 *  - fetchBoundary(lat,lng): point-in-polygon lookup (PostGIS) -> plot boundary
 *    as WGS84 GeoJSON. Cheap per-deal query, fail-soft.
 *  - ingestInspire(...): bulk pipeline (ingest-boundaries Trigger task) that
 *    downloads HMLR's free per-local-authority INSPIRE GML (zipped), parses the
 *    polygons, and inserts them as PostGIS geometry in the native CRS (EPSG:27700).
 *
 * Free (OGL). Needs PostGIS enabled + HMLR_API_KEY. INSPIRE ZIPs are unpacked
 * with a minimal built-in-zlib reader (no extra dependency); if that proves
 * flaky on a real file, `pnpm add fflate` and swap unzipFirst() for it.
 *
 * VERIFY LIVE: PostGIS queries, the ZIP reader and the GML/CRS handling cannot
 * be exercised in this environment - confirm on the first real ingest.
 */

import { inflateRawSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import type { BoundaryInfo } from '@/lib/deal-store';
import { fetchJson, failSoft } from './http';

const HMLR_BASE = 'https://use-land-property-data.service.gov.uk/api/v1';

/** Local authorities to ingest (match INSPIRE file names). Override via env. */
export const INSPIRE_LOCAL_AUTHORITIES = (
  process.env.HMLR_INSPIRE_LAS ??
  'Mansfield,Ashfield,Bassetlaw,Newark and Sherwood,Bolsover,Chesterfield,Doncaster,Sheffield,Rotherham,Bassetlaw'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── ZIP (minimal, built-in zlib; non-streamed local headers) ─────────────────

/** Extract the first entry whose name matches `pattern` from a ZIP buffer. */
export function unzipFirst(buf: Buffer, pattern = /\.gml$/i): Buffer | null {
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break; // local file header PK\3\4
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    if (compSize === 0) break; // streamed entry (sizes in data descriptor) - unsupported
    const comp = buf.subarray(dataStart, dataStart + compSize);
    if (pattern.test(name)) {
      return method === 0 ? Buffer.from(comp) : inflateRawSync(comp);
    }
    i = dataStart + compSize;
  }
  return null;
}

// ── GML parsing (pure) ───────────────────────────────────────────────────────

/** Extract { inspireId, gml-geometry-fragment } per featureMember. */
export function parseInspireFeatures(xml: string): { inspireId: string; gml: string }[] {
  const out: { inspireId: string; gml: string }[] = [];
  const members = xml.split(/<gml:featureMember>/i).slice(1);
  members.forEach((m, idx) => {
    const id = m.match(/INSPIREID[^>]*>\s*([^<\s]+)/i);
    const geom = m.match(/<gml:(Polygon|Surface|MultiSurface|MultiPolygon)\b[\s\S]*?<\/gml:\1>/i);
    if (!geom) return;
    out.push({ inspireId: id ? id[1].trim() : `inspire-${idx}`, gml: geom[0] });
  });
  return out;
}

// ── Per-deal query ───────────────────────────────────────────────────────────

export async function fetchBoundary(lat: number, lng: number): Promise<BoundaryInfo | null> {
  return failSoft('boundary', async () => {
    const rows = (await db.execute(sql`
      select id, ST_AsGeoJSON(ST_Transform(ST_SetSRID(geom, 27700), 4326)) as gj
      from land_boundary
      where ST_Contains(ST_SetSRID(geom, 27700), ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 27700))
      limit 1
    `)) as unknown as { id: string; gj: string | null }[];
    const r = rows?.[0];
    if (!r?.gj) return null;
    return { inspireId: r.id, geojson: JSON.parse(r.gj) as BoundaryInfo['geojson'] };
  });
}

// ── Bulk ingestion ───────────────────────────────────────────────────────────

type IngestStats = { files: number; features: number };

export async function ingestInspire(log: (m: string) => void = () => {}): Promise<IngestStats> {
  const apiKey = process.env.HMLR_API_KEY;
  if (!apiKey) throw new Error('Missing HMLR_API_KEY');

  const list = await fetchJson<{ result?: { resources?: { file_name?: string; name?: string }[] } }>(
    `${HMLR_BASE}/datasets/inspire`,
    { headers: { Authorization: apiKey } },
  );
  const files = (list.result?.resources ?? []).map((r) => r.file_name ?? r.name ?? '').filter(Boolean);
  const wanted = files.filter((f) => INSPIRE_LOCAL_AUTHORITIES.some((la) => f.toLowerCase().includes(la.toLowerCase())));
  log(`INSPIRE: ${wanted.length} matched files of ${files.length}`);

  const stats: IngestStats = { files: 0, features: 0 };
  for (const file of wanted) {
    const meta = await fetchJson<{ result?: { download_url?: string } }>(
      `${HMLR_BASE}/datasets/inspire/${encodeURIComponent(file)}`,
      { headers: { Authorization: apiKey } },
    );
    const url = meta.result?.download_url;
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) continue;
    const gml = unzipFirst(Buffer.from(await res.arrayBuffer()));
    if (!gml) {
      log(`No GML entry in ${file} (zip reader may need fflate)`);
      continue;
    }
    const la = file.replace(/\.zip$/i, '');
    const features = parseInspireFeatures(gml.toString('utf8'));
    for (const f of features) {
      try {
        await db.execute(sql`
          insert into land_boundary (id, local_authority, geom, updated_at)
          values (${f.inspireId}, ${la}, ST_GeomFromGML(${f.gml}), now())
          on conflict (id) do update set
            local_authority = excluded.local_authority,
            geom = excluded.geom,
            updated_at = now()
        `);
        stats.features++;
      } catch {
        // skip a feature PostGIS can't parse; keep going
      }
    }
    stats.files++;
    log(`${file}: ${features.length} features`);
  }
  log(`INSPIRE done: ${stats.files} files, ${stats.features} features`);
  return stats;
}
