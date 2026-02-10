// import withBundleAnalyzer from '@next/bundle-analyzer'
import path from 'path'
import { fileURLToPath } from 'url'

const fileName = fileURLToPath(import.meta.url)
const dirName = path.dirname(fileName)
/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */

/** @type {import("next").NextConfig} */
const nextConfig = {
  generateBuildId: async () => {
    return process.env.NEXT_PUBLIC_GIT_SHA || 'development'
  },
  output: 'standalone',
  transpilePackages: [
    '@auxx/config',
    '@auxx/lib',
    '@auxx/database',
    '@auxx/services',
    '@auxx/workflow-nodes',
    '@auxx/email',
    '@auxx/ui',
  ],
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  // Override default externalization - exclude Prisma packages from externalization
  devIndicators: false, //{ position: 'bottom-right' },

  // reactStrictMode: true,
  images: {
    // Avoid requiring sharp in the server Lambda; rely on client-side <img> or our optimizer function
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '7xysn5pd7c.ufs.sh', pathname: '/f/*' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'auxxai-files.s3.us-east-2.amazonaws.com', pathname: '/**' },
      { protocol: 'https', hostname: 'ui-avatars.com', pathname: '/**' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: path.join(dirName, '../..'),
  },
}

// const withBundleAnalyzer = require('@next/bundle-analyzer')({
//   enabled: process.env.ANALYZE === 'true',
// })
export default nextConfig
