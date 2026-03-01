// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './apps/api/vitest.config.ts',
      './apps/web/vitest.config.ts',
      './packages/billing/vitest.config.ts',
      './packages/lib/vitest.config.ts',
      './packages/workflow-nodes/vitest.config.ts',
      './packages/database/vitest.config.ts',
      './packages/credentials/vitest.config.ts',
      './packages/test-utils/vitest.config.ts',
    ],
  },
})
