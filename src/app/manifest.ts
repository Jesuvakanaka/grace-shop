import type { MetadataRoute } from 'next';

// Installing the site as an app (VYRA brand: olive theme, cream background): it opens the
// storefront (/site, redirected to / on a storefront host). The scope is the whole origin so
// staff sign-in from the menu stays in the app; the id keeps earlier installs (start_url /) the same app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VYRA',
    short_name: 'VYRA',
    description: 'VYRA – Wear Different.',
    id: '/',
    start_url: '/site',
    scope: '/',
    display: 'standalone',
    background_color: '#EDE6D3',
    theme_color: '#5F7A1F',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/vyra-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/vyra-icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/vyra-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
