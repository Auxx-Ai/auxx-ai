// apps/worker/scripts/run-entity-migration-042.ts
/**
 * One-off runner for entity migration 042 (`quote_deposit_type`/`quote_deposit_value` fields —
 * money MP2 deposits, plans/dispatch/money/11-mp2-customer-payments.md §B.2) across all orgs.
 * Runs ONLY 042 — deliberately not runAllEntityMigrations, so pending migrations from parallel
 * work stay untouched. Idempotent — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-042.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '042-quote-deposit-fields')
  if (!migration) throw new Error('Migration 042 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
