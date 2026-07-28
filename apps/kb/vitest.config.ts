// apps/kb/vitest.config.ts

import path from 'path'
import { loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

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
        // Resolve @auxx/lib to SOURCE, not the built dist — a stale dist would
        // silently test old permission composition code.
        '@auxx/database/enums': path.resolve(monorepoRoot, 'packages/database/src/enums.ts'),
        '@auxx/database': path.resolve(monorepoRoot, 'packages/database/src'),
        '@auxx/lib': path.resolve(monorepoRoot, 'packages/lib/src'),
        '@auxx/config': path.resolve(monorepoRoot, 'packages/config/src'),
      },
    },

    define: {
      'process.env': env,
    },
  }
})
