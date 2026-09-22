// packages/lib/src/accounting/money/customer-money/link-later.ts

import { schema, type Transaction } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { findLiveSubjectPostings } from '../../ledger/reads/list-postings'

/**
 * Give a receipt that posted before its order arrived the order as its `parent`
 * link. Never reposts: the lines, and the guest as frozen counterparty, stay (91 §8.6).
 * Returns whether a link was written; a receipt not yet posted takes its parent at post time.
 */
export async function linkReceiptPostingToOrderInTx(
  tx: Transaction,
  organizationId: string,
  input: { moneyTransactionId: string; orderInstanceId: string }
): Promise<boolean> {
  const posting = (
    await findLiveSubjectPostings(tx, organizationId, {
      sourceKind: 'money_transaction',
      sourceIds: [input.moneyTransactionId],
    })
  ).get(input.moneyTransactionId)
  if (!posting) return false
  const link = schema.GlPostingSource
  const [existing] = await tx
    .select({ id: link.id })
    .from(link)
    .where(
      and(
        eq(link.organizationId, organizationId),
        eq(link.glPostingId, posting.glPostingId),
        eq(link.linkRole, 'parent'),
        eq(link.sourceKind, 'order'),
        eq(link.sourceId, input.orderInstanceId)
      )
    )
    .limit(1)
  if (existing) return false
  await tx.insert(link).values({
    organizationId,
    glPostingId: posting.glPostingId,
    sourceKind: 'order',
    sourceId: input.orderInstanceId,
    linkRole: 'parent',
  })
  return true
}
