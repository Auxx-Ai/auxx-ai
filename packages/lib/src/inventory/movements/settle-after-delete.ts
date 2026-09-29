// packages/lib/src/inventory/movements/settle-after-delete.ts

import { markParentDirty, registerReconciler } from '../../reconcilers/dirty-parents'
import type { StockMovementTouched } from './types'
import { settleStockMovements } from './write-movements'

const PARTS = 'stock-movements:parts'
const PO_LINES = 'stock-movements:purchase-order-lines'
const FULFILLMENT_LINES = 'stock-movements:fulfillment-lines'

const none = (): StockMovementTouched => ({
  partIds: [],
  purchaseOrderLineIds: [],
  fulfillmentLineIds: [],
  buildIds: [],
})

/** Register the three drains {@link settleAfterMovementDelete} defers to. Called from `registerAllHooks()`. */
export function registerMovementSettleReconcilers(): void {
  registerReconciler(
    PARTS,
    ({ organizationId, parentInstanceIds }) =>
      settleStockMovements(organizationId, { ...none(), partIds: parentInstanceIds }),
    { batch: true }
  )
  registerReconciler(
    PO_LINES,
    ({ organizationId, parentInstanceIds }) =>
      settleStockMovements(organizationId, { ...none(), purchaseOrderLineIds: parentInstanceIds }),
    { batch: true }
  )
  registerReconciler(
    FULFILLMENT_LINES,
    ({ organizationId, parentInstanceIds }) =>
      settleStockMovements(organizationId, { ...none(), fulfillmentLineIds: parentInstanceIds }),
    { batch: true }
  )
}

/**
 * Settle what a parent delete's `deleteMovementsFor` touched once the delete has committed: the
 * write's dirty-parent drain runs it after the handler (or its transaction) finishes, and a caller
 * with no write scope, a script or the migration, settles inline.
 */
export async function settleAfterMovementDelete(
  organizationId: string,
  touched: StockMovementTouched
): Promise<void> {
  const marks = [
    ...touched.partIds.map((id) => markParentDirty(PARTS, id)),
    ...touched.purchaseOrderLineIds.map((id) => markParentDirty(PO_LINES, id)),
    ...touched.fulfillmentLineIds.map((id) => markParentDirty(FULFILLMENT_LINES, id)),
  ]
  if (marks.every(Boolean)) return
  await settleStockMovements(organizationId, touched)
}
