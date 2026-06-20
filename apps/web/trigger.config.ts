import { defineConfig } from '@trigger.dev/sdk/v3';

/**
 * Trigger.dev v3 configuration.
 *
 * Project ref is set via the dashboard after `npx trigger.dev@latest init`
 * during M0-T6 setup. Once set, this file holds the runtime config that
 * every task inherits.
 */
export default defineConfig({
  project: 'TODO_TRIGGER_PROJECT_REF',  // overwritten by `trigger.dev init`
  dirs: ['./src/trigger'],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  logLevel: 'info',
  maxDuration: 300,
});
