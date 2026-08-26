import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['sharp', 'imapflow', 'pino', 'thread-stream'],
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
  // `next dev` otherwise generates AGENTS.md + CLAUDE.md in this app dir on
  // every boot, pointing agents at node_modules/next/dist/docs/. We keep agent
  // instructions in the repo-root CLAUDE.md instead.
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },

  /* config options here */
}

export default nextConfig
