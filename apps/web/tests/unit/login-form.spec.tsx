import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/actions/auth', () => ({ signInWithGoogle: '/test-google', signInWithMagicLink: '/test-email', signInWithPassword: '/test-password' }));
import LoginForm from '@/app/login/login-form';

describe('login connection state', () => {
  it('shows the missing connection and disables credential entry', () => {
    const html = renderToStaticMarkup(<LoginForm searchParams={{}} available={false} />);
    expect(html).toContain('Account connection needs restoring');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).not.toContain('NEXT_PUBLIC_SUPABASE');
  });
  it('enables sign-in when the connection is configured', () => {
    const html = renderToStaticMarkup(<LoginForm searchParams={{}} available />);
    expect(html).not.toContain('<fieldset disabled');
    expect(html).not.toContain('Account connection needs restoring');
  });
});
