'use client';

import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Nav } from '@/components/nav';
import { signOut } from '@/server/actions/auth';
import { createDeal } from '@/server/actions/deals';
import { type Deal } from '@/lib/deal-store';
import { listInvestorCriteria } from '@/server/actions/investor-criteria';

export default function NewDealPage() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [clientBriefId, setClientBriefId] = useState('');
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [source, setSource] = useState<Deal['source']>('estate-agent');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setClientsLoading(true);
    setClientsError(false);
    listInvestorCriteria().then((rows) => {
      if (!cancelled) setClients(rows.filter((row) => row.active).map(({ id, name }) => ({ id, name })));
    }).catch(() => { if (!cancelled) setClientsError(true); })
      .finally(() => { if (!cancelled) setClientsLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  // A full address must carry a valid UK postcode - every public-data and title
  // pull keys off it, so we block deal creation without one.
  const UK_POSTCODE_RE = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = address.trim();
    if (!UK_POSTCODE_RE.test(trimmed)) {
      setError('Enter the full property address including a valid UK postcode.');
      return;
    }
    if (trimmed.replace(UK_POSTCODE_RE, '').trim().replace(/[, ]+$/, '').length < 4) {
      setError('Enter the full street address, not just the postcode.');
      return;
    }

    startTransition(async () => {
      try {
        const { id } = await createDeal({
          address: trimmed,
          source,
          clientBriefId,
          initialInputs: {
            auction: {
              isAuction: source === 'auction',
              buyerFees: '',
              specialConditions: '',
              restrictiveCovenants: '',
            },
          },
        });
        router.push(`/deal/${id}/wizard/2`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create deal. Please try again.');
      }
    });
  }

  return (
    <div className="min-h-screen">
      <Nav signOutAction={signOut} />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-navy mb-6 inline-block">
          Back to deals
        </Link>
        <div className="badge mb-3">Stage 1 of 15</div>
        <h1 className="text-3xl font-black text-ink mb-3">New Deal</h1>
        <p className="text-ink-mid mb-10 max-w-xl">
          Start with the property address. Choose a saved client brief to copy their criteria, or leave the deal unassigned. You can request public data in the following stages.
        </p>

        <form onSubmit={onSubmit} className="card p-8 space-y-6">
          <div>
            <label htmlFor="deal-address" className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Property address</label>
            <input
              id="deal-address"
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full property address including postcode"
              className="w-full border border-black/[0.08] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
            />
            <div className="text-xs text-ink-muted mt-2">Required. Full UK address including postcode - every public-data, title and map pull keys off it.</div>
          </div>

          <div>
            <label htmlFor="deal-client" className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Client brief</label>
            <select
              id="deal-client"
              value={clientBriefId}
              onChange={(e) => setClientBriefId(e.target.value)}
              disabled={clientsLoading || clientsError || isPending}
              className="w-full border border-black/[0.08] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
            >
              <option value="">No client yet</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            {clientsLoading && <p role="status" className="mt-2 text-xs text-ink-muted">Loading saved client briefs…</p>}
            {clientsError && <div role="alert" className="mt-2 text-sm text-red-700">Client briefs could not be loaded. You can continue without a client, or <button type="button" className="underline font-semibold" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>retry</button>.</div>}
            {!clientsLoading && !clientsError && clients.length === 0 && <p className="mt-2 text-xs text-ink-muted">No active client briefs saved yet.</p>}
            <Link href="/clients" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-navy underline">Manage client briefs (opens a new tab)</Link>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Source</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'estate-agent',     l: 'Estate Agent' },
                { v: 'auction',          l: 'Auction' },
                { v: 'direct-to-vendor', l: 'Direct-to-vendor' },
              ] as { v: Deal['source']; l: string }[]).map((s) => (
                <label
                  key={s.v}
                  className={`border rounded-lg px-4 py-3 text-sm font-semibold cursor-pointer text-center transition ${
                    source === s.v
                      ? 'border-navy/50 bg-navy/[0.06] text-navy'
                      : 'border-black/[0.08] text-ink-mid hover:border-navy/30 hover:text-navy'
                  }`}
                >
                  <input
                    type="radio"
                    name="source"
                    className="sr-only"
                    checked={source === s.v}
                    onChange={() => setSource(s.v)}
                  />
                  {s.l}
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
              {error}
            </div>
          )}

          <button type="submit" disabled={isPending} className="btn-primary w-full justify-center disabled:opacity-60">
            {isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Creating deal...
              </>
            ) : (
              <>
                Continue to Client Criteria <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
