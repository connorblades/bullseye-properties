import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireUser } from '@/server/auth/server';
import { signOut } from '@/server/actions/auth';
import { Nav } from '@/components/nav';
import { PipelineBoard } from '@/components/pipeline-board';

export const metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <Nav userEmail={user.email ?? undefined} signOutAction={signOut} />

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <div className="badge mb-3">Pipeline</div>
            <h1 className="text-3xl font-black text-ink">Deal pipeline</h1>
            <p className="text-sm text-ink-mid mt-1">Every deal by stage, lead to delivery.</p>
          </div>
          <Link href="/deal/new" className="btn-primary">
            <Plus size={18} /> New deal
          </Link>
        </div>

        <PipelineBoard />
      </main>
    </div>
  );
}
