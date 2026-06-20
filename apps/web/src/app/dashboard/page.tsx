import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireUser } from '@/server/auth/server';
import { signOut } from '@/server/actions/auth';
import { Nav } from '@/components/nav';
import { DashboardDealsList } from '@/components/dashboard-deals-list';

export const metadata = { title: 'Your deals' };

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <Nav userEmail={user.email ?? undefined} signOutAction={signOut} />

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <div className="badge mb-3">Partner · {user.email ?? 'local-dev'}</div>
            <h1 className="text-3xl font-black text-ink">Your deals</h1>
          </div>
          <Link href="/deal/new" className="btn-primary">
            <Plus size={18} /> New deal
          </Link>
        </div>

        <DashboardDealsList />
      </main>
    </div>
  );
}
