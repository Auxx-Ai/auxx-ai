// packages/test-utils/vitest.config.ts
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',

    // Find .test.ts files across packages that need real DB
    include: [
      './src/**/*.test.ts',
      '../../packages/database/src/**/*.test.ts',
      '../../packages/services/src/**/*.test.ts',
      '../../apps/web/src/server/api/**/*.test.ts',
      '../../apps/api/src/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'dist/**'],

    // Global setup/teardown for DB initialization
    globalSetup: './src/setup/global-setup.ts',

    // Test execution
    globals: true,
    testTimeout: 20_000,

    // Sequential within a file, parallel across files
    pool: 'threads',
    isolate: true,

    // Per-test cleanup hooks
    setupFiles: ['./src/setup/per-test-setup.ts'],
  },

  resolve: {
    alias: {
      '@auxx/logger': path.resolve(__dirname, '../logger/src'),
    },
  },
})
