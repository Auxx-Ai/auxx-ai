// packages/lib/src/data-migrations/list-data-migrations.ts

import { type Database, schema } from '@auxx/database'
import { deriveDataMigrationStatuses } from './plan'
import { ALL_DATA_MIGRATIONS } from './registry'
import type { DataMigrationStatus } from './types'

/**
 * The registry joined with the ledger — one status row per available migration,
 * in registry (id asc) order. Powers the superadmin Data Migrations panel.
 */
export async function listDataMigrationStatuses(db: Database): Promise<DataMigrationStatus[]> {
  const ledger = await db.select().from(schema.DataMigration)
  return deriveDataMigrationStatuses(ALL_DATA_MIGRATIONS, ledger)
}
