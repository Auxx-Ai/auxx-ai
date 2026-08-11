// apps/worker/vitest.config.ts

import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

export default defineConfig({
  test: {
    name: 'worker',
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
  },

  // Without this, Vite resolves `@auxx/*` through the `import` condition to
  // `dist/`, which does not exist on a cold CI checkout — `maintenance-worker`
  // died on `Failed to resolve entry for package "@auxx/deployment"`.
  resolve: {
    alias: auxxSourceAlias,
  },
})
