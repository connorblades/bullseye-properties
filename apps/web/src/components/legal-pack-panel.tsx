'use client';

/**
 * Stage 7 Legal Pack Analyser panel (M11 / AC-18).
 *
 * Replaces the Stage 7 placeholder. The partner uploads an auction legal pack
 * (PDF or DOCX); the file is sent to the `analyseLegalPackAction` Server Action,
 * where all extraction and Claude work happens server-side. The four-section
 * result renders here, the buyer-fees total auto-fills `auction.buyerFees`, and
 * the whole analysis persists on `deal.auction.legalPack`.
 *
 * This is a Client Component: it must NOT import the server-only analyser or the
 * server-only Claude internals - only the Server Action and the pure math in
 * the legal-pack lib. The client-bundle guard test enforces it by text-scanning
 * this file for those server import paths, so do not mention them here.
 */

import { useMemo, useRef, useState } from 'react';
import { Gavel, Upload, Loader2, AlertTriangle, FileText, X, Sparkles } from 'lucide-react';
import type { Deal } from '@/lib/deal-store';
import {
  feeAmount,
  feeBasisLabel,
  fundsRequired,
  totalBuyerFees,
  parseMoneyLoose,
  type Fee,
  type SdltMode,
  type LegalPackAnalysis,
} from '@/lib/legal-pack';
import { analyseLegalPackAction } from '@/server/actions/legal-pack';

type UpdateFn = (patch: Partial<Deal>) => void;

const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fmt(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function LegalPackPanel({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const set = (k: keyof Deal['auction'], v: string | boolean) => update({ auction: { ...deal.auction, [k]: v } });
  const isAuction = deal.source === 'auction' || deal.auction.isAuction;

  if (!isAuction) {
    return (
      <div className="card p-10 text-center">
        <div className="text-xs font-bold text-amber uppercase tracking-wider mb-3">Conditional stage</div>
        <h3 className="text-lg font-bold text-ink mb-2">Not an auction sale</h3>
        <p className="text-sm text-ink-mid mb-6">This stage is only required when the property is being sold by auction.</p>
        <button onClick={() => set('isAuction', true)} className="btn-secondary mx-auto">Mark as auction sale anyway</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AnalyserCard deal={deal} update={update} />
      <div className="card p-8 space-y-5">
        <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Manual overrides</div>
        <AuctionField label="Buyer-side fees (£)" value={deal.auction.buyerFees} onChange={(v) => set('buyerFees', v)} placeholder="2400" />
        <AuctionField label="Special conditions" value={deal.auction.specialConditions} onChange={(v) => set('specialConditions', v)} placeholder="2 flagged: extension overage, indemnity required" />
        <AuctionField label="Restrictive covenants" value={deal.auction.restrictiveCovenants} onChange={(v) => set('restrictiveCovenants', v)} placeholder="None" />
        <p className="text-xs text-ink-muted italic">
          The analyser auto-fills buyer-side fees from the pack. Edit any field to override.
        </p>
      </div>
    </div>
  );
}

function AuctionField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-center">
      <label className="text-xs font-bold text-ink-mid uppercase tracking-wider col-span-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="col-span-2 border border-black/[0.08] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 transition"
      />
    </div>
  );
}

function AnalyserCard({ deal, update }: { deal: Deal; update: UpdateFn }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const analysis = deal.auction.legalPack;

  const dealPrice = useMemo(
    () => parseMoneyLoose(deal.financials.purchasePrice) ?? parseMoneyLoose(deal.property.askingPrice) ?? 0,
    [deal.financials.purchasePrice, deal.property.askingPrice]
  );

  const pick = (f: File | null) => {
    setError(null);
    setWarning(null);
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await analyseLegalPackAction({
        dealId: deal.id,
        filename: file.name,
        mime: file.type || '',
        dataBase64,
        purchasePrice: dealPrice || undefined,
      });
      if (res.ok) {
        // Auto-fill buyer-side fees and persist the whole analysis on the deal.
        update({
          auction: { ...deal.auction, legalPack: res.analysis, buyerFees: String(res.analysis.buyerFees) },
        });
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
      } else if (res.manualEntry) {
        setWarning(res.error);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. Try again or enter the fees manually.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5 bg-amber/5 border-amber/20">
        <div className="flex items-center gap-2 mb-1">
          <Gavel size={16} className="text-amber" />
          <div className="text-xs font-bold text-amber uppercase tracking-wider">Legal Pack Analyser</div>
        </div>
        <div className="text-sm text-ink-mid">
          Upload the auction legal pack (PDF or Word). Claude extracts every buyer cost beyond the price and deposit,
          flags non-standard clauses, and totals the funds required. Analysis runs server-side.
        </div>
      </div>

      <div className="card p-6">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {!file ? (
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full border-2 border-dashed border-black/[0.12] rounded-xl py-8 text-center hover:border-navy/40 hover:bg-navy/[0.02] transition"
          >
            <Upload size={22} className="mx-auto text-ink-muted mb-2" />
            <div className="text-sm font-bold text-ink">Upload legal pack</div>
            <div className="text-xs text-ink-muted mt-1">PDF or Word (.docx). Special Conditions and addendum are the priority documents.</div>
          </button>
        ) : (
          <div className="flex items-center gap-3 border border-black/[0.08] rounded-lg px-4 py-3">
            <FileText size={18} className="text-navy flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{file.name}</div>
              <div className="text-xs text-ink-muted">{(file.size / 1024).toFixed(0)} KB</div>
            </div>
            {!busy && (
              <button onClick={() => pick(null)} className="text-ink-muted hover:text-red-500" aria-label="Remove file"><X size={18} /></button>
            )}
          </div>
        )}

        <button
          onClick={run}
          disabled={!file || busy}
          className="btn-primary w-full mt-4 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? 'Analysing pack...' : 'Analyse legal pack'}
        </button>

        {error && (
          <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}
        {warning && (
          <div className="mt-3 flex items-start gap-2 bg-amber/10 border border-amber/30 rounded-lg p-3 text-sm text-amber-900">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> {warning}
          </div>
        )}
      </div>

      {analysis && <ResultView analysis={analysis} dealPrice={dealPrice} />}
    </div>
  );
}

function VatBadge({ v }: { v: Fee['vatApplies'] }) {
  const cls =
    v === 'Yes' ? 'bg-amber/15 text-amber-900' : v === 'No' ? 'bg-black/[0.05] text-ink-mid' : 'bg-navy/[0.08] text-navy';
  const label = v === 'Yes' ? '+VAT' : v === 'No' ? 'No VAT' : 'TBC';
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function ResultView({ analysis, dealPrice }: { analysis: LegalPackAnalysis; dealPrice: number }) {
  // Recompute at the live deal price where available, else the price used at analysis time.
  const [price, setPrice] = useState<number>(dealPrice || analysis.purchasePriceUsed || 0);
  const [sdltMode, setSdltMode] = useState<SdltMode>('additional');

  const fees = analysis.fees;
  const totals = useMemo(() => totalBuyerFees(fees, price), [fees, price]);
  const funds = useMemo(() => fundsRequired({ price, fees, sdltMode }), [price, fees, sdltMode]);

  return (
    <div className="space-y-4">
      {analysis.warning && (
        <div className="card p-4 bg-amber/10 border-amber/30 flex items-start gap-2 text-sm text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> {analysis.warning}
        </div>
      )}

      {/* Price control */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-bold text-ink-mid uppercase tracking-wider mb-1">Purchase price</div>
            <div className="text-xs text-ink-muted">Drives percentage fees and the funds-required total.</div>
          </div>
          <div className="flex items-center border border-black/[0.1] rounded-lg overflow-hidden">
            <span className="px-3 py-2 text-sm font-bold text-navy bg-navy/[0.05] border-r border-black/[0.08]">£</span>
            <input
              type="number"
              value={price || ''}
              min={0}
              step={1000}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              className="px-3 py-2 text-sm w-40 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Section 1 - fees */}
      <div className="card p-6">
        <SectionHead n={1} label="Additional costs to the buyer" />
        {fees.length === 0 ? (
          <p className="text-sm text-ink-muted italic">No additional buyer fees identified in the pack.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted uppercase tracking-wider">
                  <th className="pb-2 pr-3 font-bold">Fee</th>
                  <th className="pb-2 px-3 font-bold">Basis</th>
                  <th className="pb-2 px-3 font-bold">Amount</th>
                  <th className="pb-2 px-3 font-bold">VAT</th>
                  <th className="pb-2 pl-3 font-bold">When payable</th>
                </tr>
              </thead>
              <tbody>
                {fees.map((f, i) => {
                  const amt = feeAmount(f, price);
                  return (
                    <tr key={i} className="border-t border-black/[0.06] align-top">
                      <td className="py-2.5 pr-3 font-semibold text-ink">
                        {f.name}
                        {f.note && <div className="text-xs text-ink-muted font-normal">{f.note}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-ink-mid text-xs">{feeBasisLabel(f)}</td>
                      <td className="py-2.5 px-3 font-bold text-navy whitespace-nowrap">{amt === null ? <span className="text-ink-muted font-normal">Variable</span> : fmt(amt)}</td>
                      <td className="py-2.5 px-3"><VatBadge v={f.vatApplies} /></td>
                      <td className="py-2.5 pl-3 text-ink-mid text-xs">{f.whenPayable}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy/40">
                  <td colSpan={2} className="pt-3 text-xs font-semibold text-ink-mid">Total additional costs (excl. price and deposit)</td>
                  <td className="pt-3 px-3 font-black text-navy whitespace-nowrap">{fmt(totals.total)}{totals.hasVariable ? ' + variable' : ''}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Section 2 - clauses */}
      <div className="card p-6">
        <SectionHead n={2} label="Key contractual terms" />
        {analysis.clauses.length === 0 ? (
          <p className="text-sm text-ink-muted italic">No non-standard clauses identified.</p>
        ) : (
          <div className="space-y-2">
            {analysis.clauses.map((c, i) => {
              const cls = c.severity === 'High' ? 'border-red-300 bg-red-50' : c.severity === 'Medium' ? 'border-amber/40 bg-amber/5' : 'border-black/[0.08] bg-bg';
              const sevCls = c.severity === 'High' ? 'bg-red-100 text-red-700' : c.severity === 'Medium' ? 'bg-amber/20 text-amber-900' : 'bg-black/[0.06] text-ink-mid';
              return (
                <div key={i} className={`border rounded-lg p-3 ${cls}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sevCls}`}>{c.severity}</span>
                    <span className="text-sm font-bold text-ink">{c.question}</span>
                  </div>
                  <p className="text-sm text-ink-mid leading-relaxed">{c.answer}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3 - variable / unknown costs */}
      {analysis.notes.length > 0 && (
        <div className="card p-6">
          <SectionHead n={3} label="Variable and unknown costs" />
          <ul className="space-y-1.5">
            {analysis.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink-mid">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-muted mt-2 flex-shrink-0" /> {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Section 4 - summary */}
      <div className="card p-6">
        <SectionHead n={4} label="Summary" />
        <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{analysis.clientSummary || 'No summary generated.'}</p>
      </div>

      {/* Funds required */}
      <div className="card p-6 bg-navy/[0.03] border-navy/20">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-navy uppercase tracking-wider">Total funds required</div>
          <div className="flex gap-1">
            {(['standard', 'additional', 'overseas'] as SdltMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setSdltMode(m)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded border transition ${sdltMode === m ? 'border-navy bg-navy text-white' : 'border-black/[0.1] text-ink-mid hover:border-navy/30'}`}
              >
                {m === 'standard' ? 'Standard' : m === 'additional' ? 'BTL +5%' : 'Overseas +2%'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5 text-sm">
          <FundsRow label="Deposit (10%) on exchange" value={fmt(funds.deposit)} />
          <FundsRow label="Balance on completion" value={fmt(funds.balance)} />
          <FundsRow label="Additional buyer costs" value={fmt(funds.additionalCosts) + (funds.hasVariableCosts ? ' + variable' : '')} />
          <FundsRow label="Stamp Duty (estimate, verify with solicitor)" value={fmt(funds.sdlt)} />
          <FundsRow label="Sourcing fee" value={fmt(funds.sourcingFee)} />
          <FundsRow label="Legal fees" value={fmt(funds.legalFees)} />
          <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-navy/40">
            <span className="text-sm font-bold text-ink">Total funds required</span>
            <span className="text-xl font-black text-navy">{fmt(funds.total)}</span>
          </div>
        </div>
        <p className="text-xs text-ink-muted mt-4">
          AI-assisted analysis for internal use only. Not legal advice. Always instruct a qualified solicitor before exchange.
          Analysed {new Date(analysis.analysedAt).toLocaleDateString('en-GB')} from {analysis.sourceFilename}.
        </p>
      </div>
    </div>
  );
}

function SectionHead({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-6 h-6 rounded-full bg-navy text-white text-xs font-black flex items-center justify-center flex-shrink-0">{n}</span>
      <span className="text-sm font-black text-ink">{label}</span>
    </div>
  );
}

function FundsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-mid">{label}</span>
      <span className="font-bold text-ink whitespace-nowrap">{value}</span>
    </div>
  );
}
