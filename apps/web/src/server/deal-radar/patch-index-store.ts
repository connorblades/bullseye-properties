/**
 * Patch-index storage + cached loader (BSE-OPP-P01 M5, AC-09/AC-10).
 *
 * Publishes the locally-built Deal Radar patch index to a private Supabase Storage
 * bucket and loads it back in the cloud, so the in-platform on-market discount
 * scorer (M2) and off-market negotiability scorer (M3) enrich a listing on Vercel
 * without hosting the raw ~4.7GB Land Registry / EPC / CCOD-OCOD / Companies House
 * files. The published artifact is the derived patch slice only (gzipped JSON, tens
 * of MB), carries NO person-level fields while the gate is off, and is a fraction of
 * the raw input size (AC-10).
 *
 * Load order (per scorer, artifact download shared + cached across both):
 *   1. the published artifact (cloud, or dev with SUPABASE creds + a prior publish);
 *   2. a local streaming build from RDR_DATA_DIR (dev on Connor's Mac);
 *   3. neither -> the local build throws, the caller (lead-review) catches it and
 *      ingests the lead un-enriched (the existing fail-soft contract, unchanged).
 *
 * This module deliberately creates its OWN service-role client rather than importing
 * `server/storage/admin` (which is `server-only`), so the publish Trigger task can
 * use it outside an RSC bundle. It is server-side by construction: it imports
 * `node:zlib` and dynamically imports the multi-GB streamers, so it can never be
 * pulled into a client bundle.
 */

import { gzipSync, gunzipSync } from 'node:zlib';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  deserializePatchIndex,
  type SerializedPatchIndex,
} from './patch-index-serialization';
import type { CompIndex } from './auction-match';
import type { PatchPropensityIndex } from './ingest-stock';

/** Private bucket created by migration 0011 (mirrors the deal-packs bucket, 0004). */
export const PATCH_INDEX_BUCKET = 'patch-index';
/** The pointer object the cloud loader always reads (overwritten on each publish). */
export const PATCH_INDEX_LATEST_KEY = 'latest.json.gz';
/** Per-publish immutable object key, kept for history / rollback. */
export function patchIndexVersionKey(version: string): string {
  return `${version}.json.gz`;
}

// ── Pure pack / unpack (gzip <-> serialized index; no IO, unit-testable) ───────

export function packPatchIndex(s: SerializedPatchIndex): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(s), 'utf8'));
}

export function unpackPatchIndex(buf: Buffer): SerializedPatchIndex {
  return JSON.parse(gunzipSync(buf).toString('utf8')) as SerializedPatchIndex;
}

// ── Service-role client (own instance; see module note on server-only) ─────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

// ── Publish (called by the local Trigger task) ─────────────────────────────────

export type PublishResult = {
  version: string;
  builtAt: string;
  latestKey: string;
  versionKey: string;
  gzBytes: number;
  personLevel: boolean;
};

/**
 * Gzip + upload a serialized index to both the immutable version key and the
 * `latest` pointer (service-role write, upsert - mirrors the deal-packs bucket).
 */
export async function uploadPatchIndexArtifact(s: SerializedPatchIndex): Promise<PublishResult> {
  const buf = packPatchIndex(s);
  const sb = admin();
  const versionKey = patchIndexVersionKey(s.version);
  for (const key of [versionKey, PATCH_INDEX_LATEST_KEY]) {
    const { error } = await sb.storage
      .from(PATCH_INDEX_BUCKET)
      .upload(key, buf, { contentType: 'application/gzip', upsert: true });
    if (error) throw new Error(`Patch-index upload failed (${key}): ${error.message}`);
  }
  return {
    version: s.version,
    builtAt: s.builtAt,
    latestKey: PATCH_INDEX_LATEST_KEY,
    versionKey,
    gzBytes: buf.length,
    personLevel: s.personLevel,
  };
}

// ── Cached artifact load (shared by both scorers) + local fallback ─────────────

type LoadedArtifact = { comp: CompIndex; propensity: PatchPropensityIndex };

/**
 * Download + rehydrate the published artifact, or null when it is absent / the
 * SUPABASE env is not set / the fetch or parse fails (all fail-soft - the caller
 * then falls back to a local build). Never throws.
 */
async function tryLoadArtifact(): Promise<LoadedArtifact | null> {
  try {
    const { data, error } = await admin().storage.from(PATCH_INDEX_BUCKET).download(PATCH_INDEX_LATEST_KEY);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return deserializePatchIndex(unpackPatchIndex(buf));
  } catch {
    return null;
  }
}

let _artifactCache: Promise<LoadedArtifact | null> | null = null;
function loadArtifactCached(): Promise<LoadedArtifact | null> {
  if (!_artifactCache) _artifactCache = tryLoadArtifact();
  return _artifactCache;
}

/** Test seam: drop the module-level artifact cache. */
export function __resetPatchIndexCache(): void {
  _artifactCache = null;
}

/**
 * The comp index for the on-market discount scorer: the published artifact when
 * present, else a local streaming build (which throws when RDR_DATA_DIR is absent -
 * the caller's fail-soft try/catch then skips scoring).
 */
export async function loadCompIndex(): Promise<CompIndex> {
  const artifact = await loadArtifactCached();
  if (artifact) return artifact.comp;
  const { buildPatchCompIndex } = await import('./ingest-auction');
  const { index } = await buildPatchCompIndex();
  return index;
}

/**
 * The propensity index for the off-market negotiability scorer: the published
 * artifact when present, else a local streaming build (throws when the data is
 * absent - caught upstream, fail-soft). Shares the same cached artifact download as
 * loadCompIndex, so the cloud fetches the artifact once per process for both.
 */
export async function loadPropensityIndex(): Promise<PatchPropensityIndex> {
  const artifact = await loadArtifactCached();
  if (artifact) return artifact.propensity;
  const { buildPatchPropensityIndex } = await import('./ingest-stock');
  return buildPatchPropensityIndex();
}
