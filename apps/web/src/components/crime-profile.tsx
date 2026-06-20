'use client';

import type { CrimeStats } from '@/lib/deal-store';
import { ShieldCheck, ShieldAlert, Minus } from 'lucide-react';

export function CrimeProfile({ stats }: { stats?: CrimeStats }) {
  if (!stats) {
    return (
      <div className="text-sm text-ink-muted bg-bg rounded-lg p-6 text-center">
        No crime data pulled yet. Production source: <span className="font-mono text-xs">data.police.uk/api</span>
      </div>
    );
  }

  const max = Math.max(...stats.breakdown.map((b) => b.count));
  const tone =
    stats.comparison === 'lower' ? { Icon: ShieldCheck, c: 'text-success-dark bg-success-light border-success/30' }
    : stats.comparison === 'higher' ? { Icon: ShieldAlert, c: 'text-red-700 bg-red-50 border-red-200' }
    : { Icon: Minus, c: 'text-amber bg-amber/15 border-amber/30' };
  const Icon = tone.Icon;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-bg rounded-lg p-4">
          <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">Last 12 months</div>
          <div className="text-2xl font-black text-ink">{stats.total12mo}</div>
          <div className="text-xs text-ink-mid mt-1">incidents</div>
        </div>
        <div className="bg-bg rounded-lg p-4">
          <div className="text-xs text-ink-muted font-semibold uppercase tracking-wider mb-1">Per 1,000 population</div>
          <div className="text-2xl font-black text-ink">{stats.per1000}</div>
          <div className="text-xs text-ink-mid mt-1">District avg {stats.districtAvg}</div>
        </div>
        <div className={`rounded-lg p-4 border ${tone.c}`}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-80">vs district</div>
          <div className="text-base font-black flex items-center gap-2">
            <Icon size={18} />
            {stats.comparisonPct}
          </div>
        </div>
      </div>

      <div className="bg-bg rounded-lg p-5">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-3">Breakdown by category</div>
        <div className="space-y-2">
          {stats.breakdown.map((b) => (
            <div key={b.category} className="grid grid-cols-12 items-center gap-3 text-xs">
              <div className="col-span-4 text-ink font-semibold truncate" title={b.category}>{b.category}</div>
              <div className="col-span-7 bg-white rounded h-5 overflow-hidden relative">
                <div
                  className="h-full bg-gradient-to-r from-navy to-navy-light"
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </div>
              <div className="col-span-1 text-right font-bold text-ink tabular-nums">{b.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-ink-muted italic">
        Source: data.police.uk - 12-month rolling window. Heatmap overlay shipped in M2.
      </div>
    </div>
  );
}
