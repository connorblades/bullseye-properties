'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, Loader2, MapPin, Sparkles, Target, X } from 'lucide-react';
import { Nav } from '@/components/nav';
import { signOut } from '@/server/actions/auth';
import {
  listPendingCandidates,
  approveCandidate,
  discardCandidate,
} from '@/server/actions/lead-review';
import type { LeadCandidate } from '@/server/db/schema';
import type { ScrapedCandidate } from '@/lib/lead-intake';

/**
 * Daily Deal Review inbox (M5, Stage 4).
 *
 * Loads the tenant's pending lead_candidates (best-fit first, radar confidence
 * breaks ties) and lets a partner triage them one card at a time. Approve
 * promotes the candidate to a real deal at pipelineStage 'leads' and surfaces a
 * link to the pipeline; Discard drops it. Both mutate through the tenant-scoped
 * server actions and remove the card optimistically.
 */

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');

/** Fit badge tone, matching the /lead/new + pipeline colour bands. */
function fitTone(pct: number): string {
  if (pct >= 75) return 'text-success bg-success-light';
  if (pct >= 50) return 'text-amber-700 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

/** Read the radar block off a stored candidate row (jsonb, best-effort). */
function radarOf(row: LeadCandidate): ScrapedCandidate['radar'] {
  const cand = row.candidate as ScrapedCandidate | undefined;
  return cand?.radar;
}

/** Guide/asking price off a stored candidate row. */
function priceOf(row: LeadCandidate): { label: string; value: number } | null {
  const cand = row.candidate as ScrapedCandidate | undefined;
  if (typeof cand?.guidePrice === 'number') return { label: 'Guide', value: cand.guidePrice };
  if (typeof cand?.askingPrice === 'number') return { label: 'Asking', value: cand.askingPrice };
  return null;
}

export default function ReviewPage() {
  const [rows, setRows] = useState<LeadCandidate[] | null>(null);
  const [approvedDeal, setApprovedDeal] = useState<{ address: string; dealId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    listPendingCandidates()
      .then((data) => {
        if (live) setRows(data);
      })
      .catch(() => {
        if (live) {
          setError('Could not load the review queue. Please refresh.');
          setRows([]);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  function onApprove(row: LeadCandidate) {
    setError(null);
    setPendingId(row.id);
    startTransition(async () => {
      try {
        const dealId = await approveCandidate(row.id);
        setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
        setApprovedDeal({ address: row.address ?? 'Lead', dealId });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not approve this lead. Please try again.');
      } finally {
        setPendingId(null);
      }
    });
  }

  function onDiscard(row: LeadCandidate) {
    setError(null);
    setPendingId(row.id);
    startTransition(async () => {
      try {
        await discardCandidate(row.id);
        setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not discard this lead. Please try again.');
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="min-h-screen">
      <Nav signOutAction={signOut} />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="badge mb-3">Daily review</div>
        <h1 className="text-3xl font-black text-ink mb-2">Deal Review</h1>
        <p className="text-sm text-ink-mid mb-8 max-w-xl">
          Fresh matches against your clients&rsquo; criteria, best fit first. Approve to drop a lead
          onto the pipeline, or discard to clear it.
        </p>

        {approvedDeal && (
          <div className="card p-4 mb-6 flex items-center justify-between gap-4 border-success/30 bg-success-light/40">
            <div className="flex items-center gap-2 text-sm text-success-dark">
              <Check size={16} />
              <span>
                <span className="font-bold">{approvedDeal.address}</span> approved and added to the
                pipeline.
              </span>
            </div>
            <Link href="/pipeline" className="text-sm font-bold text-navy hover:text-navy-dark whitespace-nowrap">
              View pipeline
            </Link>
          </div>
        )}

        {error && (
          <div
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-6"
            role="alert"
          >
            {error}
          </div>
        )}

        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted py-16 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading matches...
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-navy/[0.06] flex items-center justify-center mx-auto mb-4">
              <Sparkles size={20} className="text-navy" />
            </div>
            <div className="text-lg font-black text-ink mb-1">No new matches today</div>
            <p className="text-sm text-ink-muted max-w-sm mx-auto">
              The review queue is clear. New candidates land here as they come in.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              const radar = radarOf(row);
              const price = priceOf(row);
              const fit = row.fitPct ?? 0;
              const busy = pendingId === row.id;
              const reasons = radar?.discountReasons ?? [];
              return (
                <div key={row.id} className="card p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-black text-ink text-lg leading-snug">
                        {row.address ?? 'Unknown address'}
                      </div>
                      {(row.postcode || row.client) && (
                        <div className="flex items-center gap-1.5 text-sm text-ink-muted mt-0.5">
                          <MapPin size={13} />
                          {[row.postcode, row.client].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-baseline gap-1 text-xs font-bold px-2.5 py-1 rounded ${fitTone(fit)}`}
                    >
                      <span className="text-base font-black">{fit}%</span> fit
                    </span>
                  </div>

                  {/* Pricing + valuation */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                    {price && (
                      <div className="rounded-lg bg-black/[0.02] border border-black/[0.04] px-3 py-2">
                        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                          {price.label} price
                        </div>
                        <div className="text-sm font-black text-ink">{gbp(price.value)}</div>
                      </div>
                    )}
                    {typeof radar?.estMarketValue === 'number' && (
                      <div className="rounded-lg bg-black/[0.02] border border-black/[0.04] px-3 py-2">
                        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                          Est. market value
                        </div>
                        <div className="text-sm font-black text-ink">{gbp(radar.estMarketValue)}</div>
                      </div>
                    )}
                    {typeof radar?.estAchievable === 'number' && (
                      <div className="rounded-lg bg-black/[0.02] border border-black/[0.04] px-3 py-2">
                        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                          Est. achievable
                        </div>
                        <div className="text-sm font-black text-ink">{gbp(radar.estAchievable)}</div>
                      </div>
                    )}
                  </div>

                  {/* Deal Radar */}
                  {(typeof radar?.discountConfidence === 'number' || reasons.length > 0) && (
                    <div className="mt-4 rounded-lg border border-navy/10 bg-navy/[0.03] px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Target size={14} className="text-navy" />
                        <span className="text-[11px] font-bold text-ink-mid uppercase tracking-wider">
                          Deal Radar
                        </span>
                        {typeof radar?.discountConfidence === 'number' && (
                          <span className="text-[11px] font-bold text-navy">
                            {Math.round(radar.discountConfidence * 100)}% discount confidence
                          </span>
                        )}
                      </div>
                      {reasons.length > 0 && (
                        <ol className="space-y-1">
                          {reasons.map((reason, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-ink-mid">
                              <span className="font-black text-navy tabular-nums">{i + 1}.</span>
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-3 mt-5">
                    <button
                      type="button"
                      onClick={() => onApprove(row)}
                      disabled={busy}
                      className="btn-primary justify-center disabled:opacity-60"
                    >
                      {busy ? (
                        <>
                          <Loader2 size={16} className="animate-spin" /> Working...
                        </>
                      ) : (
                        <>
                          <Check size={16} /> Approve
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDiscard(row)}
                      disabled={busy}
                      className="inline-flex items-center gap-2 text-sm font-bold text-ink-mid hover:text-red-600 transition disabled:opacity-60"
                    >
                      <X size={16} /> Discard
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
