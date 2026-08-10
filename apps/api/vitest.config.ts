// apps/api/vitest.config.ts

import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

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
    // The shared map, not a bespoke subset. The three-entry version that used to
    // live here omitted `@auxx/database`, so it resolved through the package.json
    // `import` condition to `dist/` — present on a laptop, absent on a fresh
    // checkout, where `deployments.test.ts` died with "Failed to resolve entry for
    // package @auxx/database" before any assertion ran.
    alias: auxxSourceAlias,
  },
})
