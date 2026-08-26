// packages/lib/scripts/run-migration-107.ts
//
// Re-runs entity-migration 107 (order) across every org. Migration 107 is
// idempotent, so this is safe to repeat; it exists because the maintenance job
// records the migration as `applied` after the first run and will not repeat it
// when the migration's body changes during development.
//
//   npx dotenv -- npx tsx packages/lib/scripts/run-migration-107.ts

import { database, schema } from '@auxx/database'
import { migration107Order } from '../src/seed/entity-migrations/migrations/107-order'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  let changed = 0
  for (const org of orgs) {
    const result = await migration107Order.up(database, org.id)
    if (!result.alreadyUpToDate) changed++
  }
  console.log(`107-order: ran over ${orgs.length} orgs, ${changed} reported changes`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
