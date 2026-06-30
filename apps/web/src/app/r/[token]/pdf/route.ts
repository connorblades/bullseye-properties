import { resolveReportAccess } from '@/server/share/access';
import { recordShareAccess, hashIp } from '@/server/share/tokens';
import { downloadDealPack } from '@/server/storage/admin';

/**
 * Token-gated full-report PDF (Report 2, M4-T3). Resolves the share token,
 * streams the stored deal-pack bytes (the storage signed URL is never exposed to
 * the recipient), and logs the download.
 */
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const access = await resolveReportAccess(params.token);
  if (access.status !== 'ok') {
    const notFound = access.status === 'not_found';
    const msg = notFound
      ? 'Not found'
      : access.status === 'not_ready'
        ? 'Report not ready'
        : 'This link is no longer active';
    return new Response(msg, { status: notFound ? 404 : access.status === 'not_ready' ? 409 : 410 });
  }

  // Only an explicit download click (?dl=1) is logged as a download. The inline
  // <object> embed on the report page auto-fetches this route to render the PDF;
  // that view is already represented by the page's 'open' event, so we must not
  // double-count it as a download. Best-effort; logging never blocks delivery.
  const isExplicitDownload = new URL(req.url).searchParams.get('dl') === '1';
  if (isExplicitDownload) {
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

  const path = access.version.pdfStoragePath;
  if (!path) return new Response('Report not ready', { status: 409 });

  const pdf = await downloadDealPack(path);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Standard-Deal-Report-v${access.version.version}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
