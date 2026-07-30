// packages/redis/vitest.config.ts

import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

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
    alias: auxxSourceAlias,
  },
})
