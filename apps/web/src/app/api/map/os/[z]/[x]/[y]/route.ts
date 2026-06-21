/**
 * OS Maps tile proxy. The OS key stays server-side - the browser requests
 * /api/map/os/{z}/{x}/{y} and we fetch the OS raster tile with the key. Keeps
 * OS_API_KEY out of the client bundle and off the network from the browser.
 */

import { NextRequest } from 'next/server';

const OS_STYLE = 'Light_3857'; // clean OS basemap in Web Mercator

export async function GET(
  _req: NextRequest,
  { params }: { params: { z: string; x: string; y: string } },
) {
  const key = process.env.OS_API_KEY;
  if (!key) {
    return new Response('OS_API_KEY not configured', { status: 503 });
  }

  const { z, x, y } = params;
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
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
        // OS tiles are static; cache hard at the edge + browser.
        'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
      },
    });
  } catch {
    return new Response('tile fetch failed', { status: 502 });
  }
}
