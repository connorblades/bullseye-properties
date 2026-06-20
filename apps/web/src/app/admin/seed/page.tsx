import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { requireUser } from '@/server/auth/server';
import { signOut } from '@/server/actions/auth';
import { Nav } from '@/components/nav';
import { createDeal } from '@/server/actions/deals';
import { browningStreetSeed } from '@/lib/demo-deals';

export const metadata = { title: 'Seed demo data' };

async function seedBrowningStreet() {
  'use server';
  await createDeal({
    address: browningStreetSeed.address!,
    source: browningStreetSeed.source!,
    initialInputs: browningStreetSeed,
  });
  redirect('/dashboard?seeded=1');
}

export default async function AdminSeedPage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <Nav userEmail={user.email ?? undefined} signOutAction={signOut} />

      <main className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-navy mb-6 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>

        <div className="badge mb-3">Admin</div>
        <h1 className="text-3xl font-black text-ink mb-3">Seed demo data</h1>
        <p className="text-ink-mid mb-10 max-w-xl">
          Creates the Browning Street demo deal (6, Browning Street, Mansfield, NG18 5PH) with realistic
          inputs across every stage. Use it to walk the wizard end-to-end without manual data entry.
        </p>

        <div className="card p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 bg-navy/[0.08] rounded-xl flex items-center justify-center text-navy flex-shrink-0">
              <Sparkles size={22} />
            </div>
            <div>
              <h2 className="font-bold text-ink">Browning Street demo</h2>
              <div className="text-sm text-ink-mid mt-1">
                Pre-filled criteria, property details, sales + rental comps, viewing report, due diligence,
                growth drivers, refurb estimate, financials, offer recommendation. Stage 12 of 15.
              </div>
            </div>
          </div>

          <form action={seedBrowningStreet}>
            <button type="submit" className="btn-primary">
              <Sparkles size={16} /> Create Browning Street demo deal
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-black/[0.06] text-xs text-ink-muted italic">
            You can run this multiple times — each click creates another copy. Useful for testing concurrent deals.
          </div>
        </div>
      </main>
    </div>
  );
}
