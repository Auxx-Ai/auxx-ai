// packages/test-utils/vitest.config.ts
import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',

    // This project's own suites only.
    //
    // It used to glob `packages/database`, `packages/services`,
    // `apps/web/src/server/api` and `apps/api` wholesale, on the theory that
    // those are "tests that need a real DB". They are not — every one of those
    // paths is already owned by its own project (`database`, `services`, `web`,
    // `api`), and re-collecting them here ran ordinary mock-based unit tests a
    // second time without their `~` alias, their setup files or their mocks.
    // That produced 148 failures in a full local run: `Cannot find module
    // '~/server/...'`, `Missing "./..." specifier in "@auxx/lib"`, files
    // reporting `(0 test)`, plus real-DB timeouts on suites never written for
    // one. CI does not run this project, so none of it was visible.
    //
    // Real DB-backed tests use the `.int.test.ts` suffix and belong to
    // `packages/lib/vitest.integration.config.ts` (`lib-integration`).
    include: ['./src/**/*.test.ts'],
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

  // The shared source map, not a one-package subset — see `vitest.alias.ts`.
  resolve: {
    alias: auxxSourceAlias,
  },
})
