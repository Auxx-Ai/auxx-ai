// packages/lib/src/accounting/money/payouts/entry-reads.ts

/**
 * The by-key reads over `ProcessorBalanceEntry` (`plans/accounting/LIB-READS.md` §2.3).
 *
 * The open-match state lists stay where they are: each is a different question
 * about `matchState` and they do not agree on purpose.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, or } from 'drizzle-orm'

type Db = Database | Transaction

export type ProcessorBalanceEntryRow = typeof schema.ProcessorBalanceEntry.$inferSelect

/** One entry, or `null` when it is outside this organization. */
export async function readEntry(
  db: Db,
  organizationId: string,
  id: string
): Promise<ProcessorBalanceEntryRow | null> {
  const [row] = await db
    .select()
    .from(schema.ProcessorBalanceEntry)
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
        eq(schema.ProcessorBalanceEntry.id, id)
      )
    )
    .limit(1)
  return row ?? null
}

/** The `(sourceAccountId, payoutExternalId)` pair `ProcessorBalanceEntry_payout_idx` indexes. */
export interface PayoutEntryScope {
  sourceAccountId: string
  payoutExternalId: string
}

/**
 * Every entry of these payouts. The outgoing-transfer item is the payout
 * itself, not something it settled, so it is excluded unless asked for.
 */
export async function listPayoutEntries(
  db: Db,
  organizationId: string,
  scopes: readonly PayoutEntryScope[],
  options: { includeOutgoing?: boolean } = {}
): Promise<ProcessorBalanceEntryRow[]> {
  if (!scopes.length) return []
  return db
    .select()
    .from(schema.ProcessorBalanceEntry)
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
        options.includeOutgoing
          ? undefined
          : eq(schema.ProcessorBalanceEntry.isOutgoingTransfer, false),
        or(
          ...scopes.map((scope) =>
            and(
              eq(schema.ProcessorBalanceEntry.sourceAccountId, scope.sourceAccountId),
              eq(schema.ProcessorBalanceEntry.payoutExternalId, scope.payoutExternalId)
            )
          )
        )
      )
    )
}

/**
 * The dispute fee on a chargeback: the fees of the processor's `dispute` rows matched to this
 * refund movement, integer minor units. `0` when none has matched yet (91 D8).
 */
export async function readMatchedDisputeFeeMinor(
  db: Db,
  organizationId: string,
  moneyTransactionId: string
): Promise<number> {
  const rows = await db
    .select({ feeMinor: schema.ProcessorBalanceEntry.feeMinor })
    .from(schema.ProcessorBalanceEntry)
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
        eq(schema.ProcessorBalanceEntry.matchedMoneyTransactionId, moneyTransactionId),
        eq(schema.ProcessorBalanceEntry.matchState, 'matched'),
        eq(schema.ProcessorBalanceEntry.type, 'dispute')
      )
    )
  return rows.reduce((sum, row) => sum + Number(row.feeMinor), 0)
}
