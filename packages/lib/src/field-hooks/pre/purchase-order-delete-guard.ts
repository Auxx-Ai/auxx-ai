// packages/lib/src/field-hooks/pre/purchase-order-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import {
  describeSettledPeriods,
  settledPeriodsFor,
} from '../../accounting/ledger/periods/settled-periods'
import { BadRequestError } from '../../errors'
import type { EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'
import { findRelatedInstanceIds } from './related-rows'

/**
 * Refuses a purchase order delete while a receipt under any of its lines sits in a settled
 * period. The lines cascade, and `deleteEntityInstances` deletes their receipts and re-derives
 * the received parts' QoH (plans/mrp/20 S9); a billed order is `restrict` on `purchase_order_bills`.
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
  const movements = await readMovementsByRelation(organizationId, 'purchaseOrderLineId', lineIds)
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
