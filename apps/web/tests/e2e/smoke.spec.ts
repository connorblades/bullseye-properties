import { expect, test } from '@playwright/test';

// Skips the redirect test if SUPABASE env vars are not configured.
// The middleware fails soft without them; redirect behaviour is testable only
// once M0-T2 (Supabase provisioning) is complete.
const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

test.describe('Smoke', () => {
  test('marketing landing renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('The standard for')).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('sign-in page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('dashboard requires auth', async ({ page }) => {
    test.skip(!supabaseConfigured, 'Skipped - SUPABASE env not configured yet');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
