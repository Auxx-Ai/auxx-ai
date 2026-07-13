// apps/worker/scripts/run-entity-migration-040.ts
/**
 * One-off runner for entity migration 040 (`catalog_group` system entity — product-group
 * bundles, plans/dispatch/money/09-product-groups.md) across all orgs. Runs ONLY 040 —
 * deliberately not runAllEntityMigrations, so pending migrations from parallel work stay
 * untouched. Idempotent — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-040.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '040-catalog-group')
  if (!migration) throw new Error('Migration 040 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
