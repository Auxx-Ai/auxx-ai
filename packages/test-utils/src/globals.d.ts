// packages/test-utils/src/globals.d.ts
// Global type definitions for the test database instance

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import type * as relations from '../../database/src/db/relations'
import type * as schema from '../../database/src/db/schema'

type DrizzleSchema = typeof schema & typeof relations

export type TestDatabase = NodePgDatabase<DrizzleSchema> & { $client: pg.Pool }

declare global {
  var __testDb: TestDatabase
  var __testPool: pg.Pool
}
