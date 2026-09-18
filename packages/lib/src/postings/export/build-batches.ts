// packages/lib/src/postings/export/build-batches.ts
// One posted, un-batched posting (Transaction mode) or one summary row (Summary
// mode) becomes one `ExportBatch`. See plans/accounting/TARGET.md §3.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { readActiveBookConnection } from '../book-connections'
import { DOC_NUMBER_MAX_LENGTH } from '../doc-number'
import { avenueOfPostingType, readExportSettings } from '../export-settings'
import { readLedgerSummary } from '../reads/ledger-summary'
import type { CounterpartyType, PostingType } from '../types'
import {
  type ExportJournalLine,
  type ExportJournalPayload,
  exportJournalSchema,
  hashExportPayload,
  JOURNAL_OBJECT_TYPE,
} from './payload'

export interface BuildExportBatchesInput {
  organizationId: string
  /** Inclusive accounting dates, `YYYY-MM-DD`. */
  from: string
  to: string
  /** Build only these postings - the auto-send path after one commit. */
  glPostingIds?: string[]
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
  txnDate: string
  docNumber: string | null
  currency: string
  storeId: string | null
  railId: string | null
  totalMinor: number
  built: unknown
}

/**
 * Posted entries in range, with whether a live batch already holds each one.
 *
 * The anti-join is against `ExportBatchPosting`'s live rows, which is the same
 * partial unique index that makes a second batch on one posting impossible.
 */
async function readPostingsInRange(
  db: Database,
  input: BuildExportBatchesInput
): Promise<Array<CandidateRow & { batched: boolean }>> {
  const rows = await db
    .select({
      id: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
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
        lte(schema.GlPosting.txnDate, input.to)
      )
    )
    .orderBy(asc(schema.GlPosting.txnDate), asc(schema.GlPosting.id))
    .limit(5000)
  return rows.map(({ batchedId, ...row }) => ({ ...row, batched: batchedId !== null }))
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

/** `auxx:gl:<type>:<date>:<id>` - the stamp a human greps the provider's register for. */
function stamp(parts: string[], memo?: string): string {
  const composed = memo ? `${parts.join(':')} ${memo}` : parts.join(':')
  return composed.slice(0, 4000)
}

/** A summary batch has no posting to borrow a number from, so it mints one. */
function summaryDocNumber(avenue: string, grainKey: string, scope: string): string {
  const docNumber = `AUXX-SUM-${hashExportPayload([avenue, grainKey, scope]).slice(0, 12)}`
  if (docNumber.length > DOC_NUMBER_MAX_LENGTH)
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

    const settings = await readExportSettings(db, organizationId)
    const cutover =
      settings.cutover && settings.cutover > connection.exportFromDate
        ? settings.cutover
        : connection.exportFromDate
    const rows = await readPostingsInRange(db, input)

    const excludePostingIds: string[] = []
    const eligible: CandidateRow[] = []
    let skippedBeforeCutover = 0
    for (const row of rows) {
      const exportable = avenueOfPostingType(row.postingType) !== null
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
      connectionId: connection.connectionId,
      objectType: JOURNAL_OBJECT_TYPE,
      state: 'ready' as const,
    }
    const batchIds: string[] = []

    if (settings.mode === 'transaction') {
      const lines = await readLines(
        db,
        organizationId,
        eligible.map((row) => row.id)
      )
      const byPosting = new Map<string, typeof lines>()
      for (const line of lines) {
        const bucket = byPosting.get(line.glPostingId)
        if (bucket) bucket.push(line)
        else byPosting.set(line.glPostingId, [line])
      }
      for (const row of eligible) {
        const avenue = avenueOfPostingType(row.postingType)
        const rows = byPosting.get(row.id) ?? []
        if (!avenue || rows.length < 2 || !row.docNumber) continue
        const memo = (row.built as { memo?: unknown } | null)?.memo
        const payload = exportJournalSchema.parse({
          v: 1,
          txnDate: row.txnDate,
          docNumber: row.docNumber,
          privateNote: stamp(
            ['auxx', 'gl', row.postingType, row.txnDate, row.id],
            typeof memo === 'string' ? memo : undefined
          ),
          currency: 'USD',
          totalMinor: row.totalMinor,
          lines: rows.map(toPayloadLine),
        } satisfies ExportJournalPayload)
        const id = await db.transaction((tx) =>
          insertBatchInTx(
            tx,
            {
              ...base,
              mode: 'transaction',
              avenue,
              // The posting id IS the grain in Transaction mode: one posting,
              // one batch, and the unique index says so.
              grainKey: row.id,
              storeId: row.storeId,
              railId: row.railId,
              currency: row.currency,
              payload,
              payloadHash: hashExportPayload(payload),
              totalMinor: row.totalMinor,
            },
            [row.id]
          )
        )
        if (id) batchIds.push(id)
      }
      return ok({ built: batchIds.length, batchIds, skippedBeforeCutover, connected: true })
    }

    // Summary mode. `readLedgerSummary` already emits one row per posting for
    // the grain-less avenues (a payout is one deposit), so both shapes come out
    // of the same read.
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
      const scope = `${group.storeId ?? ''}|${group.railId ?? ''}|${group.currency}`
      const payload = exportJournalSchema.parse({
        v: 1,
        txnDate: group.txnDateTo,
        docNumber: summaryDocNumber(group.avenue, group.grainKey, scope),
        privateNote: stamp(['auxx', 'sum', group.avenue, group.grainKey, scope]),
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

function toPayloadLine(line: typeof schema.GlPostingLine.$inferSelect): ExportJournalLine {
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
