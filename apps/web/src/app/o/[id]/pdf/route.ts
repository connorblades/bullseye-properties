import { resolveOutlineAccess } from '@/server/share/access';
import { recordShareAccess, hashIp } from '@/server/share/tokens';
import { buildOutline } from '@/lib/outline';
import { renderOutlinePackToBuffer } from '@/server/pdf/render';

/** Public 1-page Outline Deal PDF for the shareable link (tokenised in M4-T2). */
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await resolveOutlineAccess(params.id);
  if (access.status !== 'ok') {
    const msg = access.status === 'not_found' ? 'Not found' : 'This link is no longer active';
    return new Response(msg, { status: access.status === 'not_found' ? 404 : 410 });
  }

  // Log the download for tokenised access (best-effort; never blocks delivery).
  if (access.token) {
    try {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
      await recordShareAccess(access.token, 'download', {
        ipHash: hashIp(ip),
        userAgent: req.headers.get('user-agent'),
      });
    } catch {
      // logging failure must not break delivery
    }
  }

  const pdf = await renderOutlinePackToBuffer({
    data: buildOutline(access.deal),
    partner: access.partner,
    preparedFor: access.deal.client || undefined,
    generatedOn: new Intl.DateTimeFormat('en-GB').format(new Date()),
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Outline-Deal.pdf"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
