// packages/credentials/vitest.config.ts

import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: __dirname,
  test: {
    name: 'credentials',
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.*', '**/*.config.*', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@auxx/credentials': path.resolve(__dirname, './src'),
    },
  },
})
