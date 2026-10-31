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
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
};

export default nextConfig;
