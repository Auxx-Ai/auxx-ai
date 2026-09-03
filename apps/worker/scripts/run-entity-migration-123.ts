// apps/worker/scripts/run-entity-migration-123.ts
/**
 * One-off runner for entity migration 123 (`part_sku` optional, money plan 39
 * section 6.2) across all orgs. Runs ONLY 123 - deliberately not
 * runAllEntityMigrations, so pending migrations from parallel work stay
 * untouched. Idempotent - safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-123.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '123-part-sku-optional')
  if (!migration) throw new Error('Migration 123 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
