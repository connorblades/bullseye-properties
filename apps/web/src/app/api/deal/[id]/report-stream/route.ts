import { requireTenant } from '@/server/auth/tenant';
import { loadDeal } from '@/server/actions/deals';
import { assembleDeal } from '@/server/deal/assemble';
import { buildDealContext } from '@/server/claude/context';
import { generateSectionResilient, SECTION_ORDER } from '@/server/claude/prompts';
import { emptyDraft, type ReportStreamState } from '@/lib/report-types';

/**
 * Live report generation stream (M3, replaces the ai/rsc streaming action).
 *
 * Generates all five narrative sections in parallel and streams the evolving
 * ReportStreamState to the client as newline-delimited JSON. Kill switch, token
 * ceilings, daily budget, retry and Haiku fallback are enforced inside
 * generateSectionResilient -> generateGuarded.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenant());
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const row = await loadDeal(params.id);
  if (!row) return new Response('Deal not found', { status: 404 });

  const deal = assembleDeal(row);
  const context = buildDealContext(deal);
  const state = Object.fromEntries(SECTION_ORDER.map((k) => [k, emptyDraft()])) as ReportStreamState;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = () => controller.enqueue(encoder.encode(JSON.stringify(state) + '\n'));
      try {
        await Promise.all(
          SECTION_ORDER.map(async (key) => {
            const res = await generateSectionResilient({
              section: key,
              context,
              tenantId,
              onText: (full) => {
                state[key] = { ...state[key], text: full };
                send();
              },
              onFallback: () => {
                state[key] = { ...state[key], degraded: true };
                send();
              },
            });
            state[key] = {
              text: res.narrative,
              done: true,
              degraded: state[key].degraded,
              manualDraft: res.manualDraft,
              raw: res.rawText || res.narrative,
              model: res.modelUsed,
              promptVersionHash: res.promptVersionHash,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
            };
            send();
          })
        );
        controller.close();
      } catch (e) {
        try {
          controller.enqueue(
            encoder.encode(JSON.stringify({ error: e instanceof Error ? e.message : 'Generation failed' }) + '\n')
          );
        } catch {
          /* controller already closed */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
