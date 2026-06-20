import Link from 'next/link';
import { CheckCircle2, KeyRound, Plus } from 'lucide-react';
import { requireUser } from '@/server/auth/server';
import { signOut } from '@/server/actions/auth';
import { Nav } from '@/components/nav';
import { DashboardDealsList } from '@/components/dashboard-deals-list';

export const metadata = { title: 'Your deals' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { password_set?: string };
}) {
  const user = await requireUser();
  const justSetPassword = searchParams.password_set === '1';

  return (
    <div className="min-h-screen">
      <Nav userEmail={user.email ?? undefined} signOutAction={signOut} />

      <main className="max-w-7xl mx-auto px-6 py-10">
        {justSetPassword && (
          <div className="mb-6 card p-4 flex items-center gap-3 bg-success-light/40 border-success/20">
            <CheckCircle2 size={18} className="text-success-dark flex-shrink-0" />
            <div className="text-sm text-success-dark font-semibold">
              Password saved. You can sign in with it from now on.
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <div className="badge mb-3">Partner · {user.email ?? 'local-dev'}</div>
            <h1 className="text-3xl font-black text-ink">Your deals</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/account/password"
              className="inline-flex items-center gap-2 text-sm font-semibold text-ink-mid hover:text-navy border border-black/[0.08] rounded-lg px-3 py-2 transition"
            >
              <KeyRound size={14} /> Set password
            </Link>
            <Link href="/deal/new" className="btn-primary">
              <Plus size={18} /> New deal
            </Link>
          </div>
        </div>

        <DashboardDealsList />
      </main>
    </div>
  );
}
