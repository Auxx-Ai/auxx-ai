// apps/api/vitest.config.ts

import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'api',
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
  },

  resolve: {
    alias: {
      '@auxx/config': path.resolve(__dirname, '../../packages/config/src'),
      '@auxx/credentials': path.resolve(__dirname, '../../packages/credentials/src'),
      '@auxx/logger': path.resolve(__dirname, '../../packages/logger/src'),
    },
  },
})
