// packages/lib/src/accounting/money/payouts/payout-reconciler.ts

/**
 * The payout assessment as a dirty-parent reconciler
 * (`plans/events/08-derived-parent-reconciler-plan.md`; LIB-LAYOUT §3f).
 *
 * The degenerate case of the primitive: a marked `payout` or
 * `processor_balance_entry` IS the parent, so there is no `resolve` —
 * `assessPayouts` does its own owner resolution from those ids and then assesses
 * each canonical `MoneyTransfer` once, which is per-batch work the drain must not
 * split up. Hence `rebuildBatch` rather than `rebuild`.
 */

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { defineParentReconciler } from '../../../reconcilers/parent-reconciler'
import { bridgeFinancialRecords } from '../customer-money/bridge'
import { assessPayouts } from './assess-payouts'

export const PAYOUT_ASSESSMENT = 'money.payout-assessment'

/** A marked id is a payout or a processor entry; the bridge needs to know which. */
async function classifyPayoutOwners(
  organizationId: string,
  entityInstanceIds: string[]
): Promise<Array<{ id: string; kind: 'payout' | 'processor_balance_entry' }>> {
  const rows = await database
    .select({
      id: schema.EntityInstance.id,
      entityType: schema.EntityDefinition.entityType,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, entityInstanceIds),
        inArray(schema.EntityDefinition.entityType, ['payout', 'processor_balance_entry'])
      )
    )
  return rows.map((row) => ({
    id: row.id,
    kind: row.entityType as 'payout' | 'processor_balance_entry',
  }))
}

const reconciler = defineParentReconciler<string>({
  key: PAYOUT_ASSESSMENT,
  rebuildBatch: async (organizationId, userId, entityInstanceIds) => {
    // Evidence rows first: `assessPayouts` reads `MoneyTransfer`, which is what
    // the bridge writes.
    const records = await classifyPayoutOwners(organizationId, entityInstanceIds)
    if (records.length)
      await bridgeFinancialRecords(database, {
        organizationId,
        actorUserId: userId ?? '',
        records,
      })
    await assessPayouts(database, organizationId, entityInstanceIds)
  },
})

/** Register the drain. Idempotent per key. */
export function registerPayoutReconciler(): void {
  reconciler.register()
}

/**
 * Mark a payout owner for assessment, or assess now when nothing will drain (see
 * `ParentReconciler.mark` for why that fallback is load-bearing).
 */
export const markPayoutForAssessment = reconciler.mark
