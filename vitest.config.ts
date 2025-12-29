// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // This is just a fallback config for the root level
    // Individual packages use their own configs via the workspace
    globals: true,
    environment: 'node',
  },
})