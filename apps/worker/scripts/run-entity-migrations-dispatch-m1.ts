// apps/worker/scripts/run-entity-migrations-dispatch-m1.ts
/**
 * One-off runner for entity migrations 029 (work_order) + 030 (service_request)
 * across all orgs (plans/dispatch/03-m1-records.md §J.5). The runner itself is
 * idempotent per migration — safe to re-run to confirm alreadyUpToDate.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/run-entity-migrations-dispatch-m1.ts
 */

import { database } from '@auxx/database'
import { runAllEntityMigrations } from '@auxx/lib/seed/entity-migrations'

async function main() {
  const results = await runAllEntityMigrations(database)
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2))
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
