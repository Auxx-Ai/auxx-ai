// packages/lib/src/accounting/banking/import/reads.ts

/**
 * Every READ the import path makes over `bank_transaction`.
 *
 * No permission checks: the router asserts and hands the narrowed filters down
 * (`docs/lib-module-guide.md` §6). The def-and-field context is
 * `banking/fields.ts`'s `requireBankTransactionImportContext`.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, eq, inArray } from 'drizzle-orm'
import { readSystemRecords, type SystemRecord } from '../../../resources/system-records'
import { findLiveSubjectPostings } from '../../ledger/reads/list-postings'
import type { BankTransactionImportAttribute, BankTransactionImportContext } from '../fields'

// Mirrors `banking/review/client.ts`'s own constant. Inlined rather than
// imported across the import/review sibling boundary - this is the one place
// this module needs it, to find a line's live posting through `GlPostingSource`.
const BANK_TRANSACTION_SOURCE_TYPE = 'bank_transaction'

/** One `bank_transaction`, flattened to what the import path reasons about. */
export interface BankTransactionRow {
  id: string
  createdAt: Date | null
  externalId: string | null
  bankAccountId: string | null
  postedAt: string | null
  description: string | null
  /** Signed integer minor units. `null` when the row never got one. */
  amountMinor: number | null
  matchKey: string | null
  importBatchId: string | null
  /** `feed` or `import`; `null` on a row nothing has stamped yet. */
  source: string | null
  reviewStatus: string | null
  /**
   * Why a line was excluded, or null.
   *
   * Read here because `refusalReason` needs it: an `excluded` row is a person's
   * decision unless the IMPORT wrote the reason itself, and a reverse hard-deletes
   * what it does not refuse.
   */
  excludeReason: string | null
  glPostingId: string | null
}

/**
 * Every transaction on one account, archived rows included.
 *
 * The account's children, then one join for the live postings. A post-read
 * `.filter()` would pull every statement line in the ORG into memory to answer
 * a question about one account.
 */
export async function readTransactionsByAccount(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  bankAccountId: string
): Promise<BankTransactionRow[]> {
  if (!ctx.fields.bank_transaction_bank_account) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'bank_transaction_bank_account', in: [bankAccountId] },
    includeArchived: true,
  })
  return toRows(db, organizationId, records)
}

/** Every transaction stamped with one import batch. */
export async function readTransactionsByBatch(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  importBatchId: string
): Promise<BankTransactionRow[]> {
  const batchFieldId = ctx.fields.bank_transaction_import_batch_id?.id
  if (!batchFieldId) return []

  const rows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, batchFieldId),
        eq(schema.FieldValue.valueText, importBatchId)
      )
    )

  return hydrateTransactions(db, organizationId, ctx, [...new Set(rows.map((r) => r.entityId))])
}

/** Turn a set of instance ids into full rows with a bounded number of queries. */
export async function hydrateTransactions(
  db: Database,
  organizationId: string,
  ctx: BankTransactionImportContext,
  instanceIds: string[]
): Promise<BankTransactionRow[]> {
  if (instanceIds.length === 0) return []
  // 🛑 `includeArchived`, because the import path reasons about rows a reverse
  // archived: `refusalReason` reads an archived line's own exclusion reason.
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: instanceIds,
    includeArchived: true,
  })
  return toRows(db, organizationId, records)
}

/** The shared tail: one join for the live postings, then the flat row. */
async function toRows(
  db: Database,
  organizationId: string,
  records: SystemRecord<BankTransactionImportAttribute>[]
): Promise<BankTransactionRow[]> {
  if (records.length === 0) return []

  // The live posting each line currently claims, read through
  // `GlPostingSource` (TARGET §1) rather than the retired
  // `bank_transaction_gl_posting_id` stamp.
  const livePostings = await findLiveSubjectPostings(db, organizationId, {
    sourceKind: BANK_TRANSACTION_SOURCE_TYPE,
    sourceIds: records.map((record) => record.id),
  })
  const glPostingIdBySourceId = new Map(
    [...livePostings].map(([sourceId, row]) => [sourceId, row.glPostingId])
  )

  return records.map((record) => {
    const postedAt = record.date('bank_transaction_posted_at')
    return {
      id: record.id,
      createdAt: record.createdAt,
      externalId: record.text('bank_transaction_external_id'),
      bankAccountId: record.related('bank_transaction_bank_account'),
      postedAt: postedAt ? toDateKey(postedAt) : null,
      description: record.text('bank_transaction_description'),
      // `valueNumber` is a double and the column is minor units, so round rather
      // than truncate: a value that round-tripped as 12449.999999 must read 12450.
      amountMinor: record.cell('bank_transaction_amount')
        ? Math.round(record.number('bank_transaction_amount') ?? 0)
        : null,
      matchKey: record.text('bank_transaction_match_key'),
      importBatchId: record.text('bank_transaction_import_batch_id'),
      source: record.option('bank_transaction_source'),
      reviewStatus: record.option('bank_transaction_review_status'),
      excludeReason: record.text('bank_transaction_exclude_reason'),
      glPostingId: glPostingIdBySourceId.get(record.id) ?? null,
    } satisfies BankTransactionRow
  })
}
