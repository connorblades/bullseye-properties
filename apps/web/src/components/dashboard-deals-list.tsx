'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Clock, CheckCircle2, Sparkles, Loader2 } from 'lucide-react';
import { listDeals, type Deal } from '@/lib/deal-store';
import { SECTIONS } from '@/lib/sections';

function dealStageTitle(d: Deal): string {
  if (d.delivered) return 'Delivered';
  const idx = Math.max(0, Math.min(SECTIONS.length - 1, d.progress - 1));
  return SECTIONS[idx].short;
}

export function DashboardDealsList() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDeals()
      .then((rows) => {
        if (cancelled) return;
        setDeals(rows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load your deals.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center text-ink-muted">
        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
        <div className="text-sm">Loading your deals...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 bg-red-50 border-red-200 text-sm text-red-700">{error}</div>
    );
  }

  const active = deals.filter((d) => !d.delivered);
  const delivered = deals.filter((d) => d.delivered);

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

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-black/[0.06] flex items-center justify-between">
          <div className="font-bold text-ink">All deals</div>
          <div className="text-xs text-ink-muted">{SECTIONS.length} stages per deal</div>
        </div>
        <div>
          {deals.length === 0 && (
            <div className="px-6 py-10 text-center text-ink-muted text-sm space-y-3">
              <div>No deals yet.</div>
              <div>
                Start a new one above, or{' '}
                <Link href="/admin/seed" className="text-navy font-semibold inline-flex items-center gap-1">
                  <Sparkles size={12} /> seed the Browning Street demo
                </Link>{' '}
                to see the wizard with realistic data.
              </div>
            </div>
          )}
          {deals.map((d) => {
            const href = d.delivered ? `/dashboard` : `/deal/${d.id}/wizard/${d.progress}`;
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
