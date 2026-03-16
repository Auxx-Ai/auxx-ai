import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['sharp'],
  transpilePackages: [
    '@auxx/config',
    '@auxx/credentials',
    '@auxx/database',
    '@auxx/lib',
    '@auxx/logger',
    '@auxx/redis',
    '@auxx/services',
    '@auxx/ui',
    '@auxx/utils',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },

  /* config options here */
}

export default nextConfig
