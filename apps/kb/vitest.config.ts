// apps/kb/vitest.config.ts

import path from 'path'
import { loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

export default defineConfig(({ mode }) => {
  const monorepoRoot = path.resolve(__dirname, '../..')
  const env = { ...loadEnv(mode, monorepoRoot, ''), ...loadEnv(mode, process.cwd(), '') }

  return {
    plugins: [tsconfigPaths()],

    test: {
      name: 'kb',
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
      exclude: ['node_modules/**', '.next/**', '**/*.config.*'],
      testTimeout: 10000,
      hookTimeout: 10000,
      teardownTimeout: 10000,
    },

    resolve: {
      alias: {
        '~': path.resolve(__dirname, './src'),
        // Resolve every @auxx package to SOURCE, not the built dist — a stale
        // dist would silently test old permission composition code, and on a
        // cold CI checkout there is no dist to resolve at all. The bespoke
        // subset that used to live here missed `@auxx/types`, which is what
        // `capability-set` reaches for.
        ...auxxSourceAlias,
      },
    },

    define: {
      'process.env': env,
    },
  }
})
