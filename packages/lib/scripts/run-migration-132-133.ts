// packages/lib/scripts/run-migration-132-133.ts
//
// Runs entity migrations 132 (`1200 Shopify Clearing` -> `1200 Card Clearing`,
// role `clearing_shopify` -> `clearing_card`) and 133 (the `payout` def and
// `2450 Unidentified Receipts`) across every org.
//
// Exists for the same reason `run-migration-125.ts` does: the maintenance job
// records a migration as applied after its first run and will not repeat it, so
// a migration authored mid-development needs a door of its own.
//
// 🛑 IN ORDER, and 132 first. 133's chart call seeds `2450` beside the account
// 132 renames, and running 133 first on an org that still holds
// `clearing_shopify` would leave both roles present - which 132 then resolves by
// deleting the stale one, so the end state is the same, but the log reads as if
// something went wrong.
//
// Idempotent - a second run changes nothing and reports 0 changed.
//
//   npx dotenv -- npx tsx packages/lib/scripts/run-migration-132-133.ts

import { closePools, database, schema } from '@auxx/database'
import { migration132CardClearingRename } from '../src/seed/entity-migrations/migrations/132-card-clearing-rename'
import { migration133Payout } from '../src/seed/entity-migrations/migrations/133-payout'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)

  for (const migration of [migration132CardClearingRename, migration133Payout]) {
    let changed = 0
    for (const org of orgs) {
      const result = await migration.up(database, org.id)
      if (!result.alreadyUpToDate) changed++
    }
    console.log(`${migration.id}: ran over ${orgs.length} orgs, ${changed} changed`)
  }

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
