// packages/test-utils/src/globals.ts
// Provides typed access to the test database. Populated by per-test-setup.ts.

import type { TestDatabase } from './globals.d'

/** The test Drizzle database instance. Available after per-test-setup.ts runs. */
export function getTestDb(): TestDatabase {
  if (!globalThis.__testDb) {
    throw new Error(
      'Test database not initialized. Ensure per-test-setup.ts is configured as a setupFile.'
    )
  }
  return globalThis.__testDb
}
