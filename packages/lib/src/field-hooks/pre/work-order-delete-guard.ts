// packages/lib/src/field-hooks/pre/work-order-delete-guard.ts

import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { BadRequestError, ForbiddenError } from '../../errors'
import { isAdminOrOwner } from '../../members'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `work-orders` (plans/dispatch/money/12-delete-safety.md §C). Blocks
 * deleting a job that still has a linked invoice — either the direct `invoice:workOrder`
 * relationship or a stamped `line_item_work_order`/`line_item_invoice` pair — and points the
 * user at the invoice(s) first. Visit/QC/recurrence cascade at the DB level by design (it's
 * the job's own data); only WO-owned line items need app-side cleanup here, since the guard
 * below guarantees none of them are invoice-stamped by the time cleanup runs.
 */
export const guardWorkOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event

  const [isAdmin, systemUserId] = await Promise.all([
    isAdminOrOwner(organizationId, userId),
    getOrgCache().get(organizationId, 'systemUser'),
  ])
  if (!isAdmin && userId !== systemUserId) {
    throw new ForbiddenError('Only admins can delete jobs')
  }

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const linkedInvoices = await handler.listFiltered({
    entityDefinitionId: 'invoice',
    filters: [
      {
        id: 'wo-delete-linked-invoice',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'wo-delete-linked-invoice-c1',
            fieldId: 'invoice:workOrder',
            operator: 'is',
            value: recordId,
          },
        ],
      },
    ],
    limit: 1,
    mode: 'oneshot',
  })
  if (linkedInvoices.ids.length > 0) {
    throw new BadRequestError("Delete or void this job's invoices first")
  }

  const stampedLines = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'wo-delete-stamped-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'wo-delete-stamped-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'is',
            value: recordId,
          },
          {
            id: 'wo-delete-stamped-lines-invoice',
            fieldId: 'line_item:invoice',
            operator: 'not empty',
            value: null,
          },
        ],
      },
    ],
    limit: 1,
    mode: 'oneshot',
  })
  if (stampedLines.ids.length > 0) {
    throw new BadRequestError("Delete or void this job's invoices first")
  }

  // No linked/stamped invoices — safe to hard-delete every WO-owned line item. Visits, QC
  // items, and recurrence rules keep their DB cascades, untouched by this hook.
  const { ids: ownLineIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'wo-delete-own-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'wo-delete-own-lines-c1',
            fieldId: 'line_item:workOrder',
            operator: 'is',
            value: recordId,
          },
        ],
      },
    ],
    limit: 1000,
    mode: 'oneshot',
  })
  for (const lineInstanceId of ownLineIds) {
    await handler.delete(toRecordId('line_item', lineInstanceId))
  }
}
