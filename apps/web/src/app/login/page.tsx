import Link from 'next/link';
import Image from 'next/image';
import { Mail } from 'lucide-react';
import { signInWithMagicLink } from '@/server/actions/auth';

export const metadata = { title: 'Sign in' };

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-bg">
      <div className="card p-10 w-full max-w-md">
        <Link href="/" className="inline-flex items-center mb-8">
          <Image src="/logo.png" alt="Bullseye Properties" width={140} height={36} priority style={{ height: 36, width: 'auto' }} />
        </Link>
        <div className="badge mb-4">Sign in</div>
        <h1 className="text-2xl font-black text-ink mb-2">Welcome back</h1>
        <p className="text-sm text-ink-mid mb-8">We will email you a magic link. No password needed.</p>

        <form action={signInWithMagicLink} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="connor@bullseyeproperties.co.uk"
              className="w-full border border-black/[0.08] rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
            />
          </div>
          {searchParams.error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
              {decodeURIComponent(searchParams.error)}
            </div>
          )}
          <button type="submit" className="btn-primary w-full justify-center">
            <Mail size={18} /> Email me a magic link
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-black/[0.06] text-xs text-ink-muted">
          Trouble signing in? <Link href="mailto:hello@bullseyeproperties.co.uk" className="text-navy font-semibold">Contact platform admin</Link>
        </div>
      </div>
    </main>
  );
}
