import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authConfigured, AUTH_UNAVAILABLE } from '@/server/auth/config';

const fakes = vi.hoisted(() => ({
  createClient: vi.fn(), signInWithOAuth: vi.fn(), signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
}));
vi.mock('@/server/auth/server', () => ({ createSupabaseActionClient: fakes.createClient }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { signInWithGoogle, signInWithMagicLink, signInWithPassword, setPassword, signOut } from '@/server/actions/auth';

function credentials() {
  const data = new FormData();
  data.set('email', 'partner@example.test');
  data.set('password', 'test-password');
  data.set('confirm', 'test-password');
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.bpos.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bpos.test');
  fakes.createClient.mockResolvedValue({ auth: fakes });
  fakes.signOut.mockResolvedValue({ error: null });
  fakes.signInWithOAuth.mockResolvedValue({ data: { url: 'https://auth.bpos.test/authorize' }, error: null });
  fakes.signInWithOtp.mockResolvedValue({ error: null });
  fakes.signInWithPassword.mockResolvedValue({ error: null });
  fakes.updateUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('missing account configuration (regression for digest 3457374997)', () => {
  it.each([
    ['missing URL', '', 'key'], ['missing key', 'https://auth.bpos.test', ''],
    ['invalid URL', 'not-a-url', 'key'], ['invalid protocol', 'file:///tmp/auth', 'key'],
    ['whitespace key', 'https://auth.bpos.test', '  '],
  ])('rejects all sign-in and password actions with %s before creating a client', async (_name, url, key) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key);
    expect(authConfigured()).toBe(false);
    for (const action of [signInWithGoogle, signInWithMagicLink, signInWithPassword, setPassword]) {
      await expect(action(credentials())).rejects.toThrow(`redirect:/login?error=${encodeURIComponent(AUTH_UNAVAILABLE)}`);
    }
    await expect(signOut()).rejects.toThrow('redirect:/login');
    expect(fakes.createClient).not.toHaveBeenCalled();
  });
});

describe('configured authentication', () => {
  it('redirects a successful password login and only signs out the current browser', async () => {
    await expect(signInWithPassword(credentials())).rejects.toThrow('redirect:/dashboard');
    expect(fakes.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(fakes.signInWithPassword).toHaveBeenCalledWith({ email: 'partner@example.test', password: 'test-password' });
  });
  it('redirects OAuth to the provider', async () => {
    await expect(signInWithGoogle()).rejects.toThrow('redirect:https://auth.bpos.test/authorize');
  });
  it('sends a link without creating new accounts', async () => {
    await expect(signInWithMagicLink(credentials())).rejects.toThrow('redirect:/login/sent?email=partner%40example.test');
    expect(fakes.signInWithOtp).toHaveBeenCalledWith({ email: 'partner@example.test', options: { emailRedirectTo: 'https://bpos.test/auth/callback', shouldCreateUser: false } });
  });
  it('does not grant access for a rejected password', async () => {
    fakes.signInWithPassword.mockResolvedValue({ error: new Error('invalid credentials') });
    await expect(signInWithPassword(credentials())).rejects.toThrow(`redirect:/login?error=${encodeURIComponent('Incorrect email or password.')}`);
  });
  it.each([
    ['Google', () => signInWithGoogle(), 'signInWithOAuth'],
    ['magic link', () => signInWithMagicLink(credentials()), 'signInWithOtp'],
    ['password', () => signInWithPassword(credentials()), 'signInWithPassword'],
    ['password change', () => setPassword(credentials()), 'updateUser'],
    ['sign out', () => signOut(), 'signOut'],
  ] as const)('handles a transport failure during %s', async (_label, action, method) => {
    fakes[method].mockRejectedValue(new Error('private provider details'));
    await expect(action()).rejects.toThrow(/redirect:\/(login|account\/password)\?error=/);
  });
});
