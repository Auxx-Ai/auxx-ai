// packages/lib/vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { loadEnv } from 'vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [tsconfigPaths()],

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
      alias: {
        '@auxx/database': path.resolve(__dirname, '../database/src'),
        '@auxx/lib': path.resolve(__dirname, './src'),
        '@auxx/config': path.resolve(__dirname, '../config/src'),
        '@auxx/workflow-nodes': path.resolve(__dirname, '../workflow-nodes/src'),
        '~/': path.resolve(__dirname, './src/'),
      },
    },

    define: {
      'process.env': env,
    },
  }
})
