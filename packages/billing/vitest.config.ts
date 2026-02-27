// packages/billing/vitest.config.ts

import path from 'path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: __dirname,
  plugins: [tsconfigPaths()],
  test: {
    name: 'billing',
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.*', '**/*.config.*', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@auxx/billing': path.resolve(__dirname, './src'),
      '@auxx/credentials': path.resolve(__dirname, '../credentials/src'),
      '@auxx/database': path.resolve(__dirname, '../database/src'),
      '@auxx/logger': path.resolve(__dirname, '../logger/src'),
      '@auxx/lib': path.resolve(__dirname, '../lib/src'),
      '~/': path.resolve(__dirname, './src/'),
    },
  },
})
