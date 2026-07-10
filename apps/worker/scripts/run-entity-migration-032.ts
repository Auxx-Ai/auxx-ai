// apps/worker/scripts/run-entity-migration-032.ts
/**
 * One-off runner for entity migration 032 (money quoting: catalog_item + quote +
 * line_item defs, plans/dispatch/money/03-mq1-build.md §D) across all orgs. Runs
 * ONLY 032 — deliberately not runAllEntityMigrations, so pending migrations from
 * parallel work (031/033 dialog-flag passes) stay untouched.
 * Idempotent — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-032.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '032-money-quoting')
  if (!migration) throw new Error('Migration 032 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
