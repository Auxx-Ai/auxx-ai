// packages/lib/scripts/drive-opening-fill.ts
//
// DEV-ONLY drive for plans/accounting/tasks/19-opening-balances-from-the-provider.md §8.2.
//
// Runs `fillOpeningTrialBalanceFromProvider` for one org exactly as the
// `ledgerOpening.fillFromProvider` mutation would, then re-reads the opening
// trial balance and prints the outcome, the rows that received an amount, and
// the verdict. It WRITES the org's opening draft and the `accounting.qboOpening*`
// and provenance settings, the same writes the button makes. Nothing is posted.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-opening-fill.ts <orgId> [userId]
//
// Without a userId the org's system user is the actor.

import { database as db } from '@auxx/database'
import { getOrgCache } from '../src/cache'
import { fillOpeningTrialBalanceFromProvider } from '../src/postings/opening-trial-balance/fill-from-provider'
import { readOpeningTrialBalance } from '../src/postings/opening-trial-balance/reads'
import { registerAccountingProvider, setConnectedProviderResolver } from '../src/postings/provider'

const [orgId, userArg] = process.argv.slice(2)

if (!orgId) {
  console.error('Usage: drive-opening-fill.ts <orgId> [userId]')
  process.exit(1)
}

/**
 * The adapter registers from the APP layer (`apps/web/src/server/accounting-providers.ts`),
 * which a standalone script never boots, so the script installs the same two
 * hooks itself - the same way `probe-qbo-account-resolution.ts` does. Without
 * this every org resolves to the null provider and the fill refuses with
 * "nothing connected" on a connected org.
 */
async function registerQuickbooks() {
  const { createQuickbooksAccountingProvider } = await import(
    '../src/money/quickbooks/quickbooks-accounting-provider'
  )
  registerAccountingProvider('quickbooks', async () => createQuickbooksAccountingProvider())
  setConnectedProviderResolver(async () => 'quickbooks')
}

async function main() {
  await registerQuickbooks()
  const userId = userArg ?? (await getOrgCache().get(orgId as string, 'systemUser'))

  const result = await fillOpeningTrialBalanceFromProvider(db, orgId as string, userId)
  if (result.isErr()) {
    console.error('REFUSED:', result.error.name, result.error.message)
    process.exit(2)
  }
  console.log('OUTCOME', JSON.stringify(result.value, null, 2))

  const view = await readOpeningTrialBalance(db, orgId as string)
  if (view.isErr()) throw view.error
  const { rows, summary, cutoverDate, entry } = view.value
  console.log('\nDRAFT', entry?.id, entry?.status, 'dated', entry?.date, 'cutover', cutoverDate)
  for (const row of rows) {
    if (row.debitMinor || row.creditMinor || row.lockedByRole) {
      console.log(
        `${(row.accountCode ?? '').padEnd(6)} ${row.accountName.padEnd(40)} ` +
          `dr ${String(row.debitMinor ?? '').padStart(9)} cr ${String(row.creditMinor ?? '').padStart(9)}` +
          (row.lockedByRole ? `  [locked: ${row.lockedByRole}]` : '')
      )
    }
  }
  console.log('\nSUMMARY', JSON.stringify(summary))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
