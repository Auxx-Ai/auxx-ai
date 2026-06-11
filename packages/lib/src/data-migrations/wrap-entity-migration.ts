// packages/lib/src/data-migrations/wrap-entity-migration.ts

import { type EntityMigration, runEntityMigrationForAllOrgs } from '../seed/entity-migrations'
import type { DataMigrationDef } from './types'

/**
 * Adapt an existing per-org {@link EntityMigration} into a registered
 * {@link DataMigrationDef}. The migration's `id`/`description` carry over as the
 * ledger id; `run()` drives it across every org via {@link runEntityMigrationForAllOrgs},
 * which throws an aggregate on any per-org failure → ledger marks it `failed`.
 *
 * The migration's internal per-org idempotency checks stop being the exactly-once
 * mechanism (the ledger is that now) and become the retry/repair safety net.
 */
export function wrapEntityMigration(migration: EntityMigration): DataMigrationDef {
  return {
    id: migration.id,
    description: migration.description,
    run: (db) => runEntityMigrationForAllOrgs(db, migration),
  }
}
