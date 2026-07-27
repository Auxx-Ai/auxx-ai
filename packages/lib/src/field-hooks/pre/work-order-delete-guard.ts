// packages/lib/src/field-hooks/pre/work-order-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { PermissionKey, requirePermission } from '../../permissions'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `work-orders` (plans/dispatch/money/12-delete-safety.md §C). Blocks
 * deleting a job that still has a linked invoice — either the direct `invoice:workOrder`
 * relationship or an allocation-ledger row — and points the
 * user at the invoice(s) first. Visit/QC/recurrence cascade at the DB level by design (it's
 * the job's own data); only WO-owned line items need app-side cleanup here, since the guard
 * below guarantees none of them are invoice-stamped by the time cleanup runs.
 */
export const guardWorkOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  if (userId !== systemUserId) {
    await requirePermission(userId, organizationId, PermissionKey.dispatchBoardManage)
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

  const { entityInstanceId: workOrderId } = parseRecordId(recordId)
  const allocation = await database.query.InvoiceLineAllocation.findFirst({
    where: and(
      eq(schema.InvoiceLineAllocation.organizationId, organizationId),
      eq(schema.InvoiceLineAllocation.workOrderId, workOrderId)
    ),
    columns: { id: true },
  })
  if (allocation) {
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
    // Suppress the line-level billing post-delete hook — it would re-project the very work
    // order being deleted, once per line; the work-order post-delete hook syncs the contact.
    await handler.delete(toRecordId('line_item', lineInstanceId), {
      suppressPostDeleteHooks: true,
    })
  }

  await database
    .delete(schema.WorkOrderBillingInstallment)
    .where(
      and(
        eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
        eq(schema.WorkOrderBillingInstallment.workOrderId, workOrderId)
      )
    )
}
