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
    return process.env.GIT_SHA || 'development'
  },
  // Required: PostHog endpoints use trailing slashes (/e/, /decide/).
  // Without this, Next.js issues 308 redirects that break event capture.
  skipTrailingSlashRedirect: true,
  output: 'standalone',
  serverExternalPackages: ['imapflow', 'pino', 'thread-stream'],
  transpilePackages: [
    '@auxx/billing',
    '@auxx/config',
    '@auxx/credentials',
    '@auxx/database',
    '@auxx/deployment',
    '@auxx/lib',
    '@auxx/logger',
    '@auxx/redis',
    '@auxx/seed',
    '@auxx/services',
    '@auxx/types',
    '@auxx/ui',
    '@auxx/utils',
    '@auxx/workflow-nodes',
  ],
  experimental: {
    turbopackFileSystemCacheForDev: true,
    webpackMemoryOptimizations: true,
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
  async headers() {
    // HSTS must NEVER be served on http://localhost during dev — once the
    // browser caches it, every subsequent http://localhost request gets
    // force-upgraded to https, the dev server (http only) returns nothing,
    // and you get "localhost refused to connect" until you flush the policy
    // at chrome://net-internals/#hsts.
    const isProduction = process.env.NODE_ENV === 'production'

    // Shared baseline headers (safe to apply everywhere, including /embed)
    const baselineHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ...(isProduction
        ? [
            {
              key: 'Strict-Transport-Security',
              value: 'max-age=31536000; includeSubDomains',
            },
          ]
        : []),
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=()',
      },
    ]
    return [
      // Everything except /embed/* gets the strict no-framing policy.
      // The extension iframe at /embed/* needs to be framed by the
      // chrome-extension origin; CSP for that path is set in proxy.ts.
      {
        source: '/((?!embed/).*)',
        headers: [
          ...baselineHeaders,
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; upgrade-insecure-requests",
          },
        ],
      },
      {
        source: '/embed/:path*',
        headers: baselineHeaders,
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/app/settings/integrations/:path*',
        destination: '/app/settings/channels/:path*',
        permanent: true,
      },
    ]
  },
}

// const withBundleAnalyzer = require('@next/bundle-analyzer')({
//   enabled: process.env.ANALYZE === 'true',
// })
export default nextConfig
