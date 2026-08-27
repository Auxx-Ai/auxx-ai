// packages/lib/scripts/run-migration-108.ts
//
// Re-runs entity-migration 108 (purchase-to-pay: receiving cost on
// stock_movement, purchase_order + purchase_order_line, vendor_bill +
// vendor_bill_line, the inert vendor_payment pair, gl_account +
// gl_posting_line) across every org.
//
// Migration 108 is idempotent, so this is safe to repeat; it exists because the
// maintenance job records the migration as `applied` after the first run and
// will not repeat it when the migration's body changes during development.
//
// Everything the migration creates lands in ONE pass, so there is no ordering
// requirement against a sibling script - the whole purchase-to-pay shape is
// this one file.
//
//   npx dotenv -- npx tsx packages/lib/scripts/run-migration-108.ts

import { database, schema } from '@auxx/database'
import { migration108Purchasing } from '../src/seed/entity-migrations/migrations/108-purchasing'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  let changed = 0
  for (const org of orgs) {
    // New definitions and fields are invisible to every read path until the
    // per-org caches that serve them are dropped. `up()` does that itself for
    // any org it changed, so this script does not have to.
    const result = await migration108Purchasing.up(database, org.id)
    if (!result.alreadyUpToDate) changed++
  }

  console.log(`108-purchasing: ran over ${orgs.length} orgs, ${changed} reported changes`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
