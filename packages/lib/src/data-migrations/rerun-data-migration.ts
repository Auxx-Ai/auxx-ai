// packages/lib/src/data-migrations/rerun-data-migration.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'

/**
 * Clear a `failed` ledger row so the migration becomes pending again and re-runs on
 * the next pass. Only `failed` rows are deleted — re-running an `applied` migration is
 * a registry change, not a button. The caller enqueues a run afterwards.
 */
export async function rerunDataMigration(db: Database, id: string): Promise<void> {
  await db
    .delete(schema.DataMigration)
    .where(and(eq(schema.DataMigration.id, id), eq(schema.DataMigration.status, 'failed')))
}
