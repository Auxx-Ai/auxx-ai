// packages/ui/vitest.config.ts

import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'ui',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@auxx/ui': path.resolve(__dirname, './src'),
      // Source, not `dist` — the package's `import` condition points at a build that is not
      // guaranteed to exist when this suite runs. Mirrors `packages/lib/vitest.alias.ts`.
      '@auxx/types': path.resolve(__dirname, '../types'),
    },
  },
})
