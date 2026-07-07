/**
 * Deal Radar distress-signal fetchers (M10).
 *
 * Server-only. Every client here uses the shared fail-soft HTTP helpers
 * (server/public-data/http.ts) so a flaky or unavailable source degrades to an
 * empty result, never a 500. A source outage must never break a scoring run.
 *
 * Three sources, in ascending legal sensitivity:
 *  1. The Gazette insolvency-notices feed - the clearest forced-sale signal
 *     (winding-up, administration, receivership, strike-off). Free, no-auth REST
 *     with a native postcode + radius filter. COMPANY-level (OGL); no personal
 *     data. Joined onto an already company-keyed lead by company_number and by
 *     notice postcode.
 *  2. Companies House PSC (persons with significant control) - keyed by
 *     company_number. Used at COMPANY / PORTFOLIO level only: a distressed-control
 *     flag and a "controls N distressed companies" rollup. The controlling
 *     person's name is carried only as approach-target metadata on a lead that is
 *     ALREADY keyed to a company we own via CCOD. It is never a discovery source
 *     and never introduces a new person-level record into the pipeline.
 *  3. The Gazette deceased-estates (probate, Trustee Act s.27, notice code 2903).
 *     This is a PERSON-LEVEL notice source. It is built but OFF BY DEFAULT behind
 *     the RDR_ENABLE_DECEASED_ESTATES gate (see the lawful-basis note below). The
 *     default scoring run ingests no deceased-estate / person-level notice data.
 *
 * === UK GDPR lawful-basis gate (AC-17, non-negotiable) ===
 * The Gazette states twice that its OGL licence does NOT cover reuse of personal
 * data. The deceased-estates feed (and any personal-insolvency feed) names living
 * individuals (executors) and a deceased person's last address. Reusing that in a
 * production lead-generation model is processing of personal data under UK GDPR
 * and requires a documented lawful basis (Art. 6) and a fairness / transparency
 * assessment BEFORE it is switched on. Until that review is signed off, the
 * fetcher stays gated: deceasedEstatesEnabled() is false unless
 * RDR_ENABLE_DECEASED_ESTATES === 'true' is set deliberately, and the fetcher
 * returns [] and performs no request while gated. Corporate sources (Gazette
 * insolvency, Companies House PSC/company data) are OGL-clean at company level and
 * are not gated.
 */

import { failSoft, fetchJson } from '@/server/public-data/http';

// ── The Gazette insolvency-notices client (company-level, OGL, no auth) ───────

/** Default Gazette API base. The insolvency edition is a JSON feed under it. */
const GAZETTE_BASE = process.env.RDR_GAZETTE_BASE ?? 'https://www.thegazette.co.uk';
/** Default postcode-radius, in miles (the Gazette accepts 1..30). */
const GAZETTE_RADIUS_MILES = Number(process.env.RDR_GAZETTE_RADIUS_MILES ?? '15');

/** One normalised forced-sale event from the Gazette insolvency feed. */
export type GazetteInsolvencyEvent = {
  /** Company name as printed on the notice (best-effort). */
  companyName?: string;
  /** Normalised company number when the notice carries one (join key). */
  companyNumber?: string;
  /** Short notice type, e.g. "winding-up", "administration", "strike-off". */
  noticeType: string;
  /** Postcode on the notice, upper-cased (join key / district match). */
  noticePostcode?: string;
  /** Published date, ISO yyyy-mm-dd when parseable. */
  publishedDate?: string;
  /** Whole days between publishedDate and asOf, when both are known. */
  daysSinceEvent?: number;
};

/** The Gazette JSON feed shape (Atom-as-JSON). Every field is best-effort. */
type GazetteFeed = {
  entry?: {
    title?: string;
    updated?: string;
    published?: string;
    category?: { term?: string; label?: string } | { term?: string; label?: string }[];
    // The Gazette embeds structured notice metadata under various keys across
    // editions; we read them defensively.
    'f:notice-code'?: string;
    id?: string;
    link?: unknown;
  }[];
};

export type GazetteFetchOptions = {
  postcode: string;
  radiusMiles?: number;
  /** As-of date (ISO) for days-since maths. Defaults to the current date. */
  asOf?: string;
  baseUrl?: string;
  /** Inject a feed directly (tests / dry-runs); bypasses HTTP entirely. */
  fixture?: GazetteFeed;
  /** Injectable transport (tests); defaults to the shared fail-soft fetchJson. */
  transport?: (url: string) => Promise<GazetteFeed>;
  log?: (m: string) => void;
};

const COMPANY_NUMBER_RE = /\b(?:company\s+(?:number|no\.?)\s*[:#]?\s*)?([0-9]{6,8}|[A-Z]{2}[0-9]{6})\b/i;

/** Normalise a company number: all-digit -> 8-wide zero-pad; else upper, no spaces. */
function normaliseCompanyNumber(raw: string): string {
  const c = raw.replace(/\s+/g, '').toUpperCase();
  return /^[0-9]+$/.test(c) ? c.padStart(8, '0') : c;
}

/** Pull a UK postcode out of a free-text notice title, upper-cased. */
function postcodeFromText(text: string): string | undefined {
  const m = text.toUpperCase().match(/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/);
  return m ? m[0].replace(/\s+/g, ' ').trim() : undefined;
}

/** Map a Gazette category/title into a short notice-type label. */
export function gazetteNoticeType(title: string, category: string): string {
  const hay = `${title} ${category}`.toLowerCase();
  if (hay.includes('winding') || hay.includes('winding-up') || hay.includes('winding up')) return 'winding-up';
  if (hay.includes('administrat')) return 'administration';
  if (hay.includes('receiver')) return 'receivership';
  if (hay.includes('strike') || hay.includes('dissolution')) return 'strike-off';
  if (hay.includes('voluntary arrangement') || hay.includes('cva')) return 'voluntary arrangement';
  if (hay.includes('liquidat')) return 'liquidation';
  if (hay.includes('petition')) return 'winding-up petition';
  return 'insolvency notice';
}

/** ISO yyyy-mm-dd from a Gazette date string, or undefined. */
function isoDate(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Whole days between an ISO event date and the as-of date (>= 0), or undefined. */
function daysBetween(eventIso: string | undefined, asOfIso: string | undefined): number | undefined {
  if (!eventIso || !asOfIso) return undefined;
  const ev = Date.parse(`${eventIso}T00:00:00Z`);
  const now = Date.parse(`${asOfIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ev) || Number.isNaN(now)) return undefined;
  return Math.max(0, Math.round((now - ev) / 86_400_000));
}

type GazetteCategory = { term?: string; label?: string };

function categoryLabel(cat: GazetteCategory | GazetteCategory[] | undefined): string {
  if (!cat) return '';
  const arr = Array.isArray(cat) ? cat : [cat];
  return arr.map((c) => `${c?.term ?? ''} ${c?.label ?? ''}`).join(' ');
}

/** Normalise a raw Gazette feed into typed forced-sale events. */
export function normaliseGazetteFeed(feed: GazetteFeed, asOf?: string): GazetteInsolvencyEvent[] {
  const entries = feed.entry ?? [];
  const out: GazetteInsolvencyEvent[] = [];
  for (const e of entries) {
    const title = (e.title ?? '').trim();
    if (!title) continue;
    const category = categoryLabel(e.category);
    const publishedDate = isoDate(e.published ?? e.updated);
    const numMatch = title.match(COMPANY_NUMBER_RE);
    out.push({
      companyName: title.split(/\s{2,}|,|\(/)[0]?.trim() || title,
      companyNumber: numMatch ? normaliseCompanyNumber(numMatch[1]) : undefined,
      noticeType: gazetteNoticeType(title, category),
      noticePostcode: postcodeFromText(title),
      publishedDate,
      daysSinceEvent: daysBetween(publishedDate, asOf),
    });
  }
  return out;
}

/**
 * Fetch recent Gazette insolvency notices around a postcode (postcode + radius),
 * normalised to typed forced-sale events. Fail-soft: any failure (or an injected
 * transport that throws) yields []. Never throws.
 */
export async function fetchGazetteInsolvency(opts: GazetteFetchOptions): Promise<GazetteInsolvencyEvent[]> {
  const log = opts.log ?? (() => {});
  const asOf = opts.asOf ?? new Date().toISOString();

  if (opts.fixture) {
    return normaliseGazetteFeed(opts.fixture, asOf);
  }

  const base = opts.baseUrl ?? GAZETTE_BASE;
  const radius = opts.radiusMiles ?? GAZETTE_RADIUS_MILES;
  const params = new URLSearchParams({
    'location-postcode-1': opts.postcode,
    'location-distance-1': String(radius),
    'results-page-size': '100',
  });
  const url = `${base.replace(/\/$/, '')}/insolvency/notice/data.json?${params.toString()}`;

  const transport = opts.transport ?? ((u: string) => fetchJson<GazetteFeed>(u));
  const feed = await failSoft(`gazette-insolvency ${opts.postcode}`, () => transport(url));
  if (!feed) {
    log(`Gazette insolvency: no data for ${opts.postcode} (fail-soft empty).`);
    return [];
  }
  const events = normaliseGazetteFeed(feed, asOf);
  log(`Gazette insolvency: ${events.length} notices near ${opts.postcode} (r=${radius}mi).`);
  return events;
}

/**
 * Index Gazette events for joining onto dwellings. Keyed by company_number (the
 * strongest join - this exact distressed owner) and by the EXACT notice postcode
 * (a specific door-level match, not a whole district - a district-wide match
 * would over-fire the strong forced-sale route across every dwelling in the
 * area). For a dwelling we prefer the company_number hit, then the exact-postcode
 * hit. Each key keeps only the most recent event (smallest days-since / latest).
 */
export type GazetteIndex = {
  byCompany: Map<string, GazetteInsolvencyEvent>;
  byPostcode: Map<string, GazetteInsolvencyEvent>;
};

/** Normalise a postcode to a single-spaced upper-case key ("s80  1aa" -> "S80 1AA"). */
export function normalisePostcodeKey(postcode: string | undefined): string {
  return (postcode ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** More-recent-wins comparator (smaller days-since, else later published date). */
function moreRecent(a: GazetteInsolvencyEvent, b: GazetteInsolvencyEvent): GazetteInsolvencyEvent {
  const da = a.daysSinceEvent ?? Number.POSITIVE_INFINITY;
  const db = b.daysSinceEvent ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? a : b;
  return (a.publishedDate ?? '') >= (b.publishedDate ?? '') ? a : b;
}

export function indexGazetteEvents(events: GazetteInsolvencyEvent[]): GazetteIndex {
  const byCompany = new Map<string, GazetteInsolvencyEvent>();
  const byPostcode = new Map<string, GazetteInsolvencyEvent>();
  for (const e of events) {
    if (e.companyNumber) {
      const prev = byCompany.get(e.companyNumber);
      byCompany.set(e.companyNumber, prev ? moreRecent(prev, e) : e);
    }
    const pc = normalisePostcodeKey(e.noticePostcode);
    if (pc) {
      const prev = byPostcode.get(pc);
      byPostcode.set(pc, prev ? moreRecent(prev, e) : e);
    }
  }
  return { byCompany, byPostcode };
}

// ── Companies House PSC (company / portfolio level only) ──────────────────────

/** One person with significant control over a company (approach-target metadata). */
export type PscControl = {
  companyNumber: string;
  /** Controlling person's name (approach target on an already company-keyed lead). */
  name?: string;
  kind?: string;
};

/** The Companies House PSC API response shape (subset). */
type PscResponse = {
  items?: { name?: string; kind?: string; ceased_on?: string }[];
};

const CH_BASE = 'https://api.company-information.service.gov.uk';

function chAuthHeader(): string | null {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) return null;
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

export type PscFetchOptions = {
  /** Inject a response directly (tests / dry-runs); bypasses HTTP entirely. */
  fixture?: PscResponse;
  /** Injectable transport (tests); defaults to the shared fail-soft fetchJson. */
  transport?: (url: string, auth: string) => Promise<PscResponse>;
};

/** Normalise a PSC API response into active control persons for a company. */
export function normalisePsc(companyNumber: string, res: PscResponse): PscControl[] {
  return (res.items ?? [])
    .filter((i) => !i.ceased_on) // active control only
    .map((i) => ({ companyNumber, name: i.name?.trim() || undefined, kind: i.kind }));
}

/**
 * Look up the persons with significant control for a company. Requires
 * COMPANIES_HOUSE_API_KEY; with no key (or on any failure) returns [] fail-soft.
 * Company-keyed only - never a person-level discovery call.
 */
export async function fetchPsc(companyNumber: string, opts: PscFetchOptions = {}): Promise<PscControl[]> {
  if (opts.fixture) return normalisePsc(companyNumber, opts.fixture);

  const auth = chAuthHeader();
  if (!auth) return []; // key not configured -> fail-soft empty

  const url = `${CH_BASE}/company/${companyNumber}/persons-with-significant-control?items_per_page=25`;
  const transport =
    opts.transport ?? ((u: string, a: string) => fetchJson<PscResponse>(u, { headers: { Authorization: a } }));
  const res = await failSoft(`ch-psc ${companyNumber}`, () => transport(url, auth));
  return res ? normalisePsc(companyNumber, res) : [];
}

/**
 * Portfolio-distress rollup (PURE). Given, per owning company, its active PSC
 * names and whether the company itself is distressed, count for each company how
 * many DISTRESSED companies its controlling person(s) also control, and surface
 * the best approach-target PSC name.
 *
 * A person controlling several distressed firms is a portfolio-level motivation
 * signal (a landlord unwinding a whole book), distinct from any single company's
 * own distress. Only distressed companies count toward the rollup total.
 */
export type CompanyPscInput = {
  companyNumber: string;
  distressed: boolean;
  pscNames: string[];
};

export type PscPortfolio = {
  /** Distinct distressed companies the controlling person(s) also control. */
  controlsDistressed: number;
  /** The PSC name behind the largest distressed portfolio (approach target). */
  pscName?: string;
};

function normalisePscName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function buildPscPortfolio(companies: CompanyPscInput[]): Map<string, PscPortfolio> {
  // 1. For each PSC name, the set of DISTRESSED company numbers they control.
  const distressedByPsc = new Map<string, Set<string>>();
  for (const c of companies) {
    if (!c.distressed) continue;
    for (const raw of c.pscNames) {
      const name = normalisePscName(raw);
      if (!name) continue;
      (distressedByPsc.get(name) ?? distressedByPsc.set(name, new Set()).get(name)!).add(c.companyNumber);
    }
  }

  // 2. For each company, the max distressed-portfolio size across its PSCs, and
  //    the name behind that maximum (the approach target).
  const out = new Map<string, PscPortfolio>();
  for (const c of companies) {
    let best = 0;
    let bestName: string | undefined;
    for (const raw of c.pscNames) {
      const name = normalisePscName(raw);
      const size = distressedByPsc.get(name)?.size ?? 0;
      if (size > best) {
        best = size;
        bestName = raw.trim();
      }
    }
    out.set(c.companyNumber, { controlsDistressed: best, pscName: bestName });
  }
  return out;
}

// ── The Gazette deceased-estates (probate) - PERSON-LEVEL, GDPR-GATED, OFF ─────

/**
 * Whether the person-level deceased-estates source is switched on. Off unless
 * RDR_ENABLE_DECEASED_ESTATES === 'true' is set deliberately AFTER a documented
 * UK GDPR lawful-basis / fairness review (see the module header). The default
 * scoring path never enables this, so no person-level notice data is ingested.
 */
export function deceasedEstatesEnabled(): boolean {
  return process.env.RDR_ENABLE_DECEASED_ESTATES === 'true';
}

/** One deceased-estate (Trustee Act s.27, code 2903) notice. Person-level. */
export type DeceasedEstateEvent = {
  deceasedName?: string;
  lastAddress?: string;
  noticePostcode?: string;
  publishedDate?: string;
  daysSinceEvent?: number;
};

export type DeceasedEstatesFetchOptions = {
  postcode: string;
  radiusMiles?: number;
  asOf?: string;
  baseUrl?: string;
  fixture?: GazetteFeed;
  transport?: (url: string) => Promise<GazetteFeed>;
  log?: (m: string) => void;
};

/**
 * Fetch Gazette deceased-estate notices around a postcode. GATED: returns []
 * WITHOUT making any request unless deceasedEstatesEnabled() is true. When (and
 * only when) the gate is deliberately opened after the lawful-basis review, it
 * behaves like the insolvency client (fail-soft, postcode + radius). Kept as its
 * own function so the person-level path is never reachable from the default run.
 */
export async function fetchGazetteDeceasedEstates(
  opts: DeceasedEstatesFetchOptions
): Promise<DeceasedEstateEvent[]> {
  const log = opts.log ?? (() => {});
  if (!deceasedEstatesEnabled()) {
    // GDPR gate closed: do not fetch, do not ingest any person-level notice data.
    log('Gazette deceased-estates: gate closed (RDR_ENABLE_DECEASED_ESTATES not set); skipping.');
    return [];
  }

  const asOf = opts.asOf ?? new Date().toISOString();
  if (opts.fixture) return normaliseDeceasedFeed(opts.fixture, asOf);

  const base = opts.baseUrl ?? GAZETTE_BASE;
  const radius = opts.radiusMiles ?? GAZETTE_RADIUS_MILES;
  const params = new URLSearchParams({
    'notice-code': '2903', // Trustee Act s.27 deceased-estates
    'location-postcode-1': opts.postcode,
    'location-distance-1': String(radius),
    'results-page-size': '100',
  });
  const url = `${base.replace(/\/$/, '')}/all-notices/notice/data.json?${params.toString()}`;
  const transport = opts.transport ?? ((u: string) => fetchJson<GazetteFeed>(u));
  const feed = await failSoft(`gazette-deceased ${opts.postcode}`, () => transport(url));
  return feed ? normaliseDeceasedFeed(feed, asOf) : [];
}

/** Normalise a raw deceased-estate feed. Only called when the gate is open. */
export function normaliseDeceasedFeed(feed: GazetteFeed, asOf?: string): DeceasedEstateEvent[] {
  const out: DeceasedEstateEvent[] = [];
  for (const e of feed.entry ?? []) {
    const title = (e.title ?? '').trim();
    if (!title) continue;
    const publishedDate = isoDate(e.published ?? e.updated);
    out.push({
      deceasedName: title.split(/,|\(/)[0]?.trim() || title,
      lastAddress: title,
      noticePostcode: postcodeFromText(title),
      publishedDate,
      daysSinceEvent: daysBetween(publishedDate, asOf),
    });
  }
  return out;
}
