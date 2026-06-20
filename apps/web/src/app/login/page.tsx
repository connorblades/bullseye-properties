'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { signInWithMagicLink, signInWithPassword } from '@/server/actions/auth';

type Mode = 'password' | 'magic-link';

export default function LoginPage({ searchParams }: { searchParams: { error?: string; sent?: string } }) {
  const [mode, setMode] = useState<Mode>('password');
  const [showPassword, setShowPassword] = useState(false);

  const errorMessage = searchParams.error ? decodeURIComponent(searchParams.error) : null;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-bg">
      <div className="card p-10 w-full max-w-md">
        <Link href="/" className="inline-flex items-center mb-8">
          <Image
            src="/logo.png"
            alt="Bullseye Properties"
            width={320}
            height={80}
            priority
            style={{ height: 80, width: 'auto' }}
          />
        </Link>
        <div className="badge mb-4">Sign in</div>
        <h1 className="text-2xl font-black text-ink mb-2">Welcome back</h1>
        <p className="text-sm text-ink-mid mb-8">
          {mode === 'password'
            ? 'Enter your email and password.'
            : 'We will email you a one-time sign-in link.'}
        </p>

        {mode === 'password' ? (
          <form action={signInWithPassword} className="space-y-4">
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="connor@bullseyeproperties.co.uk"
              required
            />
            <div>
              <label htmlFor="password" className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Your password"
                  className="w-full border border-black/[0.08] rounded-lg px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-navy transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {errorMessage && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
                {errorMessage}
              </div>
            )}
            <button type="submit" className="btn-primary w-full justify-center">
              <Lock size={18} /> Sign in
            </button>
          </form>
        ) : (
          <form action={signInWithMagicLink} className="space-y-4">
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="connor@bullseyeproperties.co.uk"
              required
            />
            {errorMessage && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
                {errorMessage}
              </div>
            )}
            <button type="submit" className="btn-primary w-full justify-center">
              <Mail size={18} /> Email me a sign-in link
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setMode(mode === 'password' ? 'magic-link' : 'password')}
            className="text-sm text-navy font-semibold hover:underline"
          >
            {mode === 'password' ? 'Forgot password? Use magic link instead' : 'Sign in with password instead'}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-black/[0.06] text-xs text-ink-muted">
          Trouble signing in?{' '}
          <Link href="mailto:info@bullseyeproperties.co.uk" className="text-navy font-semibold">
            Contact platform admin
          </Link>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full border border-black/[0.08] rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
      />
    </div>
  );
}
