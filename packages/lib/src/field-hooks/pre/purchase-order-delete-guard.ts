// packages/lib/src/field-hooks/pre/purchase-order-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import type { EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'
import { findRelatedInstanceIds } from './related-rows'

/**
 * Pre-delete guard for `purchase-orders`
 * (plans/money/tasks/21-money-parent-delete-safety.md §4). Fires inside
 * `deleteEntity` for EVERY delete path, because `purchase-orders` is
 * `isVisible: true` and has carried an ordinary row delete and bulk delete since
 * the day it shipped.
 *
 * **One refusal: a receipt under any of its lines sits in a settled period.**
 * Note the two-hop read: a `stock_movement` names the LINE
 * (`stock_movement_purchase_order_line`), never the order, so the lines are
 * read first (archived ones included, see `related-rows.ts`) and the movements
 * under them second. `settledPeriodsFor` owns the three predicates.
 *
 * **What is NOT here, and why.**
 *
 *   - "A vendor has billed against this order" is `onDelete: 'restrict'` on
 *     `purchase_order_bills`. The delete engine refuses it from the declaration,
 *     archived bills included, which is the case that deleted `PO-0002` in dev
 *     on 2026-08-31 when this guard still asked the question itself.
 *   - The lines are `onDelete: 'cascade'` on `purchase_order_lines`, and the
 *     receipts under them `onDelete: 'cascade'` on
 *     `purchase_order_line_stock_movements`. The engine collects the whole
 *     closure, runs this guard before writing anything, and publishes a
 *     lifecycle event per row, so `mfg-stock-movements-deleted` still recomputes
 *     `recalculatePartQoH` on the received part, a survivor.
 *
 * **The missing lever, for the third recorded time.** A line's
 * `quantityOrdered` and `expectedUnitPrice` are evidence-locked against EDITS
 * the moment a receipt or a bill line exists
 * (`pre/purchase-order-line-evidence-lock.ts`), and there is no delete
 * counterpart on the line itself. This guard is what stands between the order
 * and its receipts; the restrict above is what stands between it and its bills.
 */
export const guardPurchaseOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: orderInstanceId } = parseRecordId(recordId)

  const lineIds = await findRelatedInstanceIds(
    organizationId,
    'purchase_order_line',
    'purchase_order_line_purchase_order',
    [orderInstanceId]
  )
  const movements = await readMovementsByRelation(
    organizationId,
    'stock_movement_purchase_order_line',
    lineIds
  )
  if (movements.length === 0) return

  const settled = await settledPeriodsFor(
    organizationId,
    movements.map((movement) => movement.accountingDate)
  )
  if (settled.size > 0) {
    throw new BadRequestError(
      `This purchase order has ${describeSettledPeriods(settled, 'receipt')}. ` +
        'A posted period is corrected by reversing an entry, never by deleting its history. ' +
        'Archive the order instead.',
      { organizationId, recordId, periods: [...settled.keys()] }
    )
  }
}
