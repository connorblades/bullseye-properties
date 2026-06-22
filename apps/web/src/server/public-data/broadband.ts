/**
 * Server-only Ofcom Connected Nations fixed-broadband integration.
 *
 *  - fetchBroadband(postcode): cheap per-deal DB lookup.
 *  - ingestBroadband(csvUrl): bulk pipeline (ingest-broadband Trigger task) that
 *    streams an Ofcom Connected Nations fixed-broadband postcode CSV, filters to
 *    Bullseye's operating postcode areas, and upserts into broadband_coverage.
 *
 * Ofcom publishes per-release CSVs with no stable API, so the source URL is
 * supplied via OFCOM_BROADBAND_CSV_URL (or the task payload). Column names vary
 * between releases, so the header is matched by keyword (tolerant). Free (Ofcom
 * open data). Fail-soft throughout.
 */

import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { broadbandCoverage } from '@/server/db/schema';
import type { BroadbandInfo } from '@/lib/deal-store';
import { normalisePostcode } from './geocode';
import { failSoft } from './http';
import { parseCsvLine, INGEST_POSTCODE_AREAS } from './land-ownership';

// ── Per-deal query ───────────────────────────────────────────────────────────

export async function fetchBroadband(postcode: string): Promise<BroadbandInfo | null> {
  return failSoft('broadband', async () => {
    const pc = normalisePostcode(postcode);
    const rows = await db.select().from(broadbandCoverage).where(eq(broadbandCoverage.postcode, pc)).limit(1);
    const r = rows[0];
    if (!r) return null;
    const n = (v: string | null) => (v == null ? undefined : Number(v));
    return {
      maxDownloadMbps: r.maxDownloadMbps ?? undefined,
      superfastPct: n(r.superfastPct),
      ultrafastPct: n(r.ultrafastPct),
      fullFibrePct: n(r.fullFibrePct),
      premises: r.premises ?? undefined,
      source: 'Ofcom Connected Nations (fixed broadband)',
    } satisfies BroadbandInfo;
  });
}

// ── Bulk ingestion ───────────────────────────────────────────────────────────

const outwardArea = (postcode: string): string => {
  const m = postcode.trim().toUpperCase().match(/^([A-Z]{1,2})/);
  return m ? m[1] : '';
};

/** Find the first header index whose name contains all of the keywords (case-insensitive). */
export function findCol(header: string[], ...keywords: string[]): number {
  return header.findIndex((h) => {
    const l = h.toLowerCase();
    return keywords.every((k) => l.includes(k));
  });
}

function toNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

type IngestStats = { scanned: number; matched: number; upserted: number };

export async function ingestBroadband(
  csvUrl = process.env.OFCOM_BROADBAND_CSV_URL,
  log: (m: string) => void = () => {},
): Promise<IngestStats> {
  if (!csvUrl) throw new Error('Missing OFCOM_BROADBAND_CSV_URL');

  const res = await fetch(csvUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let cols: {
    postcode: number; maxDl: number; sfbb: number; ufbb: number; fttp: number; premises: number;
  } | null = null;
  const stats: IngestStats = { scanned: 0, matched: 0, upserted: 0 };
  let batch: (typeof broadbandCoverage.$inferInsert)[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await db
      .insert(broadbandCoverage)
      .values(batch)
      .onConflictDoUpdate({
        target: broadbandCoverage.id,
        set: {
          postcode: sql`excluded.postcode`,
          maxDownloadMbps: sql`excluded.max_download_mbps`,
          superfastPct: sql`excluded.superfast_pct`,
          ultrafastPct: sql`excluded.ultrafast_pct`,
          fullFibrePct: sql`excluded.full_fibre_pct`,
          premises: sql`excluded.premises`,
          updatedAt: sql`now()`,
        },
      });
    stats.upserted += batch.length;
    batch = [];
  };

  const handle = (row: string[]) => {
    if (!cols) {
      const h = row.map((s) => s.trim());
      cols = {
        postcode: findCol(h, 'postcode'),
        maxDl: findCol(h, 'maximum', 'download'),
        sfbb: findCol(h, 'sfbb', 'availability'),
        ufbb: findCol(h, 'ufbb', 'availability'),
        fttp: findCol(h, 'full fibre'),
        premises: findCol(h, 'premises'),
      };
      if (cols.postcode < 0) throw new Error('No postcode column in Ofcom CSV');
      return;
    }
    stats.scanned++;
    const get = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const pc = normalisePostcode(get(cols.postcode));
    if (!pc || !INGEST_POSTCODE_AREAS.includes(outwardArea(pc))) return;
    const maxDl = toNum(get(cols.maxDl));
    stats.matched++;
    batch.push({
      id: pc,
      postcode: pc,
      maxDownloadMbps: maxDl != null ? Math.round(maxDl) : null,
      superfastPct: get(cols.sfbb) ? String(toNum(get(cols.sfbb)) ?? '') || null : null,
      ultrafastPct: get(cols.ufbb) ? String(toNum(get(cols.ufbb)) ?? '') || null : null,
      fullFibrePct: get(cols.fttp) ? String(toNum(get(cols.fttp)) ?? '') || null : null,
      premises: toNum(get(cols.premises)) != null ? Math.round(toNum(get(cols.premises)) as number) : null,
    });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.replace(/\r$/, '');
      if (!t) continue;
      handle(parseCsvLine(t));
      if (batch.length >= 500) await flush();
    }
  }
  if (buf.trim()) handle(parseCsvLine(buf.replace(/\r$/, '')));
  await flush();

  log(`broadband done: scanned ${stats.scanned}, matched ${stats.matched}, upserted ${stats.upserted}`);
  return stats;
}
