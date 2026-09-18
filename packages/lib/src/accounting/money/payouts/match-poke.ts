// packages/lib/src/accounting/money/payouts/match-poke.ts

/**
 * The receipt-side poke (§9.2, scenario B): when the customer-money lane finally
 * records the receipt a payout item has been waiting for, re-assess that payout
 * instead of waiting for the nightly walk.
 */

import { schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { markParentDirty } from '../../../reconcilers/dirty-parents'
import { PAYOUT_ASSESSMENT } from './payout-reconciler'

/**
 * Mark every open item whose `sourceReference` names this source object.
 *
 * 🛑 Buffers only; it never assesses inline. The caller holds the org's
 * accounting commit lock, and `assessPayouts` takes that lock on its own
 * connection — running it here would wait on a lock this transaction is holding.
 * With no scope to buffer into, the pending sweep in `payout-sync-job.ts` is the
 * backstop.
 */
export async function pokePendingMatchesForSourceObject(
  tx: Transaction,
  organizationId: string,
  sourceObjectId: string
): Promise<number> {
  const [object] = await tx
    .select({
      objectType: schema.FinancialSourceObject.objectType,
      externalId: schema.FinancialSourceObject.externalId,
      componentKey: schema.FinancialSourceObject.componentKey,
      providerKey: schema.FinancialSourceAccount.providerKey,
      externalAccountId: schema.FinancialSourceAccount.externalAccountId,
      environment: schema.FinancialSourceAccount.environment,
    })
    .from(schema.FinancialSourceObject)
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceObject.organizationId
        ),
        eq(schema.FinancialSourceAccount.id, schema.FinancialSourceObject.sourceAccountId)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceObject.organizationId, organizationId),
        eq(schema.FinancialSourceObject.id, sourceObjectId)
      )
    )
    .limit(1)
  if (!object) return 0

  const reference = schema.ProcessorBalanceEntry.sourceReference
  const rows = await tx
    .select({ id: schema.ProcessorBalanceEntry.id })
    .from(schema.ProcessorBalanceEntry)
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
        inArray(schema.ProcessorBalanceEntry.matchState, ['pending', 'suggested']),
        sql`${reference}->'sourceAccount'->>'providerKey' = ${object.providerKey}`,
        sql`${reference}->'sourceAccount'->>'externalAccountId' = ${object.externalAccountId}`,
        sql`${reference}->'sourceAccount'->>'environment' = ${object.environment}`,
        sql`${reference}->>'objectType' = ${object.objectType}`,
        sql`${reference}->>'externalId' = ${object.externalId}`,
        sql`${reference}->>'componentKey' = ${object.componentKey}`
      )
    )
  for (const row of rows) markParentDirty(PAYOUT_ASSESSMENT, row.id)
  return rows.length
}
