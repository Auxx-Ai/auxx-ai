// import withBundleAnalyzer from '@next/bundle-analyzer'
import path from 'path'
/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
// import { env } from '@auxx/config/server'

// @ts-ignore
import { WEBAPP_URL } from '@auxx/config/client'
// import {path} from 'path'
// const path = require('path')
console.log('FROM NEXT CONFIG: WEBAPP_URL', WEBAPP_URL)

/** @type {import("next").NextConfig} */
const nextConfig = {
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
    root: path.join(__dirname, '../..'),
  },
}

// const withBundleAnalyzer = require('@next/bundle-analyzer')({
//   enabled: process.env.ANALYZE === 'true',
// })
export default nextConfig
