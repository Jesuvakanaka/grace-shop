import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ZP-463: emit .next/standalone (minimal server.js) for the Cloud Run image.
  output: 'standalone',
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
