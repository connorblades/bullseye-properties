import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPdfImage } from '@/server/pdf/image-source';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3xQAAAAASUVORK5CYII=', 'base64');
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('PDF images cannot open arbitrary resources', () => {
  it.each([
    '/etc/passwd', 'file:///etc/passwd', 'http://127.0.0.1/private',
    'http://169.254.169.254/latest/meta-data/', 'https://attacker.test/photo.png',
    'https://api.mapbox.com.attacker.test/styles/v1/mapbox/test',
    'https://attacker.test@api.mapbox.com/styles/v1/mapbox/test',
    'https://api.mapbox.com:8443/styles/v1/mapbox/test',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('does not fetch %s', async (source) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await loadPdfImage(source)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps uploaded PNG photographs without network access', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await loadPdfImage(`data:image/png;base64,${PNG.toString('base64')}`)).toEqual(PNG);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches a permitted map as bounded bytes, with redirects disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(PNG)); vi.stubGlobal('fetch', fetcher);
    expect(await loadPdfImage('https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/test')).toEqual(PNG);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
  });

  it('accepts only this project’s public or signed storage image URLs', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projecttest.supabase.co');
    const fetcher = vi.fn().mockResolvedValue(new Response(PNG)); vi.stubGlobal('fetch', fetcher);
    expect(await loadPdfImage('https://anotherproject.supabase.co/storage/v1/object/public/photo.png')).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await loadPdfImage('https://projecttest.supabase.co/storage/v1/object/public/photo.png')).toEqual(PNG);
  });

  it('rejects oversized upstream responses and non-image bytes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('too big', { headers: { 'content-length': '10485761' } }))
      .mockResolvedValueOnce(new Response('<html>not an image</html>'));
    vi.stubGlobal('fetch', fetcher);
    const source = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/test';
    expect(await loadPdfImage(source)).toBeUndefined();
    expect(await loadPdfImage(source)).toBeUndefined();
  });
});
