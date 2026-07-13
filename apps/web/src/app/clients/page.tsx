'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, Upload, Users, X } from 'lucide-react';
import { Nav } from '@/components/nav';
import { signOut } from '@/server/actions/auth';
import {
  listInvestorCriteria,
  createInvestorCriteria,
  bulkCreateInvestorCriteria,
  updateInvestorCriteria,
  deleteInvestorCriteria,
  type InvestorCriteriaInput,
} from '@/server/actions/investor-criteria';
import { parseInvestorCsv } from '@/lib/investor-csv';
import type { InvestorCriteriaRow } from '@/server/db/schema';

/**
 * Network investor-criteria store (BSE-OPP-P01 M1).
 *
 * The management surface for the moonshot's compounding asset: each investor
 * brief added here lifts match coverage for every future lead. A partner adds
 * briefs one at a time or bulk-pastes a spreadsheet, edits or pauses them, and
 * every active brief is scored against incoming leads in the review inbox.
 */

const EMPTY_FORM: InvestorCriteriaInput = {
  name: '', budget: '', areas: '', propertyType: '', targetYield: '', strategy: '', notes: '',
};

type FormState = InvestorCriteriaInput;

/** One labelled input for the add/edit form. */
function Field({
  label, value, onChange, placeholder, className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-black/10 px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
      />
    </label>
  );
}

/** The shared add/edit field grid. */
function CriteriaForm({
  form, setForm,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  const set = (k: keyof FormState) => (v: string) => setForm({ ...form, [k]: v });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Investor name" value={form.name ?? ''} onChange={set('name')} placeholder="e.g. J. Patel" />
      <Field label="Budget" value={form.budget ?? ''} onChange={set('budget')} placeholder="£350,000" />
      <Field label="Areas" value={form.areas ?? ''} onChange={set('areas')} placeholder="Sheffield, Rotherham" />
      <Field label="Property type" value={form.propertyType ?? ''} onChange={set('propertyType')} placeholder="Terraced, Semi" />
      <Field label="Target yield" value={form.targetYield ?? ''} onChange={set('targetYield')} placeholder="7%" />
      <Field label="Strategy" value={form.strategy ?? ''} onChange={set('strategy')} placeholder="BTL / BRR / flip" />
      <Field label="Notes" value={form.notes ?? ''} onChange={set('notes')} placeholder="Anything else" className="sm:col-span-2" />
    </div>
  );
}

/** A read/edit row for one stored brief. */
function InvestorRow({
  row, onSaved, onDeleted,
}: {
  row: InvestorCriteriaRow;
  onSaved: (r: InvestorCriteriaRow) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: row.name,
    budget: row.budget ?? '',
    areas: row.areas ?? '',
    propertyType: row.propertyType ?? '',
    targetYield: row.targetYield ?? '',
    strategy: row.strategy ?? '',
    notes: row.notes ?? '',
  });
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateInvestorCriteria(row.id, form);
        onSaved({ ...row, ...form, budget: form.budget || null, areas: form.areas || null,
          propertyType: form.propertyType || null, targetYield: form.targetYield || null,
          strategy: form.strategy || null, notes: form.notes || null });
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
      }
    });
  }

  function togglePause() {
    startTransition(async () => {
      try {
        const next = !row.active;
        await updateInvestorCriteria(row.id, { active: next });
        onSaved({ ...row, active: next });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed.');
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        await deleteInvestorCriteria(row.id);
        onDeleted(row.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed.');
      }
    });
  }

  if (editing) {
    return (
      <div className="card p-5">
        <CriteriaForm form={form} setForm={setForm} />
        {error && <div className="text-xs text-red-600 mt-2" role="alert">{error}</div>}
        <div className="flex items-center gap-3 mt-4">
          <button type="button" onClick={save} disabled={busy} className="btn-primary justify-center disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-bold text-ink-mid hover:text-ink transition">
            <X size={16} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  const chips = [
    row.budget && `Budget ${row.budget}`,
    row.areas && `Areas ${row.areas}`,
    row.propertyType && `Type ${row.propertyType}`,
    row.targetYield && `Yield ${row.targetYield}`,
    row.strategy && row.strategy,
  ].filter(Boolean) as string[];

  return (
    <div className={`card p-5 ${row.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-black text-ink text-lg">{row.name}</span>
            {!row.active && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-muted bg-black/[0.05] px-2 py-0.5 rounded-full">
                Paused
              </span>
            )}
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map((c, i) => (
                <span key={i} className="text-[11px] font-semibold text-ink-mid bg-black/[0.03] border border-black/[0.06] px-2 py-0.5 rounded-full">
                  {c}
                </span>
              ))}
            </div>
          )}
          {row.notes && <p className="text-xs text-ink-muted mt-2">{row.notes}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setEditing(true)} disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-bold text-navy hover:text-navy-dark transition">
            <Pencil size={13} /> Edit
          </button>
          <button type="button" onClick={togglePause} disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-bold text-ink-mid hover:text-ink transition">
            {row.active ? 'Pause' : 'Activate'}
          </button>
          <button type="button" onClick={remove} disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-bold text-ink-mid hover:text-red-600 transition">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-red-600 mt-2" role="alert">{error}</div>}
    </div>
  );
}

export default function ClientsPage() {
  const [rows, setRows] = useState<InvestorCriteriaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'add' | 'bulk'>('none');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [bulkText, setBulkText] = useState('');
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listInvestorCriteria()
      .then((data) => { if (live) setRows(data); })
      .catch(() => { if (live) { setError('Could not load your investors. Please refresh.'); setRows([]); } });
    return () => { live = false; };
  }, []);

  function reload() {
    listInvestorCriteria().then(setRows).catch(() => {});
  }

  function addOne() {
    setError(null);
    if (!form.name?.trim()) { setError('An investor name is required.'); return; }
    startTransition(async () => {
      try {
        await createInvestorCriteria(form);
        setForm(EMPTY_FORM);
        setMode('none');
        setNotice('Investor added.');
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add investor.');
      }
    });
  }

  const parsed = mode === 'bulk' ? parseInvestorCsv(bulkText) : null;

  function importBulk() {
    if (!parsed || parsed.rows.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const summary = await bulkCreateInvestorCriteria(parsed.rows);
        setBulkText('');
        setMode('none');
        setNotice(`${summary.inserted} investor${summary.inserted === 1 ? '' : 's'} imported.`);
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Bulk import failed.');
      }
    });
  }

  const activeCount = rows?.filter((r) => r.active).length ?? 0;

  return (
    <div className="min-h-screen">
      <Nav signOutAction={signOut} />

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="badge mb-3">Network</div>
        <h1 className="text-3xl font-black text-ink mb-2">Investor Criteria</h1>
        <p className="text-sm text-ink-mid mb-6 max-w-xl">
          The briefs every incoming lead is matched against. Each active investor lifts match
          coverage for every future lead, so the review inbox can say who a deal is for.
        </p>

        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={() => { setMode(mode === 'add' ? 'none' : 'add'); setError(null); }}
            className="btn-primary justify-center">
            <Plus size={16} /> Add investor
          </button>
          <button type="button" onClick={() => { setMode(mode === 'bulk' ? 'none' : 'bulk'); setError(null); }}
            className="inline-flex items-center gap-2 text-sm font-bold text-navy hover:text-navy-dark transition">
            <Upload size={16} /> Bulk paste
          </button>
          {rows && rows.length > 0 && (
            <span className="text-xs text-ink-muted ml-auto">{activeCount} active · {rows.length} total</span>
          )}
        </div>

        {notice && (
          <div className="card p-3 mb-6 flex items-center gap-2 text-sm text-success-dark border-success/30 bg-success-light/40">
            <Check size={16} /> {notice}
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-6" role="alert">
            {error}
          </div>
        )}

        {mode === 'add' && (
          <div className="card p-5 mb-6">
            <CriteriaForm form={form} setForm={setForm} />
            <div className="flex items-center gap-3 mt-4">
              <button type="button" onClick={addOne} disabled={busy} className="btn-primary justify-center disabled:opacity-60">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save investor
              </button>
              <button type="button" onClick={() => setMode('none')} className="text-sm font-bold text-ink-mid hover:text-ink transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === 'bulk' && (
          <div className="card p-5 mb-6">
            <label className="block">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                Paste CSV or spreadsheet rows
              </span>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                placeholder={'name, budget, areas, propertyType, targetYield, strategy, notes\nJ. Patel, £350,000, "Sheffield, Rotherham", Terraced, 7%, BTL, cash buyer'}
                className="mt-1 w-full rounded-md border border-black/10 px-3 py-2 text-sm font-mono text-ink focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </label>
            <p className="text-xs text-ink-muted mt-2">
              A header row is optional. Without one, columns are read in order: name, budget, areas,
              property type, target yield, strategy, notes. Name is required.
            </p>
            {parsed && (parsed.rows.length > 0 || parsed.errors.length > 0) && (
              <div className="mt-3 text-xs">
                <span className="font-bold text-ink">{parsed.rows.length}</span>
                <span className="text-ink-muted"> valid row{parsed.rows.length === 1 ? '' : 's'} ready.</span>
                {parsed.errors.length > 0 && (
                  <span className="text-red-600"> {parsed.errors.length} skipped (line {parsed.errors.map((e) => e.line).join(', ')}).</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 mt-4">
              <button type="button" onClick={importBulk} disabled={busy || !parsed || parsed.rows.length === 0}
                className="btn-primary justify-center disabled:opacity-50">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Import {parsed?.rows.length ? `${parsed.rows.length}` : ''}
              </button>
              <button type="button" onClick={() => { setMode('none'); setBulkText(''); }}
                className="text-sm font-bold text-ink-mid hover:text-ink transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted py-16 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading investors...
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-navy/[0.06] flex items-center justify-center mx-auto mb-4">
              <Users size={20} className="text-navy" />
            </div>
            <div className="text-lg font-black text-ink mb-1">No investors yet</div>
            <p className="text-sm text-ink-muted max-w-sm mx-auto">
              Add your first investor brief, or bulk-paste your list. Leads start matching the moment
              a brief is active.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <InvestorRow
                key={row.id}
                row={row}
                onSaved={(updated) => setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev)}
                onDeleted={(id) => setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
