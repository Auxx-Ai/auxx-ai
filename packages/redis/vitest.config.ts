// packages/redis/vitest.config.ts

import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: __dirname,
  test: {
    name: 'redis',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.ts'],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
  },
  resolve: {
    alias: {
      '@auxx/logger': path.resolve(__dirname, '../logger/src'),
      '@auxx/config': path.resolve(__dirname, '../config/src'),
    },
  },
})
