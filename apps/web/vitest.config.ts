// apps/web/vitest.config.ts

import react from '@vitejs/plugin-react'
import path from 'path'
import { loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tsconfigPaths()],

    test: {
      name: 'web',
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: [
        'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
        'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        '.next/**',
        'src/test/setup.ts',
        'src/test/utils.tsx',
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
          '.next/',
          'src/test/',
          '**/*.test.*',
          '**/*.config.*',
          '**/types.ts',
        ],
        thresholds: {
          global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70,
          },
        },
      },
    },

    resolve: {
      // The shared map, not a bespoke subset. The subset that used to live here
      // was missing most of the workspace AND pointed `@auxx/database` at the
      // package ROOT rather than `src`, which sent resolution straight back
      // through the package.json `import` condition to `dist/`. On a laptop that
      // directory exists and nothing looks wrong; on a fresh checkout 105 of 148
      // files fail to resolve before a single assertion runs.
      alias: {
        '~': path.resolve(__dirname, './src'),
        ...auxxSourceAlias,
      },
    },

    define: {
      'process.env': env,
    },
  }
})
