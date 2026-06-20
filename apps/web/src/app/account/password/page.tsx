import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/server/auth/server';
import { signOut } from '@/server/actions/auth';
import { Nav } from '@/components/nav';
import { SetPasswordForm } from './set-password-form';

export const metadata = { title: 'Set password' };

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <Nav userEmail={user.email ?? undefined} signOutAction={signOut} />

      <main className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-navy mb-6 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>

        <div className="badge mb-3">Account</div>
        <h1 className="text-3xl font-black text-ink mb-3">Set your password</h1>
        <p className="text-ink-mid mb-10 max-w-xl">
          Pick a password so you can sign in without using a magic link. You can change it any time
          from this page. Minimum 8 characters.
        </p>

        <SetPasswordForm errorMessage={searchParams.error ? decodeURIComponent(searchParams.error) : null} />
      </main>
    </div>
  );
}
