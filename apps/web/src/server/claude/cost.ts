import 'server-only';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '@/server/db/client';
import { aiCostLedger } from '@/server/db/schema';
import { DAILY_TENANT_USD_CEILING, estimateUsd } from './config';

/**
 * Per-tenant daily cost ceiling + cost-ledger writeback (M3-T4 / M3-T5).
 *
 * Every generation reads the day's spend before running and records its cost
 * after. The ai_cost_ledger has a unique (tenant, day, model) row that we
 * upsert-increment, so one row accumulates a tenant's spend per model per day.
 */

/** Thrown when a tenant has hit its daily AI spend ceiling. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/** UTC calendar day, YYYY-MM-DD - matches the `date` column. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Total estimated USD a tenant has spent so far today across all models. */
export async function spentTodayUsd(tenantId: string): Promise<number> {
  const rows = await db
    .select({ usd: aiCostLedger.estimatedUsd })
    .from(aiCostLedger)
    .where(and(eq(aiCostLedger.tenantId, tenantId), eq(aiCostLedger.day, today())));
  return rows.reduce((sum, r) => sum + Number(r.usd), 0);
}

/** Reject if the tenant is already at or over the daily ceiling. */
export async function assertUnderDailyBudget(tenantId: string): Promise<void> {
  const spent = await spentTodayUsd(tenantId);
  if (spent >= DAILY_TENANT_USD_CEILING) {
    throw new BudgetExceededError(
      `Daily AI budget of $${DAILY_TENANT_USD_CEILING} reached for this account. Generation resumes tomorrow, or contact support to raise the limit.`
    );
  }
}

/** Record a generation's token usage and estimated cost into the ledger. */
export async function recordCost(opts: {
  tenantId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const usd = estimateUsd(opts.modelId, opts.inputTokens, opts.outputTokens).toFixed(4);
  await db
    .insert(aiCostLedger)
    .values({
      id: ulid(),
      tenantId: opts.tenantId,
      day: today(),
      modelId: opts.modelId,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      estimatedUsd: usd,
    })
    .onConflictDoUpdate({
      target: [aiCostLedger.tenantId, aiCostLedger.day, aiCostLedger.modelId],
      set: {
        inputTokens: sql`${aiCostLedger.inputTokens} + ${opts.inputTokens}`,
        outputTokens: sql`${aiCostLedger.outputTokens} + ${opts.outputTokens}`,
        estimatedUsd: sql`${aiCostLedger.estimatedUsd} + ${usd}::numeric`,
      },
    });
}
