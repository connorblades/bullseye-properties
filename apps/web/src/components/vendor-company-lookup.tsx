'use client';

import { useState } from 'react';
import { Building2, Loader2, AlertTriangle, Search } from 'lucide-react';
import type { VendorCompany } from '@/lib/deal-store';
import { lookupVendorCompany } from '@/server/actions/public-data';

export function VendorCompanyLookup({
  dealId,
  company,
  onResult,
}: {
  dealId: string;
  company?: VendorCompany;
  onResult: (c: VendorCompany) => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await lookupVendorCompany(dealId, query);
      if (res.ok && res.company) onResult(res.company);
      else setError(res.message);
    } catch {
      setError('Lookup failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const statusTone =
    company?.status === 'active' ? 'text-success-dark bg-success-light'
    : company ? 'text-red-700 bg-red-50'
    : 'text-ink-mid bg-bg';

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder="Vendor company name or number (e.g. 09876543)"
          className="flex-1 border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
        <button onClick={run} disabled={busy || !query.trim()} className="btn-secondary text-xs disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Look up
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-amber bg-amber/10 border border-amber/20 rounded-lg p-3">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {company && (
        <div className="bg-bg rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-navy" />
              <div>
                <div className="font-bold text-ink text-sm">{company.companyName}</div>
                <div className="text-xs text-ink-muted font-mono">{company.companyNumber}{company.type ? ` · ${company.type}` : ''}</div>
              </div>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${statusTone}`}>
              {company.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-ink-mid">
            {company.incorporatedOn && <div>Incorporated {company.incorporatedOn}</div>}
            {company.chargesCount != null && <div>{company.chargesCount} charge(s)</div>}
            {company.registeredOffice && <div className="col-span-2 truncate" title={company.registeredOffice}>Reg. office: {company.registeredOffice}</div>}
          </div>

          {company.hasInsolvency && (
            <div className="flex items-center gap-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
              <AlertTriangle size={14} /> Insolvency history on record
            </div>
          )}

          {company.officers.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">Officers</div>
              <ul className="text-xs text-ink-mid space-y-0.5">
                {company.officers.filter((o) => !o.resignedOn).slice(0, 6).map((o, i) => (
                  <li key={i}>
                    <span className="font-semibold text-ink">{o.name}</span>
                    <span className="text-ink-muted"> · {o.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[10px] text-ink-muted italic">Source: Companies House.</div>
        </div>
      )}
    </div>
  );
}
