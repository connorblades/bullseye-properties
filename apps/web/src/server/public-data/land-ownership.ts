/**
 * Server-only HMLR corporate-ownership (CCOD/OCOD) integration.
 *
 * Two halves:
 *  - fetchLandOwnership(postcode): a cheap DB lookup, run per-deal in the pull,
 *    returning the company-owned titles at that postcode.
 *  - ingestDataset(...): the bulk pipeline (run by the ingest-land-data Trigger
 *    task, not per-deal) that streams HMLR's free monthly CCOD/OCOD CSV via the
 *    Use-Land-and-Property-Data API, filters to Bullseye's operating postcode
 *    areas to keep the table lean, and upserts into land_ownership.
 *
 * Free per HMLR (OGL). Covers COMPANY owners only - individuals are not in the
 * free data. Needs a free API key in HMLR_API_KEY. Fail-soft throughout.
 *
 * Docs: https://use-land-property-data.service.gov.uk/api-documentation
 */

import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { landOwnership } from '@/server/db/schema';
import type { CorporateOwner, LandOwnershipInfo, LandOwnershipTitle } from '@/lib/deal-store';
import { normalisePostcode } from './geocode';
import { fetchJson, failSoft } from './http';

const HMLR_BASE = 'https://use-land-property-data.service.gov.uk/api/v1';

/** Outward-code areas to ingest (Bullseye's East Midlands / South Yorkshire core). Override via env. */
export const INGEST_POSTCODE_AREAS = (process.env.HMLR_INGEST_AREAS ?? 'NG,DN,S,DE,LN,LE,NN,CV,ST,DY,WS,MK,PE')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

// ── Per-deal query ───────────────────────────────────────────────────────────

export async function fetchLandOwnership(postcode: string): Promise<LandOwnershipInfo | null> {
  return failSoft('landOwnership', async () => {
    const pc = normalisePostcode(postcode);
    const rows = await db.select().from(landOwnership).where(eq(landOwnership.postcode, pc)).limit(25);
    if (rows.length === 0) return null;
    const titles: LandOwnershipTitle[] = rows.map((r) => ({
      titleNumber: r.titleNumber,
      tenure: r.tenure ?? undefined,
      address: r.address ?? undefined,
      pricePaid: r.pricePaid ?? undefined,
      dataset: (r.dataset === 'ocod' ? 'ocod' : 'ccod'),
      proprietors: (r.proprietors as CorporateOwner[]) ?? [],
    }));
    return { titles };
  });
}

// ── Bulk ingestion ───────────────────────────────────────────────────────────

/** Minimal RFC-4180-ish CSV line parser (handles quoted fields + "" escapes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const outwardArea = (postcode: string): string => {
  const m = postcode.trim().toUpperCase().match(/^([A-Z]{1,2})/);
  return m ? m[1] : '';
};

/** First header index whose name contains all keywords (case-insensitive). */
function findCol(header: string[], ...keywords: string[]): number {
  return header.findIndex((h) => {
    const l = h.toLowerCase();
    return keywords.every((k) => l.includes(k));
  });
}

type ResolvedCols = {
  postcode: number; title: number; tenure: number; address: number; district: number; pricePaid: number;
  names: number[]; regs: number[]; cats: number[]; countries: number[];
};

/** Resolve CCOD/OCOD columns tolerantly (header names vary between releases). */
export function resolveColumns(header: string[]): ResolvedCols {
  const numbered = (kw: string) => [1, 2, 3, 4].map((n) => findCol(header, kw, `(${n})`));
  const titleNum = findCol(header, 'title', 'number');
  const propAddr = findCol(header, 'property', 'address');
  return {
    postcode: findCol(header, 'postcode'),
    title: titleNum >= 0 ? titleNum : findCol(header, 'title'),
    tenure: findCol(header, 'tenure'),
    address: propAddr >= 0 ? propAddr : findCol(header, 'address'),
    district: findCol(header, 'district'),
    pricePaid: findCol(header, 'price', 'paid'),
    names: numbered('proprietor name'),
    regs: numbered('company registration'),
    cats: numbered('proprietorship category'),
    countries: numbered('country incorporated'),
  };
}

function buildProprietors(cols: string[], R: ResolvedCols): CorporateOwner[] {
  const get = (i: number) => (i >= 0 ? (cols[i] ?? '').trim() : '');
  const owners: CorporateOwner[] = [];
  for (let n = 0; n < 4; n++) {
    const name = get(R.names[n]);
    if (!name) continue;
    owners.push({
      name,
      companyRegNo: get(R.regs[n]) || undefined,
      category: get(R.cats[n]) || undefined,
      country: get(R.countries[n]) || undefined,
    });
  }
  return owners;
}

type IngestStats = { dataset: string; scanned: number; matched: number; upserted: number };

/**
 * Stream HMLR's monthly CCOD/OCOD CSV and upsert the rows whose postcode falls
 * in INGEST_POSTCODE_AREAS. Returns counts. Designed to run in a long-lived
 * Trigger.dev task. `log` is an optional progress sink.
 */
export async function ingestDataset(
  dataset: 'ccod' | 'ocod',
  log: (m: string) => void = () => {},
): Promise<IngestStats> {
  const apiKey = process.env.HMLR_API_KEY;
  if (!apiKey) throw new Error('Missing HMLR_API_KEY');

  // 1. List files for the dataset, pick the latest FULL file.
  const list = await fetchJson<{ result?: { resources?: { file_name?: string; name?: string }[] } }>(
    `${HMLR_BASE}/datasets/${dataset}`,
    { headers: { Authorization: apiKey } },
  );
  const files = (list.result?.resources ?? []).map((r) => r.file_name ?? r.name ?? '').filter(Boolean);
  const fullFile = files.find((f) => /FULL/i.test(f)) ?? files[0];
  if (!fullFile) throw new Error(`No ${dataset} file available`);
  log(`Selected ${dataset} file ${fullFile}`);

  // 2. Resolve the (time-limited) download URL.
  const fileMeta = await fetchJson<{ result?: { download_url?: string } }>(
    `${HMLR_BASE}/datasets/${dataset}/${encodeURIComponent(fullFile)}`,
    { headers: { Authorization: apiKey } },
  );
  const downloadUrl = fileMeta.result?.download_url;
  if (!downloadUrl) throw new Error(`No download URL for ${fullFile}`);

  // 3. Stream + parse + filter + batch-upsert.
  const res = await fetch(downloadUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let header: string[] | null = null;
  let R: ResolvedCols | null = null;
  const stats: IngestStats = { dataset, scanned: 0, matched: 0, upserted: 0 };
  let batch: (typeof landOwnership.$inferInsert)[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await db
      .insert(landOwnership)
      .values(batch)
      .onConflictDoUpdate({
        target: [landOwnership.dataset, landOwnership.titleNumber],
        set: {
          tenure: sql`excluded.tenure`,
          postcode: sql`excluded.postcode`,
          address: sql`excluded.address`,
          district: sql`excluded.district`,
          pricePaid: sql`excluded.price_paid`,
          proprietors: sql`excluded.proprietors`,
          updatedAt: sql`now()`,
        },
      });
    stats.upserted += batch.length;
    batch = [];
  };

  const handleRow = (cols: string[]) => {
    if (!header) {
      header = cols.map((h) => h.trim());
      R = resolveColumns(header);
      log(`${dataset} header (${header.length} cols): ${header.join(' | ').slice(0, 600)}`);
      log(`${dataset} resolved -> postcode:${R.postcode} title:${R.title} name1:${R.names[0]} pricePaid:${R.pricePaid}`);
      if (R.postcode < 0) log(`WARNING: no postcode column detected in ${dataset} - header may be unreadable (gzip?)`);
      return;
    }
    stats.scanned++;
    const get = (i: number) => (i >= 0 ? (cols[i] ?? '').trim() : '');
    const postcode = normalisePostcode(get(R!.postcode));
    if (!postcode || !INGEST_POSTCODE_AREAS.includes(outwardArea(postcode))) return;
    const titleNumber = get(R!.title);
    if (!titleNumber) return;
    const proprietors = buildProprietors(cols, R!);
    const priceStr = get(R!.pricePaid).replace(/[^0-9]/g, '');
    stats.matched++;
    batch.push({
      id: `${dataset}:${titleNumber}`,
      dataset,
      titleNumber,
      tenure: get(R!.tenure) || null,
      postcode,
      address: get(R!.address) || null,
      district: get(R!.district) || null,
      pricePaid: priceStr ? Number(priceStr) : null,
      proprietors,
    });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      handleRow(parseCsvLine(trimmed));
      if (batch.length >= 500) await flush();
    }
    if (stats.scanned % 100_000 === 0 && stats.scanned > 0) {
      log(`${dataset}: scanned ${stats.scanned}, matched ${stats.matched}`);
    }
  }
  if (buf.trim()) handleRow(parseCsvLine(buf.replace(/\r$/, '')));
  await flush();

  log(`${dataset} done: scanned ${stats.scanned}, matched ${stats.matched}, upserted ${stats.upserted}`);
  return stats;
}
