// packages/lib/scripts/run-migration-125.ts
//
// Runs entity-migration 125 (the whole accounting pass: the extended chart and
// its posting roles, the journal_entry, bank_deposit, bank_account,
// bank_transaction and bank_rule defs, the 1099/W-9 and write-off fields, the
// order shipment log, the accountant profile) across every org. Exists for the
// same reason `run-migration-114.ts` does: the maintenance job records a
// migration as applied after its first run and will not repeat it, so a
// migration authored mid-development needs a door of its own.
//
// Idempotent - a second run creates nothing and reports 0 changed.
//
//   npx dotenv -- npx tsx packages/lib/scripts/run-migration-125.ts

import { closePools, database, schema } from '@auxx/database'
import { migration125AccountingBooks } from '../src/seed/entity-migrations/migrations/125-accounting-books'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  let changed = 0
  for (const org of orgs) {
    const result = await migration125AccountingBooks.up(database, org.id)
    if (!result.alreadyUpToDate) changed++
  }
  console.log(`125-accounting-books: ran over ${orgs.length} orgs, ${changed} changed`)
  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
