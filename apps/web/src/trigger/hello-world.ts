import { task, logger } from '@trigger.dev/sdk';

/**
 * M0-T6 smoke-test task. Confirms Trigger.dev is wired and a Server Action
 * can enqueue work that runs on the Trigger.dev runtime and returns a result.
 *
 * Replace or remove once `generate-report` is in place (M3-T10).
 */
export const helloWorld = task({
  id: 'hello-world',
  maxDuration: 60,
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: { name: string }, { ctx }) => {
    logger.info('hello-world invoked', { runId: ctx.run.id, payload });
    return {
      message: `Hello ${payload.name} from Bullseye Platform Trigger.dev runtime.`,
      runId: ctx.run.id,
      receivedAt: new Date().toISOString(),
    };
  },
});
