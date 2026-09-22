// packages/lib/src/accounting/export/build-batches.ts
// One posted, un-batched posting (Transaction mode) or one summary row (Summary
// mode) becomes one `ExportBatch`. See plans/accounting/TARGET.md §3 and
// plans/accounting/tasks/67-native-provider-objects.md.

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { DOC_NUMBER_MAX_LENGTH } from '../ledger/builders/doc-number'
import type { AccountRole } from '../ledger/builders/entry'
import { readLedgerSummary } from '../ledger/reads/ledger-summary'
import { findLinkedPostings } from '../ledger/reads/list-postings'
import type { ExportAvenue } from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import type { CounterpartyType, PostingType } from '../ledger/types'
import { readSourceAccounts } from '../money/customer-money/source-reads'
import { readActiveBookConnection } from '../providers/book-connections'
import { type AccountingProviderLimits, resolveAccountingProvider } from '../providers/provider'
import { type UnbuiltGroupKey, unbuiltGroupKeyString } from './client'
import { type ShapeForPostingLine, shapeForPosting, wantsSalesReceipt } from './object-shape'
import {
  type ExportJournalPayload,
  exportJournalSchema,
  hashExportPayload,
  JOURNAL_OBJECT_TYPE,
} from './payloads'
import { PRIVATE_NOTE_MAX_LENGTH } from './payloads/shared'

const logger = createScopedLogger('postings:export:build-batches')

export interface BuildExportBatchesInput {
  organizationId: string
  /** Inclusive accounting dates, `YYYY-MM-DD`. */
  from: string
  to: string
  /** Build only these postings - the auto-send path after one commit. */
  glPostingIds?: string[]
  /** Summary mode: build only this group - the Outbox row's own Build button. */
  group?: UnbuiltGroupKey
}

export interface BuildExportBatchesResult {
  built: number
  batchIds: string[]
  /** Postings skipped because they are dated before the mode cutover. */
  skippedBeforeCutover: number
  /** False when the org has no active book connection; nothing is built. */
  connected: boolean
}

interface CandidateRow {
  id: string
  postingType: PostingType
  avenue: ExportAvenue | null
  txnDate: string
  docNumber: string | null
  currency: string
  storeId: string | null
  railId: string | null
  totalMinor: number
  built: unknown
}

/** A store's native-object settings (T14). Absent store id resolves as `auto`. */
interface StoreExportSetting {
  exportShape: 'auto' | 'invoice'
}

/** One receipt (`payment` posting) parented on an order, for the fully-paid check (§1). */
interface ReceiptInfo {
  glPostingId: string
  totalMinor: number
  txnDate: string
}

const POSTINGS_PAGE_SIZE = 5000

/**
 * Posted entries in range, with whether a live batch already holds each one.
 *
 * The anti-join is against `ExportBatchPosting`'s live rows, which is the same
 * partial unique index that makes a second batch on one posting impossible.
 * Read to exhaustion by keyset on (txnDate, id): a truncated read would report
 * `built` for a range it only half saw, and in Summary mode would drop already-
 * batched postings from the exclusion list and sum them twice.
 */
async function readPostingsInRange(
  db: Database,
  input: BuildExportBatchesInput
): Promise<Array<CandidateRow & { batched: boolean }>> {
  const rows: Array<CandidateRow & { batchedId: string | null }> = []
  let after: { txnDate: string; id: string } | null = null
  for (;;) {
    const page = await readPostingsPage(db, input, after)
    rows.push(...page)
    if (page.length < POSTINGS_PAGE_SIZE) break
    const last = page[page.length - 1]!
    after = { txnDate: last.txnDate, id: last.id }
  }
  return rows.map(({ batchedId, ...row }) => ({ ...row, batched: batchedId !== null }))
}

async function readPostingsPage(
  db: Database,
  input: BuildExportBatchesInput,
  after: { txnDate: string; id: string } | null
) {
  return db
    .select({
      id: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
      avenue: schema.GlPosting.avenue,
      txnDate: schema.GlPosting.txnDate,
      docNumber: schema.GlPosting.docNumber,
      currency: schema.GlPosting.currency,
      storeId: schema.GlPosting.storeId,
      railId: schema.GlPosting.railId,
      totalMinor: schema.GlPosting.totalMinor,
      built: schema.GlPosting.built,
      batchedId: schema.ExportBatchPosting.id,
    })
    .from(schema.GlPosting)
    .leftJoin(
      schema.ExportBatchPosting,
      and(
        eq(schema.ExportBatchPosting.organizationId, schema.GlPosting.organizationId),
        eq(schema.ExportBatchPosting.glPostingId, schema.GlPosting.id),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
    .where(
      and(
        eq(schema.GlPosting.organizationId, input.organizationId),
        eq(schema.GlPosting.status, 'posted'),
        gte(schema.GlPosting.txnDate, input.from),
        lte(schema.GlPosting.txnDate, input.to),
        // The auto-send path names its postings; read those rows, not the whole day.
        input.glPostingIds?.length ? inArray(schema.GlPosting.id, input.glPostingIds) : undefined,
        after
          ? or(
              gt(schema.GlPosting.txnDate, after.txnDate),
              and(eq(schema.GlPosting.txnDate, after.txnDate), gt(schema.GlPosting.id, after.id))
            )
          : undefined
      )
    )
    .orderBy(asc(schema.GlPosting.txnDate), asc(schema.GlPosting.id))
    .limit(POSTINGS_PAGE_SIZE)
}

async function readLines(db: Database, organizationId: string, glPostingIds: string[]) {
  if (glPostingIds.length === 0) return []
  return db
    .select()
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        inArray(schema.GlPostingLine.glPostingId, glPostingIds)
      )
    )
    .orderBy(asc(schema.GlPostingLine.lineNumber))
}

/** T14: `exportShape` per store, one query on the distinct `storeId`s in range. */
async function readStoreExportSettings(
  db: Database,
  organizationId: string,
  storeIds: string[]
): Promise<Map<string, StoreExportSetting>> {
  const rows = await readSourceAccounts(db, organizationId, storeIds)
  return new Map([...rows].map(([id, row]) => [id, { exportShape: row.exportShape }]))
}

/** Each posting's own `parent` link - a fulfillment's order, a receipt's order or invoice. */
async function readParentLinks(
  db: Database,
  organizationId: string,
  glPostingIds: string[]
): Promise<Map<string, { sourceKind: string; sourceId: string }>> {
  if (glPostingIds.length === 0) return new Map()
  const rows = await db
    .select({
      glPostingId: schema.GlPostingSource.glPostingId,
      sourceKind: schema.GlPostingSource.sourceKind,
      sourceId: schema.GlPostingSource.sourceId,
    })
    .from(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.linkRole, 'parent'),
        inArray(schema.GlPostingSource.glPostingId, glPostingIds)
      )
    )
  return new Map(
    rows.map((row) => [row.glPostingId, { sourceKind: row.sourceKind, sourceId: row.sourceId }])
  )
}

/**
 * Posted `payment` postings parented on one of `orderIds` - the "fully paid at
 * shipment" read (§1). Through `GlPostingSource`, never the money model.
 */
async function readReceiptsForOrders(
  db: Database,
  organizationId: string,
  orderIds: string[]
): Promise<Map<string, ReceiptInfo[]>> {
  const rows = await findLinkedPostings(db, organizationId, {
    sourceKind: 'order',
    sourceIds: orderIds,
    linkRole: 'parent',
    postingTypes: ['payment'],
    statuses: ['posted'],
  })
  const map = new Map<string, ReceiptInfo[]>()
  for (const row of rows) {
    const info: ReceiptInfo = {
      glPostingId: row.glPostingId,
      totalMinor: row.totalMinor,
      txnDate: row.txnDate,
    }
    const bucket = map.get(row.sourceId)
    if (bucket) bucket.push(info)
    else map.set(row.sourceId, [info])
  }
  return map
}

/**
 * A `payment`'s `appliesTo.glPostingId`: the `fulfillment` or `invoice_issued`
 * posting that claims the same order/invoice its own `parent` link names -
 * `parent` for an order (a fulfillment), `subject` for an invoice
 * (`invoice_issued` claims its invoice as its own subject).
 */
async function readClaimsForSources(
  db: Database,
  organizationId: string,
  sources: Array<{ sourceKind: string; sourceId: string }>
): Promise<Map<string, string>> {
  const rows = await findLinkedPostings(db, organizationId, {
    sourceIds: sources.map((source) => source.sourceId),
    linkRole: ['parent', 'subject'],
    postingTypes: ['fulfillment', 'invoice_issued'],
    statuses: ['posted'],
  })
  const wanted = new Set(sources.map((source) => `${source.sourceKind}:${source.sourceId}`))
  const map = new Map<string, string>()
  for (const row of rows) {
    const key = `${row.sourceKind}:${row.sourceId}`
    if (wanted.has(key)) map.set(key, row.glPostingId)
  }
  return map
}

function toShapeLine(line: typeof schema.GlPostingLine.$inferSelect): ShapeForPostingLine {
  return {
    glAccountId: line.glAccountId,
    accountCode: line.accountCode,
    direction: line.direction,
    amountMinor: line.amountMinor,
    sortOrder: line.lineNumber,
    ...(line.memo ? { memo: line.memo } : {}),
    ...(line.counterpartyType && line.counterpartyId
      ? {
          counterparty: {
            type: line.counterpartyType as CounterpartyType,
            id: line.counterpartyId,
          },
        }
      : {}),
  }
}

/** `auxx:gl:<type>:<date>:<id>` - the stamp a human greps the provider's register for. */
function stamp(parts: string[], limits: AccountingProviderLimits | undefined): string {
  return parts.join(':').slice(0, Math.min(PRIVATE_NOTE_MAX_LENGTH, limits?.noteLength ?? Infinity))
}

/** A summary batch has no posting to borrow a number from, so it mints one. */
function summaryDocNumber(
  avenue: string,
  grainKey: string,
  scope: string,
  limits: AccountingProviderLimits | undefined
): string {
  const docNumber = `SUM-${hashExportPayload([avenue, grainKey, scope]).slice(0, 12)}`
  if (docNumber.length > Math.min(DOC_NUMBER_MAX_LENGTH, limits?.docNumberLength ?? Infinity))
    throw new UnprocessableEntityError(`Summary document number '${docNumber}' is over the cap`)
  return docNumber
}

/**
 * Write one batch and its member links, or nothing.
 *
 * `onConflictDoNothing` rather than a read-then-write: two builders racing the
 * same grain must produce one batch, and the partial unique index is the only
 * thing that can settle that.
 */
async function insertBatchInTx(
  tx: Transaction,
  values: typeof schema.ExportBatch.$inferInsert,
  glPostingIds: string[]
): Promise<string | null> {
  const [batch] = await tx
    .insert(schema.ExportBatch)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: schema.ExportBatch.id })
  if (!batch) return null
  await tx
    .insert(schema.ExportBatchPosting)
    .values(
      glPostingIds.map((glPostingId) => ({
        organizationId: values.organizationId,
        batchId: batch.id,
        glPostingId,
      }))
    )
    .onConflictDoNothing()
  return batch.id
}

/**
 * Build every batch the range still owes.
 *
 * Idempotent: a second run over the same range finds nothing un-batched and
 * writes nothing. Postings dated before `accounting.exportModeCutover` are
 * skipped entirely - a mode switch leaves history alone (TARGET §3).
 */
export async function buildExportBatches(
  db: Database,
  input: BuildExportBatchesInput
): Promise<Result<BuildExportBatchesResult, Error>> {
  const { organizationId } = input
  try {
    const connection = await readActiveBookConnection(db, organizationId)
    if (!connection)
      return ok({ built: 0, batchIds: [], skippedBeforeCutover: 0, connected: false })

    const settings = await readExportSettings(organizationId)
    const { limits } = await resolveAccountingProvider(organizationId)
    const cutover =
      settings.cutover && settings.cutover > connection.exportFromDate
        ? settings.cutover
        : connection.exportFromDate
    const rows = await readPostingsInRange(db, input)

    const excludePostingIds: string[] = []
    const eligible: CandidateRow[] = []
    let skippedBeforeCutover = 0
    for (const row of rows) {
      const exportable = row.avenue !== null
      const wanted = !input.glPostingIds?.length || input.glPostingIds.includes(row.id)
      if (!exportable || row.batched || row.txnDate < cutover || !wanted) {
        // Everything not being built now is excluded from the summary read, so a
        // summary row never sums a posting another batch already holds.
        if (exportable) excludePostingIds.push(row.id)
        if (exportable && !row.batched && row.txnDate < cutover) skippedBeforeCutover++
        continue
      }
      eligible.push(row)
    }
    if (eligible.length === 0)
      return ok({ built: 0, batchIds: [], skippedBeforeCutover, connected: true })

    const base = {
      organizationId,
      bookId: connection.bookId,
      connectionId: connection.id,
      state: 'ready' as const,
    }
    const batchIds: string[] = []

    if (settings.mode === 'transaction') {
      // ── T14 + D1: which store each fulfillment resolves through, and which
      // receipts a fully-paid one absorbs into a Sales Receipt. ─────────────
      const storeIds = [
        ...new Set(eligible.map((row) => row.storeId).filter((id): id is string => id !== null)),
      ]
      const storeSettings = await readStoreExportSettings(db, organizationId, storeIds)

      const fulfillmentIds = eligible
        .filter((row) => row.postingType === 'fulfillment')
        .map((row) => row.id)
      const paymentIds = eligible
        .filter((row) => row.postingType === 'payment' || row.postingType === 'deposit_application')
        .map((row) => row.id)
      const parentLinks = await readParentLinks(db, organizationId, [
        ...fulfillmentIds,
        ...paymentIds,
      ])

      const orderIdByFulfillment = new Map<string, string>()
      for (const id of fulfillmentIds) {
        const link = parentLinks.get(id)
        if (link && link.sourceKind === 'order') orderIdByFulfillment.set(id, link.sourceId)
      }
      const receiptsByOrder = await readReceiptsForOrders(db, organizationId, [
        ...new Set(orderIdByFulfillment.values()),
      ])

      const paymentSources = paymentIds
        .map((id) => parentLinks.get(id))
        .filter((link): link is { sourceKind: string; sourceId: string } => link !== undefined)
      const claimBySource = await readClaimsForSources(db, organizationId, paymentSources)

      // D1: a fully-paid `auto` fulfillment's Sales Receipt absorbs the
      // qualifying receipts as members; they are excluded from their own
      // `payment` batch THIS run, and the anti-join protects later runs.
      const fullyPaidByFulfillment = new Map<string, boolean>()
      const receiptIdsByFulfillment = new Map<string, string[]>()
      for (const row of eligible) {
        if (row.postingType !== 'fulfillment') continue
        const orderId = orderIdByFulfillment.get(row.id)
        const receipts = orderId ? (receiptsByOrder.get(orderId) ?? []) : []
        const qualifying = receipts.filter((receipt) => receipt.txnDate <= row.txnDate)
        const sum = qualifying.reduce((total, receipt) => total + receipt.totalMinor, 0)
        const fullyPaid = qualifying.length > 0 && sum >= row.totalMinor
        fullyPaidByFulfillment.set(row.id, fullyPaid)
        const shape = row.storeId ? (storeSettings.get(row.storeId)?.exportShape ?? 'auto') : 'auto'
        if (wantsSalesReceipt(shape, fullyPaid))
          receiptIdsByFulfillment.set(
            row.id,
            qualifying.map((receipt) => receipt.glPostingId)
          )
      }
      const absorbedReceiptIds = new Set([...receiptIdsByFulfillment.values()].flat())

      const lines = await readLines(db, organizationId, [
        ...new Set([...eligible.map((row) => row.id), ...absorbedReceiptIds]),
      ])
      const byPosting = new Map<string, typeof lines>()
      for (const line of lines) {
        const bucket = byPosting.get(line.glPostingId)
        if (bucket) bucket.push(line)
        else byPosting.set(line.glPostingId, [line])
      }

      for (const row of eligible) {
        // Absorbed into a Sales Receipt above - not its own candidate this run.
        if (absorbedReceiptIds.has(row.id)) continue

        const avenue = row.avenue
        const receiptIds = receiptIdsByFulfillment.get(row.id) ?? []
        const allLines = [
          ...(byPosting.get(row.id) ?? []),
          ...receiptIds.flatMap((id) => byPosting.get(id) ?? []),
        ]
        if (!avenue || allLines.length < 2 || !row.docNumber) continue

        const roleByGlAccountId = new Map<string, AccountRole | null>()
        for (const line of allLines)
          roleByGlAccountId.set(line.glAccountId, (line.accountRole as AccountRole | null) ?? null)

        // The counterparty is frozen on the receivable/payable line itself at
        // post time (`GlPostingLineBase.counterpartyType/Id`) - no extra read.
        const counterpartyLine = allLines.find(
          (line) => line.counterpartyType && line.counterpartyId
        )
        const counterparty = counterpartyLine
          ? {
              type: counterpartyLine.counterpartyType as CounterpartyType,
              id: counterpartyLine.counterpartyId as string,
            }
          : null

        const exportShape = row.storeId
          ? (storeSettings.get(row.storeId)?.exportShape ?? 'auto')
          : 'auto'
        const memo = (row.built as { memo?: unknown } | null)?.memo
        const paymentSource = parentLinks.get(row.id)
        const appliesToGlPostingId = paymentSource
          ? claimBySource.get(`${paymentSource.sourceKind}:${paymentSource.sourceId}`)
          : undefined

        const shaped = shapeForPosting({
          posting: {
            id: row.id,
            postingType: row.postingType,
            txnDate: row.txnDate,
            docNumber: row.docNumber,
            totalMinor: row.totalMinor,
            currency: row.currency,
            storeId: row.storeId,
            railId: row.railId,
            memo: typeof memo === 'string' ? memo : undefined,
          },
          lines: allLines.map(toShapeLine),
          roleByGlAccountId,
          limits,
          counterparty,
          exportShape,
          fullyPaidAtShipment: fullyPaidByFulfillment.get(row.id),
          appliesToGlPostingId,
        })
        if (shaped.fallbackReason) {
          logger.debug('Export batch fell back to a journal entry', {
            organizationId,
            glPostingId: row.id,
            postingType: row.postingType,
            reason: shaped.fallbackReason,
          })
        }

        const id = await db.transaction((tx) =>
          insertBatchInTx(
            tx,
            {
              ...base,
              mode: 'transaction',
              avenue,
              // The posting id IS the grain in Transaction mode, unchanged by
              // D1: a Sales Receipt's grain is still the fulfillment's id.
              grainKey: row.id,
              storeId: row.storeId,
              railId: row.railId,
              currency: row.currency,
              objectType: shaped.objectType,
              payload: shaped.payload,
              payloadHash: hashExportPayload(shaped.payload),
              totalMinor: row.totalMinor,
            },
            [row.id, ...receiptIds]
          )
        )
        if (id) batchIds.push(id)
      }
      return ok({ built: batchIds.length, batchIds, skippedBeforeCutover, connected: true })
    }

    // Summary mode (§7 D3). `readLedgerSummary` already emits one row per
    // posting for the grain-less avenues (a payout is one deposit), so both
    // shapes come out of the same read. Still a plain journal - native summary
    // shapes are a follow-up brief.
    const summary = await readLedgerSummary(db, {
      organizationId,
      from: cutover > input.from ? cutover : input.from,
      to: input.to,
      grainByAvenue: settings.summaryGrain,
      excludePostingIds,
    })
    if (summary.isErr()) return err(summary.error)
    for (const group of summary.value) {
      if (group.postingIds.length === 0 || group.lines.length < 2) continue
      if (input.group && unbuiltGroupKeyString(group) !== unbuiltGroupKeyString(input.group))
        continue
      const scope = `${group.storeId ?? ''}|${group.railId ?? ''}|${group.currency}`
      const payload = exportJournalSchema.parse({
        v: 1,
        txnDate: group.txnDateTo,
        docNumber: summaryDocNumber(group.avenue, group.grainKey, scope, limits),
        privateNote: stamp(['auxx', 'sum', group.avenue, group.grainKey, scope], limits),
        currency: 'USD',
        totalMinor: group.totalMinor,
        lines: group.lines.map((line, index) => ({
          glAccountId: line.glAccountId,
          accountCode: line.accountCode,
          direction: line.direction,
          amountMinor: line.amountMinor,
          sortOrder: index,
        })),
      } satisfies ExportJournalPayload)
      const id = await db.transaction((tx) =>
        insertBatchInTx(
          tx,
          {
            ...base,
            mode: 'summary',
            avenue: group.avenue,
            grainKey: group.grainKey,
            storeId: group.storeId,
            railId: group.railId,
            currency: group.currency,
            objectType: JOURNAL_OBJECT_TYPE,
            payload,
            payloadHash: hashExportPayload(payload),
            totalMinor: group.totalMinor,
          },
          group.postingIds
        )
      )
      if (id) batchIds.push(id)
    }
    return ok({ built: batchIds.length, batchIds, skippedBeforeCutover, connected: true })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
