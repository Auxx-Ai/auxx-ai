// apps/worker/vitest.config.ts

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'worker',
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*'],
  },
})
