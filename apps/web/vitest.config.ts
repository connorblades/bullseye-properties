import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Server modules import the db client at load time; postgres-js connects
    // lazily, so a dummy URL lets them import without a real database. Tests
    // that exercise DB paths inject fakes rather than hitting Postgres.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/trigger/**'],
    },
    include: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.tsx', 'src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws when imported outside an RSC environment; stub it
      // so server modules (claude config/guards) are unit-testable under Node.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
