import { loadDealPublic } from '@/server/deal/public';
import { buildOutline } from '@/lib/outline';
import { renderOutlinePackToBuffer } from '@/server/pdf/render';

/** Public 1-page Outline Deal PDF for the shareable link. */
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const res = await loadDealPublic(params.id);
  if (!res) return new Response('Not found', { status: 404 });

  const pdf = await renderOutlinePackToBuffer({
    data: buildOutline(res.deal),
    partner: res.partner,
    preparedFor: res.deal.client || undefined,
    generatedOn: new Intl.DateTimeFormat('en-GB').format(new Date()),
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Outline-Deal.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
