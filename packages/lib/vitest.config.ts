// packages/lib/vitest.config.ts

import { readFileSync } from 'node:fs'
import path from 'path'
import { loadEnv, type Plugin } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

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

export default defineConfig(({ mode }) => {
  const monorepoRoot = path.resolve(__dirname, '../..')
  const env = { ...loadEnv(mode, monorepoRoot, ''), ...loadEnv(mode, process.cwd(), '') }

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
        '@auxx/logger': path.resolve(__dirname, '../logger/src'),
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
