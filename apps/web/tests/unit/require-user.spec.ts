import { afterEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`redirect:${path}`); }));
vi.mock('next/navigation', () => ({ redirect }));
import { requireUser } from '@/server/auth/server';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('requireUser', () => {
  it.each(['production', 'development', 'test'])('does not invent an authenticated user in %s when auth is unconfigured', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    await expect(requireUser()).rejects.toThrow('redirect:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
