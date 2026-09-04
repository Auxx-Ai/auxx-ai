// packages/lib/scripts/drive-opening-trial-balance.ts
//
// Drive the opening trial balance end to end against a real organization, the
// way the router does: save the draft, preview it, post it, then verify the
// books balance and that the posting landed on the cutover date.
//
// This is the SERVER half of slot 1C's drive. The browser pass covers the
// wizard; this covers the lib and what the router calls, against real Postgres
// rather than doubles, which is where the `journal_entry` field-value round trip
// and the claim's unique index actually live.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-opening-trial-balance.ts <organizationId>

import { database } from '@auxx/database'
import { onCacheEvent } from '../src/cache'
import {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  readOpeningTrialBalance,
  saveOpeningTrialBalance,
} from '../src/postings/opening-trial-balance'
import { listChartAccounts } from '../src/postings/role-map'
import { verifyBooksBalance } from '../src/postings/verify-balance'
import { batchUpdateOrganizationSettings } from '../src/settings/settings-service'

const organizationId = process.argv[2]
const userId = process.argv[3] ?? 'system'
if (!organizationId) {
  console.error('usage: drive-opening-trial-balance.ts <organizationId> [userId]')
  process.exit(1)
}

async function main() {
  const orgId = organizationId as string

  // `--setup` seeds the five settings the wizard's first two pages write, for a
  // fresh org that has never been through it. The cache bust is not optional:
  // `updateOrganizationSetting` fires NO cache event of its own - the tRPC
  // router does - so a non-router writer that skipped it would leave the org
  // serving the pre-write values (see `opening-baseline.ts`).
  if (process.argv.includes('--setup')) {
    await batchUpdateOrganizationSettings({
      organizationId: orgId,
      settings: [
        { key: 'accounting.cutoffPeriod', value: '2026-12' },
        { key: 'accounting.bookTimeZone', value: 'America/New_York' },
        { key: 'accounting.openingRawMaterials', value: 100_000 },
        { key: 'accounting.openingWip', value: 0 },
        { key: 'accounting.openingFinishedGoods', value: 250_000 },
        { key: 'accounting.qboOpeningRawMaterials', value: 100_000 },
        { key: 'accounting.qboOpeningWip', value: 0 },
        { key: 'accounting.qboOpeningFinishedGoods', value: 250_000 },
        { key: 'accounting.qboOpeningJournalRef', value: 'JE-1042' },
        { key: 'accounting.setupState', value: 'finalized' },
      ],
    })
    await onCacheEvent('org.settings.changed', { orgId })
    console.log('seeded setup settings')
  }

  const before = await readOpeningTrialBalance(database, orgId)
  if (before.isErr()) throw before.error
  console.log('read:', {
    cutoffPeriod: before.value.cutoffPeriod,
    bookTimeZone: before.value.bookTimeZone,
    cutoverDate: before.value.cutoverDate,
    setupState: before.value.setupState,
    frozen: before.value.frozen,
    chartRows: before.value.rows.length,
    lockedRows: before.value.rows
      .filter((r) => r.lockedByRole)
      .map((r) => [r.accountCode, r.debitMinor]),
    summary: before.value.summary,
    entry: before.value.entry?.id ?? null,
  })

  const chart = await listChartAccounts(database, orgId)
  if (chart.isErr()) throw chart.error
  const codes = new Set(chart.value.map((a) => a.code))
  for (const code of ['1000', '3900']) {
    if (!codes.has(code)) throw new Error(`chart is missing ${code}`)
  }

  // The three locked inventory rows, verbatim from what the read resolved, plus
  // cash against opening balance equity so the whole thing balances.
  const inventory = before.value.rows
    .filter((row) => row.lockedByRole && row.debitMinor)
    .map((row) => ({
      accountCode: row.accountCode,
      direction: 'debit' as const,
      amountMinor: row.debitMinor as number,
    }))
  const inventoryTotal = inventory.reduce((sum, line) => sum + line.amountMinor, 0)

  const lines = [
    { accountCode: '1000', direction: 'debit' as const, amountMinor: 500_000 },
    ...inventory,
    { accountCode: '3900', direction: 'credit' as const, amountMinor: 500_000 + inventoryTotal },
  ]

  const saved = await saveOpeningTrialBalance(database, orgId, userId, { lines })
  if (saved.isErr()) throw saved.error
  console.log('saved:', {
    id: saved.value.id,
    number: saved.value.number,
    date: saved.value.date,
    status: saved.value.status,
    kind: saved.value.kind,
    lines: saved.value.lines.length,
  })

  const preview = await previewOpeningTrialBalance(database, orgId)
  if (preview.isErr()) throw preview.error
  console.log('preview:', {
    postingType: preview.value.postingType,
    periodKey: preview.value.periodKey,
    txnDate: preview.value.txnDate,
    docNumber: preview.value.docNumber,
    totalMinor: preview.value.totalMinor,
    blockedBy: preview.value.blockedBy,
  })

  const posted = await postOpeningTrialBalance(database, orgId, userId)
  if (posted.isErr()) throw posted.error
  console.log('posted:', posted.value)

  const after = await readOpeningTrialBalance(database, orgId)
  if (after.isErr()) throw after.error
  console.log('after:', {
    frozen: after.value.frozen,
    entryStatus: after.value.entry?.status,
    posting: after.value.posting,
  })

  const balance = await verifyBooksBalance(database, orgId)
  if (balance.isErr()) throw balance.error
  console.log('verifyBooksBalance:', {
    balanced: balance.value.balanced,
    postingsChecked: balance.value.postingsChecked,
    discrepancies: balance.value.discrepancies,
  })

  // The freeze, from the other side: a second save has to be refused now.
  const refused = await saveOpeningTrialBalance(database, orgId, userId, { lines })
  console.log(
    'save after post:',
    refused.isErr() ? refused.error.message.slice(0, 120) : 'ALLOWED (wrong)'
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
