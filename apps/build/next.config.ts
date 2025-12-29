import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@auxx/config',
    '@auxx/database',
    '@auxx/logger',
    '@auxx/services',
    // '@auxx/email',
    '@auxx/ui',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },

  /* config options here */
}

export default nextConfig
