// packages/lib/scripts/drive-native-object-export.ts
//
// Unit D of plans/accounting/tasks/67-native-provider-objects.md §6: prove every
// native object type round-trips against a real QuickBooks sandbox.
//
// Per object type, the matrix §6 asks for:
//   posting -> batch built with the right objectType -> sent -> `get` reads the
//   same total back -> rolled back -> `already_gone` on a second rollback.
//
// 🛑 THIS WRITES, on both sides. It sends real objects into the connected
// QuickBooks company and rolls them back out again. Point it at a sandbox.
// Without --confirm it only takes the census and prints what it WOULD exercise.
//
//   pnpm exec turbo dev --filter=@auxx/lambda   # the tool call leaves via 3008
//   npx dotenv -- npx tsx packages/lib/scripts/drive-native-object-export.ts \
//     <organizationId> --from 2026-09-01 --to 2026-09-30 [--confirm] [--keep]
//
// `--keep` sends and reads back but does not roll back, so the objects stay in
// the sandbox for §6's two by-hand checks (cash-basis and accrual P&L show the
// revenue once; automated sales tax has not recomputed the tax line).
//
// The adapter registers from the app layer, which a standalone script never
// boots - so this installs the same two hooks `probe-provider-sync.ts` does.

import { closePools, database, schema } from '@auxx/database'
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { buildExportBatches } from '../src/accounting/export/build-batches'
import {
  BILL_OBJECT_TYPE,
  CREDIT_MEMO_OBJECT_TYPE,
  DEPOSIT_OBJECT_TYPE,
  EXPORT_OBJECT_TYPES,
  INVOICE_OBJECT_TYPE,
  JOURNAL_OBJECT_TYPE,
  PAYMENT_OBJECT_TYPE,
  REFUND_RECEIPT_OBJECT_TYPE,
  SALES_RECEIPT_OBJECT_TYPE,
} from '../src/accounting/export/payloads'
import { rollbackExportBatch } from '../src/accounting/export/rollback'
import { sendExportBatch } from '../src/accounting/export/send'
import { avenueOfPostingType } from '../src/accounting/ledger/setup/export-settings'
import { readExportSettings } from '../src/accounting/ledger/setup/read-export-settings'
import type { PostingType } from '../src/accounting/ledger/types'
import { readActiveBookConnection } from '../src/accounting/providers/book-connections'
import {
  type AccountingProvider,
  registerAccountingProvider,
  resolveAccountingProvider,
  setConnectedProviderResolver,
} from '../src/accounting/providers/provider'

/**
 * §1's mapping table, for the census alone. The batch's own `objectType` is the
 * answer that counts: a shape whose lines do not fit falls back to `journal`,
 * and catching that fallback is half of what this script is for.
 */
const EXPECTED_OBJECT_TYPE: Partial<Record<PostingType, string>> = {
  fulfillment: `${SALES_RECEIPT_OBJECT_TYPE} | ${INVOICE_OBJECT_TYPE}`,
  invoice_issued: INVOICE_OBJECT_TYPE,
  payment: PAYMENT_OBJECT_TYPE,
  // §7, recorded from unit B: a reclass with no bank leg has no Payment shape.
  deposit_application: JOURNAL_OBJECT_TYPE,
  credit_memo: CREDIT_MEMO_OBJECT_TYPE,
  refund: REFUND_RECEIPT_OBJECT_TYPE,
  payout: DEPOSIT_OBJECT_TYPE,
  bank_deposit: DEPOSIT_OBJECT_TYPE,
  vendor_bill: BILL_OBJECT_TYPE,
}

/** A Payment applies to an Invoice, so it sends after one and withdraws before one (§5.2, §5.4). */
const SENDS_LAST = new Set([PAYMENT_OBJECT_TYPE])

interface Row {
  objectType: string
  batchId: string
  docNumber: string | null
  totalMinor: number
  send: string
  read: string
  rollback: string
  rollbackAgain: string
  url: string | null
  note: string | null
}

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const positional = argv.filter((a) => !a.startsWith('--'))
const organizationId = positional[0]
const option = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

if (!organizationId) {
  console.error(
    'Usage: drive-native-object-export.ts <organizationId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--confirm] [--keep]'
  )
  process.exit(1)
}

const TODAY = new Date().toISOString().slice(0, 10)
const FROM = option('from') ?? `${TODAY.slice(0, 4)}-01-01`
const TO = option('to') ?? TODAY

async function registerQuickbooks(): Promise<void> {
  const { createQuickbooksAccountingProvider } = await import(
    '../src/accounting/providers/quickbooks/quickbooks-accounting-provider'
  )
  registerAccountingProvider('quickbooks', async () => createQuickbooksAccountingProvider())
  setConnectedProviderResolver(async () => 'quickbooks')
}

/** Every exportable posting in range, and whether a live batch already holds it. */
async function census(orgId: string) {
  const postings = await database
    .select({
      id: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
      txnDate: schema.GlPosting.txnDate,
      docNumber: schema.GlPosting.docNumber,
      totalMinor: schema.GlPosting.totalMinor,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, orgId),
        eq(schema.GlPosting.status, 'posted'),
        gte(schema.GlPosting.txnDate, FROM),
        lte(schema.GlPosting.txnDate, TO)
      )
    )
  const exportable = postings.filter((p) => avenueOfPostingType(p.postingType) !== null)
  const claimed = exportable.length
    ? await database
        .select({ glPostingId: schema.ExportBatchPosting.glPostingId })
        .from(schema.ExportBatchPosting)
        .where(
          and(
            eq(schema.ExportBatchPosting.organizationId, orgId),
            isNull(schema.ExportBatchPosting.withdrawnAt),
            inArray(
              schema.ExportBatchPosting.glPostingId,
              exportable.map((p) => p.id)
            )
          )
        )
    : []
  const batched = new Set(claimed.map((row) => row.glPostingId))
  const byType = new Map<PostingType, { total: number; unbatched: number }>()
  for (const posting of exportable) {
    const seen = byType.get(posting.postingType) ?? { total: 0, unbatched: 0 }
    seen.total += 1
    if (!batched.has(posting.id)) seen.unbatched += 1
    byType.set(posting.postingType, seen)
  }
  return { scanned: postings.length, exportable: exportable.length, byType }
}

function printCensus(byType: Map<PostingType, { total: number; unbatched: number }>): void {
  console.log('\nCENSUS — exportable postings in range, by posting type')
  const types = Object.keys(EXPECTED_OBJECT_TYPE) as PostingType[]
  for (const postingType of types) {
    const seen = byType.get(postingType)
    const expected = EXPECTED_OBJECT_TYPE[postingType]
    console.log(
      seen
        ? `  ${postingType.padEnd(20)} ${String(seen.total).padStart(4)} posted, ${String(seen.unbatched).padStart(4)} un-batched  -> ${expected}`
        : `  ${postingType.padEnd(20)}    NO SOURCE — §6 needs one document of this type -> ${expected}`
    )
  }
  for (const [postingType, seen] of byType) {
    if (!EXPECTED_OBJECT_TYPE[postingType])
      console.log(
        `  ${postingType.padEnd(20)} ${String(seen.total).padStart(4)} posted, ${String(seen.unbatched).padStart(4)} un-batched  -> ${JOURNAL_OBJECT_TYPE} (no native shape)`
      )
  }
}

/** `manual: true` so a batch that already spent the sweep's three attempts is still sent. */
async function send(orgId: string, batchId: string): Promise<{ status: string; error?: string }> {
  const result = await sendExportBatch(database, { organizationId: orgId, batchId, manual: true })
  if (result.isErr()) return { status: 'ERROR', error: result.error.message }
  return { status: result.value.status, error: result.value.error }
}

async function readBack(
  provider: AccountingProvider,
  orgId: string,
  batch: { id: string; connectionId: string; objectType: string; providerObjectId: string | null },
  docNumber: string | null,
  expectedTotalMinor: number
): Promise<string> {
  const result = await provider.readObject(
    { organizationId: orgId, connectionId: batch.connectionId },
    { objectType: batch.objectType, externalId: batch.providerObjectId, docNumber }
  )
  if (result.isErr()) return `ERROR ${result.error.message.slice(0, 60)}`
  const read = result.value
  if (read.status !== 'found') return read.status
  if (read.totalMinor === null) return 'found (no total reported)'
  return read.totalMinor === expectedTotalMinor
    ? `found ${read.totalMinor}`
    : `TOTAL MISMATCH ours=${expectedTotalMinor} theirs=${read.totalMinor}`
}

async function main(): Promise<void> {
  const orgId = organizationId as string
  await registerQuickbooks()

  console.log(`org ${orgId} · range ${FROM} .. ${TO}`)

  // The census runs before the connection check on purpose: which documents are
  // missing is the useful answer while the wizard is still unfinished.
  const counted = await census(orgId)
  console.log(`postings in range ${counted.scanned}, exportable ${counted.exportable}`)
  printCensus(counted.byType)

  const connection = await readActiveBookConnection(database, orgId)
  if (connection) {
    const settings = await readExportSettings(orgId)
    console.log(`\nbook ${connection.bookId} · exportFrom ${connection.exportFromDate}`)
    if (settings.mode !== 'transaction')
      console.warn(
        `⚠️  export mode is '${settings.mode}'. Native objects are Transaction mode only (§7 D3);\n` +
          '   every batch below will be a journal.'
      )
  } else {
    console.error(
      '\nNO ACTIVE BOOK CONNECTION — nothing can be built or sent.\n' +
        'Finish the accounting wizard (cutoff -> opening balances -> map -> finalize) for this\n' +
        'org first — see plans/accounting/RETEST-RUNBOOK.md §2 step 4.'
    )
  }

  if (!flags.has('--confirm') || !connection) {
    console.log(
      '\nDry run. Re-run with --confirm to build, send, read back and roll back every batch\n' +
        'in this range. Create a document for each NO SOURCE row first, or §6 stays unproven.'
    )
    await closePools()
    process.exit(connection ? 0 : 1)
  }

  const built = await buildExportBatches(database, { organizationId: orgId, from: FROM, to: TO })
  if (built.isErr()) {
    console.error(`REFUSED building batches: ${built.error.message}`)
    await closePools()
    process.exit(1)
  }
  console.log(
    `\nbuilt ${built.value.built} batch(es), ${built.value.skippedBeforeCutover} skipped before the cutover`
  )

  const batches = await database
    .select()
    .from(schema.ExportBatch)
    .where(
      and(
        eq(schema.ExportBatch.organizationId, orgId),
        inArray(schema.ExportBatch.state, ['ready', 'failed'])
      )
    )
    .orderBy(desc(schema.ExportBatch.createdAt))
  if (batches.length === 0) {
    console.log('Nothing un-sent to exercise. Post a document per NO SOURCE row above.')
    await closePools()
    process.exit(0)
  }

  const provider = await resolveAccountingProvider(orgId)
  const ordered = [
    ...batches.filter((b) => !SENDS_LAST.has(b.objectType)),
    ...batches.filter((b) => SENDS_LAST.has(b.objectType)),
  ]
  const rows: Row[] = []

  for (const batch of ordered) {
    const docNumber = (batch.payload as { docNumber?: string }).docNumber ?? null
    const row: Row = {
      objectType: batch.objectType,
      batchId: batch.id,
      docNumber,
      totalMinor: batch.totalMinor,
      send: '-',
      read: '-',
      rollback: '-',
      rollbackAgain: '-',
      url: null,
      note: null,
    }
    rows.push(row)

    const sent = await send(orgId, batch.id)
    row.send = sent.status
    row.note = sent.error ? sent.error.slice(0, 120) : null
    if (sent.status !== 'sent' && sent.status !== 'already_sent') continue

    const [after] = await database
      .select()
      .from(schema.ExportBatch)
      .where(and(eq(schema.ExportBatch.organizationId, orgId), eq(schema.ExportBatch.id, batch.id)))
      .limit(1)
    if (!after) continue
    row.url =
      provider.objectUrl?.({
        objectType: after.objectType,
        externalId: after.providerObjectId ?? '',
      }) ?? null
    // The payload's total is what the provider holds (a deposit's is net of its fee line).
    const sentTotal = (after.payload as { totalMinor?: number }).totalMinor ?? after.totalMinor
    row.read = await readBack(provider, orgId, after, docNumber, sentTotal)
  }

  if (flags.has('--keep')) {
    print(rows)
    console.log(
      '\n--keep: nothing was rolled back. The two by-hand checks left in §6 are the P&L on\n' +
        'both bases showing the revenue once, and the sales-tax line not being recomputed.'
    )
    await closePools()
    process.exit(exitCode(rows, { rolledBack: false }))
  }

  // Reverse of the send order: a Payment must be withdrawn before its Invoice.
  for (const row of [...rows].reverse()) {
    if (row.send !== 'sent' && row.send !== 'already_sent') continue
    const first = await rollbackExportBatch(database, {
      organizationId: orgId,
      batchId: row.batchId,
    })
    row.rollback = first.isErr() ? `ERROR ${first.error.message.slice(0, 60)}` : first.value.status
    if (!first.isErr() && first.value.status === 'refused') row.note = first.value.message ?? null
    const second = await rollbackExportBatch(database, {
      organizationId: orgId,
      batchId: row.batchId,
    })
    row.rollbackAgain = second.isErr()
      ? `ERROR ${second.error.message.slice(0, 60)}`
      : second.value.status
  }

  print(rows)
  await closePools()
  process.exit(exitCode(rows, { rolledBack: true }))
}

function print(rows: Row[]): void {
  console.log('\nRESULT — one line per batch')
  console.log(
    `  ${'objectType'.padEnd(16)} ${'doc'.padEnd(12)} ${'total'.padStart(9)}  ${'send'.padEnd(12)} ${'read'.padEnd(24)} ${'rollback'.padEnd(12)} again`
  )
  for (const row of rows) {
    console.log(
      `  ${row.objectType.padEnd(16)} ${(row.docNumber ?? '-').padEnd(12)} ${String(row.totalMinor).padStart(9)}  ${row.send.padEnd(12)} ${row.read.padEnd(24)} ${row.rollback.padEnd(12)} ${row.rollbackAgain}`
    )
    if (row.url) console.log(`      ${row.url}`)
    if (row.note) console.log(`      note: ${row.note}`)
  }
  const covered = new Set(rows.map((row) => row.objectType))
  const missing = EXPORT_OBJECT_TYPES.filter((type) => !covered.has(type))
  if (missing.length)
    console.log(`\nNOT EXERCISED: ${missing.join(', ')} — no posting in range shapes into one.`)
}

/** Non-zero when any batch did not do the whole §6 round trip. */
function exitCode(rows: Row[], phase: { rolledBack: boolean }): number {
  const bad = rows.filter(
    (row) =>
      row.send !== 'sent' ||
      !row.read.startsWith('found ') ||
      (phase.rolledBack && (row.rollback !== 'withdrawn' || row.rollbackAgain !== 'already_gone'))
  )
  if (bad.length) console.error(`\n${bad.length} of ${rows.length} batches did not complete §6.`)
  return bad.length ? 1 : 0
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
