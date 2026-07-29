/**
 * Server-only Ofcom Connected Nations MOBILE coverage integration.
 *
 *  - fetchMobileCoverage(postcode, districtCode): cheap per-deal DB lookup.
 *  - ingestMobileCoverage(csvUrl): bulk pipeline (ingest-mobile-coverage Trigger
 *    task) that streams an Ofcom Connected Nations mobile coverage CSV and upserts
 *    into mobile_coverage.
 *
 * IMPORTANT GEOGRAPHY NOTE. Unlike fixed broadband (published at POSTCODE level),
 * Ofcom's FREE bulk mobile download is aggregated at LOCAL AUTHORITY level (the
 * `laua` GSS code, e.g. E07000171). Postcode/address-level mobile coverage is only
 * available from Ofcom's address-level API (api.ofcom.org.uk), which requires
 * account registration + approval + API keys, so it fails Bullseye's "free, no
 * signup" bar. We therefore key this table on the local-authority GSS code that the
 * orchestrator already supplies as `districtCode`; `postcode` is accepted only for
 * signature parity.
 *
 * Ofcom publishes per-release ZIP/CSVs with no stable public API, so the source URL
 * is supplied via OFCOM_MOBILE_CSV_URL (or the task payload). Point it at the
 * extracted `..._laua_r01.csv` member. Column names vary between releases, so
 * headers are matched tolerantly. Free (Ofcom open data). Fail-soft throughout.
 *
 * REQUIRES migration 0012 (table `mobile_coverage`) before first ingest.
 */

import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { mobileCoverage } from '@/server/db/schema';
import type { MobileCoverageInfo } from '@/lib/deal-store';
import { failSoft } from './http';
import { findCol } from './broadband';
import { parseCsvLine } from './land-ownership';

// ── Per-deal query ───────────────────────────────────────────────────────────

export async function fetchMobileCoverage(
  _postcode: string,
  districtCode?: string,
): Promise<MobileCoverageInfo | null> {
  return failSoft('mobile-coverage', async () => {
    if (!districtCode) return null; // free bulk data is keyed by local-authority GSS
    const rows = await db
      .select()
      .from(mobileCoverage)
      .where(eq(mobileCoverage.id, districtCode))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const n = (v: string | null) => (v == null ? undefined : Number(v));
    return {
      areaName: r.areaName ?? undefined,
      fourGIndoorPct: n(r.fourGIndoorPct),
      fourGIndoorAllPct: n(r.fourGIndoorAllPct),
      fourGOutdoorPct: n(r.fourGOutdoorPct),
      fiveGOutdoorPct: n(r.fiveGOutdoorPct),
      fiveGOutdoorAllPct: n(r.fiveGOutdoorAllPct),
      source: 'Ofcom Connected Nations (mobile, local-authority level)',
    } satisfies MobileCoverageInfo;
  });
}

// ── Bulk ingestion ───────────────────────────────────────────────────────────

/** Exact header match (case-insensitive), falling back to tolerant keyword match. */
function col(header: string[], exact: string, ...keywords: string[]): number {
  const i = header.findIndex((h) => h.trim().toLowerCase() === exact.toLowerCase());
  return i >= 0 ? i : keywords.length ? findCol(header, ...keywords) : -1;
}

export function toNum(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Ofcom encodes each technology/location as bands 0..4 giving the % of premises
 * covered by that many of the four MNOs. So band_0 = % not-spot (no operator) and
 * band_4 = % covered by all four. "At least one operator" = 100 - band_0.
 *
 * A blank band_0 rounds to ~0 not-spot (i.e. ~100% covered by at least one), so
 * when the column is PRESENT a blank is read as 0. A missing column (idx < 0) is null.
 */
export function atLeastOne(present: boolean, raw: string): string | null {
  if (!present) return null;
  const none = toNum(raw) ?? 0;
  return String(round1(100 - none));
}
export function allFour(present: boolean, raw: string): string | null {
  if (!present) return null;
  const all = toNum(raw);
  return all == null ? null : String(round1(all));
}

type IngestStats = { scanned: number; upserted: number };

export async function ingestMobileCoverage(
  csvUrl = process.env.OFCOM_MOBILE_CSV_URL,
  log: (m: string) => void = () => {},
): Promise<IngestStats> {
  if (!csvUrl) throw new Error('Missing OFCOM_MOBILE_CSV_URL');

  const res = await fetch(csvUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let cols: {
    laua: number; name: number;
    g4InNone: number; g4InAll: number; g4OutNone: number;
    g5OutNone: number; g5OutAll: number;
  } | null = null;
  const stats: IngestStats = { scanned: 0, upserted: 0 };
  let batch: (typeof mobileCoverage.$inferInsert)[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await db
      .insert(mobileCoverage)
      .values(batch)
      .onConflictDoUpdate({
        target: mobileCoverage.id,
        set: {
          areaName: sql`excluded.area_name`,
          fourGIndoorPct: sql`excluded.four_g_indoor_pct`,
          fourGIndoorAllPct: sql`excluded.four_g_indoor_all_pct`,
          fourGOutdoorPct: sql`excluded.four_g_outdoor_pct`,
          fiveGOutdoorPct: sql`excluded.five_g_outdoor_pct`,
          fiveGOutdoorAllPct: sql`excluded.five_g_outdoor_all_pct`,
          updatedAt: sql`now()`,
        },
      });
    stats.upserted += batch.length;
    batch = [];
  };

  const handle = (row: string[]) => {
    if (!cols) {
      const h = row.map((s) => s.replace(/^﻿/, '').trim());
      cols = {
        laua: col(h, 'laua', 'laua'),
        name: col(h, 'laua_name', 'laua', 'name'),
        g4InNone: col(h, '4G_prem_in_0'),
        g4InAll: col(h, '4G_prem_in_4'),
        g4OutNone: col(h, '4G_prem_out_0'),
        g5OutNone: col(h, '5G_high_confidence_prem_out_0'),
        g5OutAll: col(h, '5G_high_confidence_prem_out_4'),
      };
      if (cols.laua < 0) throw new Error('No laua column in Ofcom mobile CSV');
      return;
    }
    const c = cols;
    const get = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const gss = get(c.laua).toUpperCase();
    if (!/^[A-Z]\d{8}$/.test(gss)) return; // skip blanks / non-GSS rows
    stats.scanned++;
    batch.push({
      id: gss,
      areaName: get(c.name) || null,
      fourGIndoorPct: atLeastOne(c.g4InNone >= 0, get(c.g4InNone)),
      fourGIndoorAllPct: allFour(c.g4InAll >= 0, get(c.g4InAll)),
      fourGOutdoorPct: atLeastOne(c.g4OutNone >= 0, get(c.g4OutNone)),
      fiveGOutdoorPct: atLeastOne(c.g5OutNone >= 0, get(c.g5OutNone)),
      fiveGOutdoorAllPct: allFour(c.g5OutAll >= 0, get(c.g5OutAll)),
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

  log(`mobile-coverage done: scanned ${stats.scanned}, upserted ${stats.upserted}`);
  return stats;
}
