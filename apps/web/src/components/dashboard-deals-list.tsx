'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Clock, CheckCircle2, RotateCcw } from 'lucide-react';
import { listDeals, seedDemoDealsIfEmpty, deleteAll, type Deal } from '@/lib/deal-store';
import { SECTIONS } from '@/lib/sections';

function dealStageTitle(d: Deal): string {
  if (d.delivered) return 'Delivered';
  const idx = Math.max(0, Math.min(SECTIONS.length - 1, d.progress - 1));
  return SECTIONS[idx].short;
}

export function DashboardDealsList() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    seedDemoDealsIfEmpty();
    setDeals(listDeals().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }, []);

  if (!mounted) return null;

  const active = deals.filter((d) => !d.delivered);
  const delivered = deals.filter((d) => d.delivered);

  function handleReset() {
    if (!window.confirm('Wipe all local deals and re-seed the demo data?\n\nThis cannot be undone.')) return;
    deleteAll();
    seedDemoDealsIfEmpty();
    window.location.reload();
  }

  return (
    <>
      <div className="grid md:grid-cols-3 gap-4 mb-10">
        {[
          { label: 'Active deals',         value: String(active.length),     icon: Clock },
          { label: 'Delivered this month', value: String(delivered.length),  icon: CheckCircle2 },
          { label: 'Reports generated',    value: String(delivered.length),  icon: FileText },
        ].map((s) => (
          <div key={s.label} className="card p-6 flex items-center gap-4">
            <div className="w-12 h-12 bg-navy/[0.08] rounded-xl flex items-center justify-center text-navy">
              <s.icon size={22} />
            </div>
            <div>
              <div className="text-2xl font-black text-ink leading-none mb-1">{s.value}</div>
              <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-2 text-xs font-semibold text-ink-muted hover:text-red-500 border border-black/[0.08] rounded-lg px-3 py-2 transition"
          title="Wipe local storage and re-seed demo data"
        >
          <RotateCcw size={14} /> Reset demo
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-black/[0.06] flex items-center justify-between">
          <div className="font-bold text-ink">All deals</div>
          <div className="text-xs text-ink-muted">{SECTIONS.length} stages per deal</div>
        </div>
        <div>
          {deals.length === 0 && (
            <div className="px-6 py-10 text-center text-ink-muted text-sm">No deals yet. Start one above.</div>
          )}
          {deals.map((d) => {
            const href = d.delivered ? `/deal/${d.id}/report` : `/deal/${d.id}/wizard/${d.progress}`;
            return (
              <Link
                key={d.id}
                href={href}
                className="block px-6 py-5 border-b border-black/[0.04] last:border-b-0 hover:bg-bg transition"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-bold text-ink">{d.address || '(no address yet)'}</div>
                    <div className="text-xs text-ink-mid mt-0.5">For {d.client || '(no client yet)'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-ink-mid font-semibold">
                      Stage: <span className="text-navy">{dealStageTitle(d)}</span>
                    </div>
                    {d.delivered ? (
                      <span className="text-xs font-bold text-success bg-success-light px-2.5 py-1 rounded">Delivered</span>
                    ) : (
                      <span className="text-xs font-bold text-navy bg-navy/[0.08] px-2.5 py-1 rounded">{d.progress} / {SECTIONS.length}</span>
                    )}
                  </div>
                </div>
                <div className="h-1.5 bg-black/[0.05] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${d.delivered ? 'bg-success' : 'bg-gradient-to-r from-navy to-navy-light'}`}
                    style={{ width: `${(d.progress / SECTIONS.length) * 100}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
