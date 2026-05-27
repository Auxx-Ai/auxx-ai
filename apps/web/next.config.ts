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
      // OAuth-popup flows (see use-connect-flow.tsx) need the opener to
      // keep its handle on the popup it opened, even when the popup
      // navigates cross-origin to a provider. `same-origin-allow-popups`
      // is the standard COOP for that pattern — Stripe, Google, Auth0,
      // etc. all use it. Without it, Chrome logs "Cross-Origin-Opener-
      // Policy policy would block the window.closed call" on every
      // `popup.closed` read in our 500ms popup-watch interval.
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    ]
    return [
      // Everything except /embed/* and the chat-widget preview embed gets the
      // strict no-framing policy. The extension iframe at /embed/* needs to
      // be framed by the chrome-extension origin (CSP set in proxy.ts), and
      // /preview/widget/*/embed needs to be framed same-origin by the chat-
      // widget settings page (live preview pane in apps/web/.../settings).
      {
        source: '/((?!embed/|preview/widget/.+?/embed).*)',
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
      // Same-origin framing for the chat-widget live preview pane.
      {
        source: '/preview/widget/:integrationId/embed',
        headers: [
          ...baselineHeaders,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self'; upgrade-insecure-requests",
          },
        ],
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
