import 'server-only';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const INLINE_IMAGE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/;

/** Stored deal fields are untrusted: never let the PDF renderer open a path or arbitrary URL. */
export function permittedPdfImageUrl(source: string): URL | null {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'api.mapbox.com' && url.pathname.startsWith('/styles/v1/mapbox/')) return url;
    if (url.hostname === 'environment.data.gov.uk' &&
        url.pathname === '/spatialdata/flood-map-for-planning-flood-zones/wms') return url;
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (configured) {
      const storage = new URL(configured);
      if (/^[a-z0-9]+\.supabase\.co$/.test(storage.hostname) && url.origin === storage.origin &&
          /^\/storage\/v1\/object\/(public|sign)\//.test(url.pathname)) return url;
    }
  } catch { /* Invalid or local path: rejected. */ }
  return null;
}

function isRaster(bytes: Buffer): boolean {
  return bytes.length > 8 && (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
  );
}

/** Return bytes only. The PDF library never receives a caller-controlled URL or filename. */
export async function loadPdfImage(source: string): Promise<Buffer | undefined> {
  if (typeof source !== 'string' || source.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 40) return;
  const inline = INLINE_IMAGE.exec(source);
  if (inline) {
    const bytes = Buffer.from(inline[2], 'base64');
    return bytes.length <= MAX_IMAGE_BYTES && isRaster(bytes) ? bytes : undefined;
  }
  const url = permittedPdfImageUrl(source);
  if (!url) return;
  try {
    const response = await fetch(url, {
      redirect: 'error', // An allowed host must never redirect a renderer to the internal network.
      signal: AbortSignal.timeout(10_000),
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok || !response.body) return;
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await response.body.cancel();
      return;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    return isRaster(bytes) ? bytes : undefined;
  } catch {
    // An unavailable image must not prevent the rest of the report rendering.
    return;
  }
}
