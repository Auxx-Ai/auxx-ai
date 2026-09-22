// packages/lib/src/accounting/money/customer-money/acceptance-wake.ts

/**
 * The wake side of 79 §4.2: an acceptance's `evidence` work item is made due when the
 * record it was waiting on moves. Keyed on the ORDER, because that is what
 * `FinancialSourceAcceptance.orderInstanceId` names; a credit memo reaches it in one hop.
 */

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { FieldChangeRef, MarkHandler } from '../../../field-hooks/types'
import {
  defineParentReconciler,
  resolveParentsByRelation,
} from '../../../reconcilers/parent-reconciler'
import { requeueAcceptancesForOrders } from './source-writes'

const logger = createScopedLogger('money:acceptance-wake')

/** Marked with an ORDER id; the order IS the parent. */
export const ORDER_ACCEPTANCE_WAKE_RECONCILER = 'order:money-acceptance-wake'
/** Marked with a CREDIT MEMO id; resolves to its order in one hop. */
export const CREDIT_MEMO_ACCEPTANCE_WAKE_RECONCILER = 'credit-memo:money-acceptance-wake'

/** The three inputs every wake-on-change reason reads off the order (79 §4.2). */
const ORDER_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'order_contact',
  'order_currency',
  'order_total',
])

async function wakeOrders(
  organizationId: string,
  _userId: string,
  orderInstanceIds: string[]
): Promise<void> {
  try {
    await requeueAcceptancesForOrders(database, organizationId, orderInstanceIds)
  } catch (error) {
    logger.error('acceptance wake failed — the parked rows stay parked', {
      organizationId,
      orders: orderInstanceIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const orderReconciler = defineParentReconciler<string>({
  key: ORDER_ACCEPTANCE_WAKE_RECONCILER,
  rebuildBatch: wakeOrders,
})

const creditMemoReconciler = defineParentReconciler<string>({
  key: CREDIT_MEMO_ACCEPTANCE_WAKE_RECONCILER,
  resolve: (organizationId, creditMemoInstanceIds) =>
    resolveParentsByRelation(organizationId, 'credit_memo_order', creditMemoInstanceIds),
  rebuildBatch: wakeOrders,
})

/** Register both drains. Called from `registerAllHooks()`. */
export function registerMoneyAcceptanceWakeReconcilers(): void {
  orderReconciler.register()
  creditMemoReconciler.register()
}

export const wakeAcceptancesOnOrderChange: MarkHandler = async (event: FieldChangeRef) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !ORDER_TRIGGER_ATTRS.has(attr)) return
  const { entityInstanceId } = parseRecordId(event.recordId)
  await orderReconciler.mark(event.organizationId, event.userId, entityInstanceId)
}

// A refund parked on an unresolved credit document wakes when one is pointed at its order.
export const wakeAcceptancesOnCreditMemoChange: MarkHandler = async (event: FieldChangeRef) => {
  if (event.field.systemAttribute !== 'credit_memo_order') return
  const { entityInstanceId } = parseRecordId(event.recordId)
  await creditMemoReconciler.mark(event.organizationId, event.userId, entityInstanceId)
}
