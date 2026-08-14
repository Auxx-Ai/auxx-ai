// apps/extension/vitest.config.ts

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: __dirname,
  define: {
    // Injected by vite.config.ts at build time; pin a stable value for tests.
    __AUXX_WEBAPP_URL__: JSON.stringify('http://localhost:3000'),
  },
  test: {
    name: 'extension',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
  },
})
