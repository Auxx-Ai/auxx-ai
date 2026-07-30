// packages/billing/vitest.config.ts

import path from 'path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { auxxSourceAlias } from '../../vitest.alias'

export default defineConfig({
  root: __dirname,
  plugins: [tsconfigPaths()],
  test: {
    name: 'billing',
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: ['node_modules/**', 'dist/**', '**/*.config.*', 'src/__integration__/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.*', '**/*.config.*', '**/index.ts'],
    },
  },
  resolve: {
    // The last of the bespoke subsets folded into the shared map. This one was
    // not broken — billing is the project that has always passed cold — but a
    // partial map is only ever one new import away from becoming the next
    // `apps/web`, and there is no reason for five copies of the same table.
    alias: {
      ...auxxSourceAlias,
      '~/': path.resolve(__dirname, './src/'),
    },
  },
})
