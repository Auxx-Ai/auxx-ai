// packages/lib/scripts/drive-journal-entry.ts
//
// DEV SCRIPT. Drives HANDOFF slot 1A end to end against a real org: create a
// draft, preview it, post it, reverse it, and prove the books still tie.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-journal-entry.ts
//
// Writes real postings. Point it at a dev org only.

import { closePools, database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { listChartAccounts, verifyBooksBalance } from '../src/postings'
import {
  createJournalEntry,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  updateJournalEntry,
} from '../src/postings/journal-entries'
import { listPostings, listPostingsForSource } from '../src/postings/list-postings'

function show(label: string, value: unknown) {
  console.log(`\n── ${label} ──`)
  console.log(JSON.stringify(value, null, 2))
}

async function main() {
  const orgId = process.env.DRIVE_ORG_ID ?? (await firstOrgWithChart())
  if (!orgId) throw new Error('No organization with a provisioned chart found')
  const userId = await firstUser(orgId)
  console.log(`org=${orgId} user=${userId}`)

  const chart = await listChartAccounts(database, orgId)
  if (chart.isErr()) throw chart.error
  const accounts = chart.value.filter((a) => a.isActive)
  const debit = accounts.find((a) => a.accountType === 'expense')
  const credit = accounts.find((a) => a.accountType === 'liability')
  const inventory = accounts.find((a) => a.code === '1310')
  if (!debit || !credit) throw new Error('Chart has no expense/liability pair to code against')
  console.log(`debit=${debit.code} ${debit.name}  credit=${credit.code} ${credit.name}`)

  // 1. Create a draft with no lines, then fill them in.
  const created = await createJournalEntry(database, orgId, userId, {
    date: new Date().toISOString().slice(0, 10),
    memo: 'Slot 1A drive script',
  })
  if (created.isErr()) throw created.error
  show('created', created.value)

  const updated = await updateJournalEntry(database, orgId, userId, {
    journalEntryId: created.value.id,
    lines: [
      { accountCode: debit.code, direction: 'debit', amountMinor: 12_345, memo: 'the debit' },
      { accountCode: credit.code, direction: 'credit', amountMinor: 12_345 },
    ],
  })
  if (updated.isErr()) throw updated.error
  show('updated', updated.value)

  // 2. Preview.
  const preview = await previewJournalEntry(database, orgId, {
    journalEntryId: created.value.id,
  })
  if (preview.isErr()) throw preview.error
  show('preview', preview.value)

  // 3. The inventory refusal, as a preview override (nothing is persisted).
  if (inventory) {
    const refused = await previewJournalEntry(database, orgId, {
      journalEntryId: created.value.id,
      lines: [
        { accountCode: inventory.code, direction: 'debit', amountMinor: 100 },
        { accountCode: credit.code, direction: 'credit', amountMinor: 100 },
      ],
    })
    if (refused.isErr()) throw refused.error
    show('inventory refusal', refused.value.blockedBy)
  }

  // 4. The unbalanced refusal.
  const unbalanced = await previewJournalEntry(database, orgId, {
    journalEntryId: created.value.id,
    lines: [
      { accountCode: debit.code, direction: 'debit', amountMinor: 100 },
      { accountCode: credit.code, direction: 'credit', amountMinor: 90 },
    ],
  })
  show('unbalanced refusal', unbalanced.isErr() ? unbalanced.error.message : 'NOT REFUSED')

  // 5. Post.
  const posted = await postJournalEntry(database, orgId, userId, {
    journalEntryId: created.value.id,
  })
  if (posted.isErr()) throw posted.error
  show('posted', posted.value)

  // 6. The lists.
  const period = new Date().toISOString().slice(0, 7)
  const inPeriod = await listPostings(database, { organizationId: orgId, periodKey: period })
  show(`listPostings(${period})`, inPeriod.isErr() ? inPeriod.error.message : inPeriod.value)

  const forSource = await listPostingsForSource(database, {
    organizationId: orgId,
    sourceType: 'journal_entry',
    sourceId: created.value.id,
  })
  show('listPostingsForSource', forSource.isErr() ? forSource.error.message : forSource.value)

  // 7. Reverse.
  const reversed = await reverseJournalEntry(database, orgId, userId, {
    journalEntryId: created.value.id,
  })
  if (reversed.isErr()) throw reversed.error
  show('reversed', reversed.value)

  const after = await listPostingsForSource(database, {
    organizationId: orgId,
    sourceType: 'journal_entry',
    sourceId: created.value.id,
  })
  show('postings after reversal', after.isErr() ? after.error.message : after.value)

  // 8. The books.
  const balance = await verifyBooksBalance(database, orgId)
  show('verifyBooksBalance', balance.isErr() ? balance.error.message : balance.value)

  await closePools()
  process.exit(0)
}

async function firstOrgWithChart(): Promise<string | null> {
  const [row] = await database
    .select({ organizationId: schema.GlRoleAssignment.organizationId })
    .from(schema.GlRoleAssignment)
    .limit(1)
  return row?.organizationId ?? null
}

async function firstUser(organizationId: string): Promise<string> {
  const [row] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!row) throw new Error(`No member in org ${organizationId}`)
  return row.userId
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
