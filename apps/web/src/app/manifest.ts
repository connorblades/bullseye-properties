import type { MetadataRoute } from 'next';

/**
 * Web app manifest - makes the Bullseye Platform an installable PWA.
 *
 * Chrome (desktop + mobile) reads this to offer "Install", which drops the app
 * on the desktop with the Bullseye icon and opens it in its own standalone
 * window (no browser chrome). Next serves this at /manifest.webmanifest and
 * injects the <link rel="manifest"> automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bullseye Platform',
    short_name: 'Bullseye',
    description:
      'Accredited Bullseye Partner platform. Sourcing framework, Standard Deal Reports, investor portal.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0a1e47',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
