import Link from 'next/link';
import Image from 'next/image';
import { MailCheck } from 'lucide-react';

export const metadata = { title: 'Check your email' };

export default function LoginSentPage({ searchParams }: { searchParams: { email?: string } }) {
  const email = searchParams.email ? decodeURIComponent(searchParams.email) : 'your email';
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-bg">
      <div className="card p-10 w-full max-w-md text-center">
        <Link href="/" className="inline-flex items-center mb-8">
          <Image src="/logo.png" alt="Bullseye Properties" width={140} height={36} priority style={{ height: 36, width: 'auto' }} />
        </Link>
        <div className="w-14 h-14 mx-auto bg-success-light text-success-dark rounded-2xl flex items-center justify-center mb-5">
          <MailCheck size={24} />
        </div>
        <h1 className="text-2xl font-black text-ink mb-3">Check your email</h1>
        <p className="text-sm text-ink-mid mb-6">
          We have sent a sign-in link to <strong className="text-ink">{email}</strong>. The link expires in 15 minutes.
        </p>
        <div className="pt-6 border-t border-black/[0.06] text-xs text-ink-muted">
          Wrong address? <Link href="/login" className="text-navy font-semibold">Use a different email</Link>
        </div>
      </div>
    </main>
  );
}
