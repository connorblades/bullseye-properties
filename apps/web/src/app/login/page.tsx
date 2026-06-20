'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { signInWithGoogle, signInWithMagicLink, signInWithPassword } from '@/server/actions/auth';

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
          Sign in with Google, or use your email and {mode === 'password' ? 'password' : 'a one-time link'}.
        </p>

        <form action={signInWithGoogle} className="mb-6">
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 border border-black/[0.12] bg-white text-ink font-semibold px-5 py-3 rounded-lg hover:bg-bg transition"
          >
            <GoogleLogo />
            Sign in with Google
          </button>
        </form>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-black/[0.08]" />
          <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">Or</div>
          <div className="flex-1 h-px bg-black/[0.08]" />
        </div>

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

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
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
