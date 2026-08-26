// packages/lib/vitest.config.ts

import { readFileSync } from 'node:fs'
import path from 'path'
import type { Plugin } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

/**
 * Loads `.md` imports as default-exported strings so source-level imports
 * in `src/prompt-templates/template-registry.ts` resolve under Vitest the
 * same way tsdown's `loader: { '.md': 'text' }` resolves them at build time.
 */
function markdownAsText(): Plugin {
  return {
    name: 'auxx:markdown-as-text',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.md')) return null
      const source = readFileSync(id, 'utf8')
      return `export default ${JSON.stringify(source)}`
    },
  }
}

// `define: { 'process.env': env }` used to live here. It inlined a 180-key,
// ~10KB object literal at EVERY `process.env` occurrence in every transformed
// module — and it was redundant, because `src/test/setup.ts` already does the
// same `loadEnv` + `Object.assign(process.env, env)` at runtime, before any
// test module is imported. Removing it took the full suite from 252s to 148s
// (summed import 3226s -> 1905s) and turned the suite green: two tests that
// had been failing on main now pass. Likely because the inlined literal is
// frozen at config-load time, so a runtime mutation of process.env was
// invisible to the code under test — but that mechanism was not confirmed.
export default defineConfig(() => {
  return {
    plugins: [markdownAsText(), tsconfigPaths()],

    test: {
      name: 'lib',
      globals: true,
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: [
        'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
        'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        'src/test/setup.ts',
        'src/test/utils.ts',
        '**/*.config.*',
        // Shared test doubles/fixtures that live under a `__tests__/` folder.
        // The second `include` pattern above matches every file in such a
        // folder, so without this a helper module is collected as a suite and
        // fails with "No test suite found in file".
        'src/**/__tests__/support/**',
        // DB-backed integration tests — run via vitest.integration.config.ts
        // (this config mocks @auxx/database, so they can't work here).
        'src/**/*.int.test.*',
      ],
      testTimeout: 10000,
      hookTimeout: 10000,
      teardownTimeout: 10000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'dist/',
          'src/test/',
          '**/*.test.*',
          '**/*.config.*',
          '**/types.ts',
          '**/index.ts',
        ],
        thresholds: {
          global: {
            branches: 75,
            functions: 75,
            lines: 75,
            statements: 75,
          },
        },
      },
    },

    resolve: {
      // The shared map covers all fifteen workspace packages by prefix, which
      // subsumes the bespoke `@auxx/credentials/store` and `/crypto` entries
      // that used to sit here. The subset it replaces covered eight, and on a
      // checkout with no `dist` that left 304 of 507 files unable to resolve.
      alias: {
        ...auxxSourceAlias,
        '~/': path.resolve(__dirname, './src/'),
      },
    },
  }
})
