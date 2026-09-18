// packages/lib/src/accounting/money/payouts/sweep-reads.ts

/**
 * "Swept by payout X" on an order's or an invoice's ledger card — the backward
 * walk of §10.3, stored end to end:
 *
 * ```
 * MoneyApplication → MoneyTransaction → ProcessorBalanceEntry.matchedMoneyTransactionId
 *   → GlPostingSource(member, processor_balance_entry) → GlPosting
 * ```
 *
 * Read-only, no permission checks — the router asserts.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../../../errors'

/** One payout posting that swept one of this document's receipts. */
export interface SweepingPayoutPosting {
  glPostingId: string
  /** The `GlPostingSource` subject key of the posting — the `payout` record (§11.5). */
  payoutSourceId: string | null
  txnDate: string
  docNumber: string | null
  status: string
  /** The processor item the posting summed, and the receipt it settles. */
  entryId: string
  moneyTransactionId: string
}

/**
 * Every live payout posting that swept the receipts applied to one document.
 *
 * Exactly one of `orderInstanceId` / `invoiceInstanceId` is required: "every
 * payout that swept anything" is a different question with a different index.
 */
export async function listSweepingPayoutPostings(
  db: Database,
  input: { organizationId: string; orderInstanceId?: string; invoiceInstanceId?: string }
): Promise<Result<SweepingPayoutPosting[], Error>> {
  const { orderInstanceId, invoiceInstanceId } = input
  if (!orderInstanceId === !invoiceInstanceId)
    return err(new BadRequestError('Name exactly one of an order or an invoice'))

  const rows = await db
    .select({
      glPostingId: schema.GlPosting.id,
      txnDate: schema.GlPosting.txnDate,
      docNumber: schema.GlPosting.docNumber,
      status: schema.GlPosting.status,
      entryId: schema.ProcessorBalanceEntry.id,
      moneyTransactionId: schema.MoneyApplication.moneyTransactionId,
    })
    .from(schema.MoneyApplication)
    .innerJoin(
      schema.ProcessorBalanceEntry,
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, schema.MoneyApplication.organizationId),
        eq(
          schema.ProcessorBalanceEntry.matchedMoneyTransactionId,
          schema.MoneyApplication.moneyTransactionId
        )
      )
    )
    .innerJoin(
      schema.GlPostingSource,
      and(
        eq(schema.GlPostingSource.organizationId, schema.ProcessorBalanceEntry.organizationId),
        eq(schema.GlPostingSource.sourceKind, 'processor_balance_entry'),
        eq(schema.GlPostingSource.linkRole, 'member'),
        eq(schema.GlPostingSource.sourceId, schema.ProcessorBalanceEntry.id)
      )
    )
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId),
        ne(schema.GlPosting.status, 'reversed')
      )
    )
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, input.organizationId),
        eq(schema.MoneyApplication.operation, 'apply'),
        orderInstanceId
          ? eq(schema.MoneyApplication.orderInstanceId, orderInstanceId)
          : eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId!),
        eq(schema.ProcessorBalanceEntry.matchState, 'matched')
      )
    )

  const subjects = rows.length
    ? await db
        .select({
          glPostingId: schema.GlPostingSource.glPostingId,
          sourceId: schema.GlPostingSource.sourceId,
        })
        .from(schema.GlPostingSource)
        .where(
          and(
            eq(schema.GlPostingSource.organizationId, input.organizationId),
            eq(schema.GlPostingSource.linkRole, 'subject'),
            eq(schema.GlPostingSource.sourceKind, 'payout'),
            inArray(schema.GlPostingSource.glPostingId, [
              ...new Set(rows.map((row) => row.glPostingId)),
            ])
          )
        )
    : []
  const subjectByPosting = new Map(subjects.map((row) => [row.glPostingId, row.sourceId]))

  const seen = new Set<string>()
  return ok(
    rows.flatMap((row) => {
      const key = `${row.glPostingId}:${row.entryId}`
      if (seen.has(key)) return []
      seen.add(key)
      return [
        {
          glPostingId: row.glPostingId,
          payoutSourceId: subjectByPosting.get(row.glPostingId) ?? null,
          txnDate: typeof row.txnDate === 'string' ? row.txnDate : String(row.txnDate),
          docNumber: row.docNumber,
          status: row.status,
          entryId: row.entryId,
          moneyTransactionId: row.moneyTransactionId,
        },
      ]
    })
  )
}
