'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus } from 'lucide-react';
import { listDeals, type Deal } from '@/lib/deal-store';
import { updateDealById } from '@/server/actions/deals';
import { PIPELINE_COLUMNS, effectivePipelineStage, type PipelineColumnKey } from '@/lib/pipeline';
import { SECTIONS } from '@/lib/sections';

const TONE_BADGE: Record<string, string> = {
  navy: 'text-navy bg-navy/[0.08]',
  success: 'text-success bg-success-light',
  red: 'text-red-600 bg-red-50',
  amber: 'text-amber-700 bg-amber-50',
};

function stageLabel(d: Deal): string {
  if (d.delivered) return 'Delivered';
  const idx = Math.max(0, Math.min(SECTIONS.length - 1, d.progress - 1));
  return SECTIONS[idx].short;
}

const EMPTY_COLUMNS = (): Record<PipelineColumnKey, Deal[]> => ({
  leads: [], sourcing: [], viewing: [], analysis: [], report: [], offer: [], won: [], lost: [], followup: [],
});

export function PipelineBoard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDeals()
      .then((rows) => { if (!cancelled) setDeals(rows); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load deals.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const move = (id: string, stage: PipelineColumnKey) => {
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, pipelineStage: stage } : d)));
    // Fire-and-forget; persisted into the deal inputs jsonb.
    updateDealById(id, { pipelineStage: stage }).catch(() => {
      setError('Could not save the move. Refresh and try again.');
    });
  };

  if (loading) {
    return (
      <div className="card p-10 text-center text-ink-muted">
        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
        <div className="text-sm">Loading pipeline...</div>
      </div>
    );
  }
  if (error) {
    return <div className="card p-6 bg-red-50 border-red-200 text-sm text-red-700">{error}</div>;
  }

  const byColumn = EMPTY_COLUMNS();
  for (const d of deals) byColumn[effectivePipelineStage(d)].push(d);

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-max">
        {PIPELINE_COLUMNS.map((col) => {
          const items = byColumn[col.key];
          return (
            <div key={col.key} className="w-72 flex-shrink-0">
              <div className="flex items-center justify-between mb-3 px-1">
                <div>
                  <div className="font-bold text-ink text-sm">{col.label}</div>
                  <div className="text-[11px] text-ink-muted">{col.hint}</div>
                </div>
                <span className={`text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center ${TONE_BADGE[col.tone]}`}>
                  {items.length}
                </span>
              </div>

              <div className="space-y-3">
                {col.key === 'leads' && (
                  <Link
                    href="/deal/new"
                    className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-black/[0.1] py-3 text-xs font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition"
                  >
                    <Plus size={14} /> Add lead
                  </Link>
                )}

                {items.length === 0 && col.key !== 'leads' && (
                  <div className="rounded-xl border border-dashed border-black/[0.1] py-8 text-center text-xs text-ink-muted">
                    Nothing here
                  </div>
                )}

                {items.map((d) => (
                  <div key={d.id} className="card p-4">
                    <Link
                      href={d.delivered ? `/deal/${d.id}/wizard/15` : `/deal/${d.id}/wizard/${d.progress}`}
                      className="block hover:opacity-80 transition"
                    >
                      <div className="font-bold text-ink text-sm leading-snug mb-1">
                        {d.address || '(no address yet)'}
                      </div>
                      <div className="text-xs text-ink-mid mb-3">For {d.client || '(no client yet)'}</div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] text-ink-muted font-semibold uppercase tracking-wide">
                          {stageLabel(d)}
                        </span>
                        {d.delivered ? (
                          <span className="text-[10px] font-bold text-success bg-success-light px-2 py-0.5 rounded">Delivered</span>
                        ) : (
                          <span className="text-[10px] font-bold text-navy bg-navy/[0.08] px-2 py-0.5 rounded">
                            {d.progress} / {SECTIONS.length}
                          </span>
                        )}
                      </div>
                    </Link>
                    <select
                      value={col.key}
                      onChange={(e) => move(d.id, e.target.value as PipelineColumnKey)}
                      className="w-full text-xs border border-black/[0.1] rounded-lg px-2 py-1.5 bg-white text-ink-mid focus:outline-none focus:ring-2 focus:ring-navy/30"
                      aria-label="Move to stage"
                    >
                      {PIPELINE_COLUMNS.map((c) => (
                        <option key={c.key} value={c.key}>Move to: {c.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
