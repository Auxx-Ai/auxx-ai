// apps/web/vitest.config.ts

import react from '@vitejs/plugin-react'
import path from 'path'
import { loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

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
      alias: {
        '~': path.resolve(__dirname, './src'),
        '@auxx/database/enums': path.resolve(__dirname, '../../packages/database/src/enums.ts'),
        '@auxx/database': path.resolve(__dirname, '../../packages/database'),
        '@auxx/lib': path.resolve(__dirname, '../../packages/lib/src'),
        '@auxx/config': path.resolve(__dirname, '../../packages/config/src'),
        '@auxx/workflow-nodes': path.resolve(__dirname, '../../packages/workflow-nodes/src'),
      },
    },

    define: {
      'process.env': env,
    },
  }
})
