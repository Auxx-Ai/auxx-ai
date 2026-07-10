// apps/worker/scripts/run-entity-migration-035.ts
/**
 * One-off runner for entity migration 035 (add `invoice` + `payment` system entities,
 * money MI1 build spec §D) across all orgs. Runs ONLY 035 — deliberately not
 * runAllEntityMigrations, so pending migrations from parallel work stay untouched.
 * Idempotent — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-035.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '035-money-invoicing')
  if (!migration) throw new Error('Migration 035 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
