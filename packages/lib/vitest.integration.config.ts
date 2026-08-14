// packages/lib/vitest.integration.config.ts
//
// DB-backed integration tests (`*.int.test.ts`) against the auxx_test database.
// Deliberately separate from vitest.config.ts: the default config mocks
// `@auxx/database` (schema becomes an empty Proxy — the "Drizzle columns
// undefined under vitest" caveat), which makes real-SQL tests impossible there.
// This config skips those mocks and boots the shared test-db infra from
// `@auxx/test-utils` (drop/recreate auxx_test + run migrations once, truncate
// all tables between tests).
//
// Run: npx vitest run --config vitest.integration.config.ts

import path from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

export default defineConfig({
  plugins: [tsconfigPaths()],

  test: {
    name: 'lib-integration',
    globals: true,
    environment: 'node',
    globalSetup: [path.resolve(__dirname, '../test-utils/src/setup/global-setup.ts')],
    setupFiles: [path.resolve(__dirname, '../test-utils/src/setup/per-test-setup.ts')],
    include: ['src/**/*.int.test.{ts,mts,cts}'],
    // per-test-setup truncates ALL tables after each test — parallel files
    // would race each other's data.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    teardownTimeout: 30000,
  },

  resolve: {
    // The shared source-alias map covers every @auxx/* workspace package (see
    // vitest.alias.ts) — a hand-picked subset here left `@auxx/types` and
    // `@auxx/services` resolving to a `dist/` that a fresh checkout does not
    // have. `@auxx/test-utils` is not part of the shared map, so it stays.
    alias: {
      ...auxxSourceAlias,
      '@auxx/test-utils': path.resolve(__dirname, '../test-utils/src'),
      '~/': path.resolve(__dirname, './src/'),
    },
  },
})
