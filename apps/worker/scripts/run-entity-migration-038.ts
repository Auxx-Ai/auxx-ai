// apps/worker/scripts/run-entity-migration-038.ts
/**
 * One-off runner for entity migration 038 (invoice.visitId field + seeded "Drafts" table view,
 * money MI2 automation build, plans/dispatch/money/08-mi2-build.md §I) across all orgs. Runs
 * ONLY 038 — deliberately not runAllEntityMigrations, so pending migrations from parallel work
 * stay untouched. Idempotent — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-038.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '038-invoice-automation')
  if (!migration) throw new Error('Migration 038 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
