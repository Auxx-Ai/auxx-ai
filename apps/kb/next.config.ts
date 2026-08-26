// apps/kb/next.config.ts

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  cacheComponents: true,
  serverExternalPackages: ['imapflow', 'pino', 'thread-stream'],
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
  // `next dev` otherwise generates AGENTS.md + CLAUDE.md in this app dir on
  // every boot, pointing agents at node_modules/next/dist/docs/. We keep agent
  // instructions in the repo-root CLAUDE.md instead.
  agentRules: false,
  poweredByHeader: false,
}

export default nextConfig
