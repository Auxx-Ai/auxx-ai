// packages/lib/scripts/run-migration-135.ts
//
// Runs entity migration 135 (`bank_deposit.bankAccount`, the relationship to
// `bank_account`, and its inverse `bank_account.deposits`) across every org.
//
// Exists for the same reason `run-migration-132-133.ts` does: the maintenance
// job records a migration as applied after its first run and will not repeat it,
// so a migration authored mid-development needs a door of its own.
//
// ⚠️ Deposits whose posted code names more than one bank account are left
// UNLINKED on purpose and reported in the migration's own warn line. That is the
// expected outcome, not a failure - see the file's doc block.
//
// Idempotent - a second run changes nothing and reports 0 changed.
//
//   npx dotenv -- npx tsx packages/lib/scripts/run-migration-135.ts

import { closePools, database, schema } from '@auxx/database'
import { migration135BankDepositBankAccount } from '../src/seed/entity-migrations/migrations/135-bank-deposit-bank-account'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)

  let changed = 0
  for (const org of orgs) {
    const result = await migration135BankDepositBankAccount.up(database, org.id)
    if (!result.alreadyUpToDate) changed++
  }
  console.log(
    `${migration135BankDepositBankAccount.id}: ran over ${orgs.length} orgs, ${changed} changed`
  )

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
