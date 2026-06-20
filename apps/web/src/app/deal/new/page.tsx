'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Nav } from '@/components/nav';
import { signOut } from '@/server/actions/auth';
import { emptyDeal, newId, saveDeal, setStageProgress, type Deal } from '@/lib/deal-store';

export default function NewDealPage() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [client, setClient] = useState('James W. (London)');
  const [source, setSource] = useState<Deal['source']>('estate-agent');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = newId();
    const deal = emptyDeal(id, {
      address,
      client,
      source,
      auction: { isAuction: source === 'auction', buyerFees: '', specialConditions: '', restrictiveCovenants: '' },
    });
    saveDeal(deal);
    setStageProgress(id, 2);
    router.push(`/deal/${id}/wizard/2`);
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
            <div className="text-xs text-ink-muted mt-2">UK addresses only. We will auto-pull Land Registry, EPC and location data on the next stage.</div>
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

          <button type="submit" className="btn-primary w-full justify-center">
            Continue to Client Criteria <ArrowRight size={18} />
          </button>
        </form>
      </main>
    </div>
  );
}
