'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { setPassword } from '@/server/actions/auth';

export function SetPasswordForm({ errorMessage }: { errorMessage: string | null }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={setPassword} className="card p-8 space-y-5">
      <div>
        <label htmlFor="password" className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">
          New password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
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

      <div>
        <label htmlFor="confirm" className="block text-xs font-bold text-ink-mid uppercase tracking-wider mb-2">
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type={showPassword ? 'text' : 'password'}
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Type it again"
          className="w-full border border-black/[0.08] rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/40 transition"
        />
      </div>

      {errorMessage && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
          {errorMessage}
        </div>
      )}

      <button type="submit" className="btn-primary w-full justify-center">
        <Lock size={16} /> Save password
      </button>
    </form>
  );
}
