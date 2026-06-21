'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Nav } from '@/components/nav';
import { signOut } from '@/server/actions/auth';
import { createDeal } from '@/server/actions/deals';
import { type Deal } from '@/lib/deal-store';

export default function NewDealPage() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [client, setClient] = useState('James W. (London)');
  const [source, setSource] = useState<Deal['source']>('estate-agent');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A full address must carry a valid UK postcode - every public-data and title
  // pull keys off it, so we block deal creation without one.
  const UK_POSTCODE_RE = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = address.trim();
    if (!UK_POSTCODE_RE.test(trimmed)) {
      setError('Enter the full property address including a valid UK postcode (e.g. "6, Browning Street, Mansfield, NG18 5PH").');
      return;
    }
    if (trimmed.replace(UK_POSTCODE_RE, '').trim().replace(/[, ]+$/, '').length < 4) {
      setError('Enter the full street address, not just the postcode.');
      return;
    }

    startTransition(async () => {
      try {
        const { id } = await createDeal({
          address,
          source,
          initialInputs: {
            client,
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
          Start with the property address and the client you are sourcing for. The platform pulls public data and pre-fills the next stages where it can.
        </p>

        <form onSubmit={onSubmit} className="card p-8 space-y-6">
          <div>
            <label className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Property address</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="6, Browning Street, Mansfield, NG18 5PH"
              className="w-full border border-black/[0.08] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
            />
            <div className="text-xs text-ink-muted mt-2">Required. Full UK address including postcode - every public-data, title and map pull keys off it.</div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">Client</label>
            <select
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className="w-full border border-black/[0.08] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
            >
              <option>James W. (London)</option>
              <option>Priya S. (Surrey)</option>
              <option>David and Sarah T.</option>
              <option>(Onboard a new client)</option>
            </select>
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
