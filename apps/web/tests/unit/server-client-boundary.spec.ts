import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression guard for the lead-ingress server/client boundary.
 *
 * `deal-store.ts` is a `'use client'` module (React hooks + Server Actions).
 * The lead ingress route (server) reaches these modules via `fitForCandidate`,
 * so a RUNTIME import of `deal-store` from any of them drags the whole
 * client/server-action graph into the server bundle and breaks the minified
 * production build ("d is not a function"). These modules may import `deal-store`
 * only as `import type` (erased), never as a runtime value - the pure factory
 * lives in `deal-factory.ts` and computed helpers in `deal-calcs.ts`.
 */
describe('server-reachable lib modules do not runtime-import deal-store', () => {
  const libRoot = path.resolve(__dirname, '../../src/lib');
  const serverSafe = ['lead-intake.ts', 'lead-score.ts', 'deal-calcs.ts', 'deal-factory.ts'];

  for (const file of serverSafe) {
    it(`${file} imports deal-store only as a type`, () => {
      const src = readFileSync(path.join(libRoot, file), 'utf8');
      const lines = src.split('\n');
      const offenders = lines.filter((l) => {
        const m = /^\s*import\s+(.*?)\s+from\s+['"](?:\.\/deal-store|@\/lib\/deal-store)['"]/.exec(l);
        // A match that is NOT `import type ...` is a runtime import - the bug.
        return m && !/^type\b/.test(m[1].trim());
      });
      expect(offenders).toEqual([]);
    });
  }
});
