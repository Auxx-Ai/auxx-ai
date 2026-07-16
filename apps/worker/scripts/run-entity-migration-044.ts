// apps/worker/scripts/run-entity-migration-044.ts
/**
 * One-off runner for entity migration 044 (unit/markup/optional fields for money plans 13/17/18
 * — plans/dispatch/money/13-unit-based-pricing.md §3, 17-part-markup-pricing.md §5,
 * 18-optional-line-items.md §1/§10) across all orgs.
 * Runs ONLY 044 — deliberately not runAllEntityMigrations, so pending migrations from parallel
 * work stay untouched. Idempotent — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migration-044.ts
 */

import { database } from '@auxx/database'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '044-line-pricing-fields')
  if (!migration) throw new Error('Migration 044 not found in registry')

  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
