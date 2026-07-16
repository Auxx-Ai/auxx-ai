// apps/worker/scripts/reseed-default-dashboard.ts
/**
 * Re-seed the default entity dashboard for ONE entity type across all orgs after a
 * `DEFAULT_DASHBOARD_CONFIGS` template change: deletes each org's PRISTINE seeded
 * dashboard (single v1, no draft edits — user-touched dashboards are never deleted,
 * see `deletePristineSeededDashboards`) and re-runs migration 045's ensure so the
 * current template is inserted in its place.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/reseed-default-dashboard.ts ticket
 */

import { database } from '@auxx/database'
import { deletePristineSeededDashboards } from '@auxx/lib/seed'
import {
  ALL_ENTITY_MIGRATIONS,
  runEntityMigrationForAllOrgs,
} from '@auxx/lib/seed/entity-migrations'

async function main() {
  const entityType = process.argv[2]
  if (!entityType) throw new Error('Usage: reseed-default-dashboard.ts <entityType>')

  const deleted = await deletePristineSeededDashboards(database, entityType)
  console.log(`Deleted ${deleted} pristine seeded '${entityType}' dashboard(s)`)

  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '045-default-entity-dashboards')
  if (!migration) throw new Error('Migration 045 not found in registry')
  await runEntityMigrationForAllOrgs(database, migration)
  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
