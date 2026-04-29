// apps/kb/next.config.ts

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  cacheComponents: true,
  transpilePackages: ['@auxx/database', '@auxx/config', '@auxx/lib', '@auxx/ui', '@auxx/utils'],
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'auxxai-files.s3.us-east-2.amazonaws.com', pathname: '/**' },
      { protocol: 'https', hostname: '*.s3.amazonaws.com', pathname: '/**' },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  poweredByHeader: false,
}

export default nextConfig
