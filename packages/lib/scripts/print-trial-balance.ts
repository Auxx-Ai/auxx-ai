// packages/lib/scripts/print-trial-balance.ts
//
// Driver for HANDOFF slot 1E (statements). Prints the trial balance and
// balance sheet for the first organization with a posted GlPosting, then
// confirms the trial balance ties to `verifyBooksBalance` for the same org.
//
// usage: npx dotenv -- npx tsx packages/lib/scripts/print-trial-balance.ts [organizationId]

import { database, schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'
import { readBalanceSheet } from '../src/postings/reports/balance-sheet'
import { readTrialBalance } from '../src/postings/reports/trial-balance'
import { verifyBooksBalance } from '../src/postings/verify-balance'

async function firstOrgWithPostedEntries(): Promise<string | null> {
  const [row] = await database
    .select({ organizationId: schema.GlPosting.organizationId })
    .from(schema.GlPosting)
    .where(inArray(schema.GlPosting.status, ['posted', 'reversed']))
    .limit(1)
  return row?.organizationId ?? null
}

const organizationId = process.argv[2] ?? (await firstOrgWithPostedEntries())

if (!organizationId) {
  console.error(
    'No organization has a posted GlPosting row (status posted/reversed). Nothing to print.'
  )
  process.exit(1)
}

console.log(`organization: ${organizationId}\n`)

const today = new Date().toISOString().slice(0, 10)

const tbResult = await readTrialBalance(database, { organizationId, to: today })
if (tbResult.isErr()) {
  console.error('readTrialBalance failed:', tbResult.error)
  process.exit(1)
}
const tb = tbResult.value

console.log('=== Trial balance ===')
console.log(`as of ${tb.to}`)
console.table(
  tb.rows.map((row) => ({
    code: row.accountCode,
    name: row.accountName,
    type: row.accountType ?? '(not in chart)',
    debit: row.debitMinor,
    credit: row.creditMinor,
    balance: row.balanceMinor,
    inChart: row.inChart,
  }))
)
console.log(`total debit:  ${tb.totalDebitMinor}`)
console.log(`total credit: ${tb.totalCreditMinor}`)
console.log(`balanced:     ${tb.balanced}\n`)

const bsResult = await readBalanceSheet(database, { organizationId, asOf: today })
if (bsResult.isErr()) {
  console.error('readBalanceSheet failed:', bsResult.error)
  process.exit(1)
}
const bs = bsResult.value

console.log('=== Balance sheet ===')
console.log(`as of ${bs.asOf}`)
console.log('-- Assets --')
console.table(
  bs.assets.map((r) => ({ code: r.accountCode, name: r.accountName, balance: r.balanceMinor }))
)
console.log('-- Liabilities --')
console.table(
  bs.liabilities.map((r) => ({ code: r.accountCode, name: r.accountName, balance: r.balanceMinor }))
)
console.log('-- Equity --')
console.table(
  bs.equity.map((r) => ({ code: r.accountCode, name: r.accountName, balance: r.balanceMinor }))
)
console.log(
  `retained earnings: ${bs.retainedEarnings.balanceMinor} (${bs.retainedEarnings.priorYearsSource}: ` +
    `prior ${bs.retainedEarnings.priorYearsMinor} + current ${bs.retainedEarnings.currentPeriodMinor})`
)
console.log(`total assets:                 ${bs.totalAssetsMinor}`)
console.log(`total liabilities + equity:   ${bs.totalLiabilitiesMinor + bs.totalEquityMinor}`)
console.log(`verdict (assets = L + E):     ${bs.verdict}\n`)

const verifyResult = await verifyBooksBalance(database, organizationId)
if (verifyResult.isErr()) {
  console.error('verifyBooksBalance failed:', verifyResult.error)
  process.exit(1)
}
const verify = verifyResult.value

console.log('=== verifyBooksBalance ===')
console.log(`postings checked: ${verify.postingsChecked}`)
console.log(`balanced:         ${verify.balanced}`)
if (verify.discrepancies.length > 0) console.table(verify.discrepancies)

const ties = tb.totalDebitMinor === tb.totalCreditMinor && verify.balanced
console.log(`\nTrial balance ties to verifyBooksBalance: ${ties}`)

process.exit(0)
