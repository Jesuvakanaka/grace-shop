import type { MetadataRoute } from 'next';

// Home-screen install details for the owner's phone (VYRA brand: olive theme, cream background).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VYRA',
    short_name: 'VYRA',
    description: 'VYRA stock, cash and credit.',
    start_url: '/',
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
