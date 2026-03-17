// packages/billing/vitest.integration.config.ts

import path from 'path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: __dirname,
  plugins: [tsconfigPaths()],
  test: {
    name: 'billing-integration',
    globals: true,
    environment: 'node',
    include: ['src/__integration__/**/*.integration.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 180_000, // 3 min — clock advances + webhook delivery + polling
    hookTimeout: 120_000, // 2 min — setup creates Stripe resources + seeds DB
    pool: 'forks',
    maxForks: 1, // Sequential — shared Stripe account + DB
    setupFiles: ['src/__integration__/setup.ts'],
    bail: 1, // Stop on first failure — tests in a suite are sequential/dependent
  },
  resolve: {
    alias: {
      '@auxx/billing': path.resolve(__dirname, './src'),
      '@auxx/credentials': path.resolve(__dirname, '../credentials/src'),
      '@auxx/database': path.resolve(__dirname, '../database/src'),
      '@auxx/logger': path.resolve(__dirname, '../logger/src'),
      '@auxx/lib': path.resolve(__dirname, '../lib/src'),
      '@auxx/types': path.resolve(__dirname, '../types'),
      '~/': path.resolve(__dirname, './src/'),
    },
  },
})
