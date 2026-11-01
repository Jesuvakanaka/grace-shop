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
  experimental: {
    // ZP-504: src/proxy.ts runs on every /api route (host routing must 404
    // private APIs on the storefront host, so uploads stay in its matcher).
    // A body passing through the proxy is buffered only up to this size and
    // silently TRUNCATED beyond it (Next default 10 MB). 16 MiB holds the
    // largest single-request upload: a photo of IMAGE_MAX_UPLOAD_BYTES (15 MiB)
    // plus multipart framing; videos are sent in 8 MiB chunks.
    // tests/upload-body-limit.test.ts keeps the two in step.
    proxyClientMaxBodySize: 16 * 1024 * 1024,
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
      // ZP-484: one segment only, so the optimiser cannot fetch
      // /api/images/public/** (it keeps serving a cached size after a
      // picture is unpublished; storefront photos use <img srcset>).
      { pathname: '/api/images/*', search: '' },
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
