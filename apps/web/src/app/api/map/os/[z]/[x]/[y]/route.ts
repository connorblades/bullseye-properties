/**
 * OS Maps tile proxy. The OS key stays server-side - the browser requests
 * /api/map/os/{z}/{x}/{y} and we fetch the OS raster tile with the key. Keeps
 * OS_API_KEY out of the client bundle and off the network from the browser.
 */

import { NextRequest } from 'next/server';
import { requireTenant } from '@/server/auth/tenant';

const OS_STYLE = 'Light_3857'; // clean OS basemap in Web Mercator

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  try {
    await requireTenant();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const key = process.env.OS_API_KEY;
  if (!key) {
    return new Response('OS_API_KEY not configured', { status: 503 });
  }

  const { z, x, y } = await params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y) ||
      Number(z) > 20 || Number(x) >= 2 ** Number(z) || Number(y) >= 2 ** Number(z)) {
    return new Response('bad tile', { status: 400 });
  }

  const url = `https://api.os.uk/maps/raster/v1/zxy/${OS_STYLE}/${z}/${x}/${y}.png?key=${key}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return new Response('tile unavailable', { status: res.status });
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        'content-type': 'image/png',
        // Keep browser caching without allowing a shared edge cache to skip tenant authorization.
        'cache-control': 'private, max-age=86400',
      },
    });
  } catch {
    return new Response('tile fetch failed', { status: 502 });
  }
}
