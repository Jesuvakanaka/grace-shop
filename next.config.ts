import path from "node:path";
import type { NextConfig } from "next";

// Pin the project root to this directory. Without it Next.js infers the root
// from the outermost lockfile, which in a git worktree (nested inside another
// checkout) moves the standalone server to .next/standalone/<nested path>/.
const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  // ZP-463: emit .next/standalone (minimal server.js) for the Cloud Run image.
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  images: {
    // ZP-484: resized variants are cached for max(minimumCacheTTL, upstream
    // max-age) and cannot be invalidated. 300 s matches the public image
    // route's max-age, so an unpublished picture stops being served through
    // /_next/image within 5 minutes (the Next 16 default is 4 hours).
    minimumCacheTTL: 300,
    // ZP-485: the optimiser (/_next/image?url=...) may only fetch brand assets
    // and stored images, without a query string. Anything else (e.g.
    // /api/products) is a 400, on every host.
    localPatterns: [
      { pathname: '/brand/**', search: '' },
      { pathname: '/api/images/**', search: '' },
    ],
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
};

export default nextConfig;
