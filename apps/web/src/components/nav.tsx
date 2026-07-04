import Link from 'next/link';
import { Logo } from './logo';

export function Nav({
  userEmail,
  signOutAction,
}: {
  userEmail?: string;
  signOutAction?: () => Promise<void>;
}) {
  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-black/[0.06]">
      <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between">
        <Logo size="md" />
        <div className="flex items-center gap-6 text-sm">
          <Link href="/dashboard" className="text-ink-mid hover:text-navy font-semibold transition">Deals</Link>
          <Link href="/pipeline" className="text-ink-mid hover:text-navy font-semibold transition">Pipeline</Link>
          <Link href="/review" className="text-ink-mid hover:text-navy font-semibold transition">Deal Review</Link>
          <span className="text-ink-muted font-semibold cursor-default hidden md:inline">Clients</span>
          <span className="text-ink-muted font-semibold cursor-default hidden md:inline">Network</span>
          {userEmail && (
            <span className="text-ink-muted text-xs hidden lg:inline">{userEmail}</span>
          )}
          {signOutAction ? (
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-ink-mid hover:text-red-500 font-semibold transition text-sm"
              >
                Sign out
              </button>
            </form>
          ) : (
            <div className="w-9 h-9 rounded-full bg-navy/10 border border-navy/20 flex items-center justify-center text-navy font-black text-sm">
              {userEmail ? userEmail.charAt(0).toUpperCase() : 'C'}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
