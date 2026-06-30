import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/server/auth/server';
import { signOut } from '@/server/actions/auth';
import { loadDeal } from '@/server/actions/deals';
import { Nav } from '@/components/nav';
import { ShareLinkManager } from '@/components/share-link-manager';

/**
 * Share-link control centre for a deal (M4). One home for the revocable,
 * expiring links a partner sends to investors: the outline pack (Report 1) now,
 * and the full report (Report 2) once M4-T3 lands.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Share links · Bullseye Properties' };

export default async function DealSharePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const deal = await loadDeal(params.id);
  if (!deal) notFound();

  return (
    <div className="min-h-screen">
      <Nav userEmail={user.email ?? undefined} signOutAction={signOut} />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <Link
          href={`/deal/${params.id}/wizard/1`}
          className="text-sm font-semibold text-ink-mid hover:text-navy inline-flex items-center gap-1.5 mb-6"
        >
          <ArrowLeft size={15} /> Back to the deal
        </Link>

        <div className="mb-8">
          <div className="badge mb-3">Share links</div>
          <h1 className="text-3xl font-black text-ink">{deal.address || '(no address yet)'}</h1>
          <p className="text-sm text-ink-mid mt-1">{deal.reference}</p>
        </div>

        <ShareLinkManager
          dealId={params.id}
          kind="outline"
          title="Outline pack (Report 1)"
          description="Revocable, expiring links to the pre-viewing Outline pack. Send one per prospect so you can revoke or track each independently. The link is shown once on creation."
        />
      </main>
    </div>
  );
}
