// packages/lib/src/field-hooks/pre/work-order-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { PermissionKey, requirePermission } from '../../permissions'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `work-orders` (plans/dispatch/money/12-delete-safety.md §C).
 *
 * Two refusals the registry cannot express, and one Drizzle-table cleanup:
 *
 *   1. **Permission.** Deleting a job is a dispatch-board action, so anyone who
 *      is not the system user needs `dispatchBoardManage` on top of the per-row
 *      `record.delete` the mutation already asserted.
 *   2. **REFUSE while an `InvoiceLineAllocation` names this job.** The
 *      allocation ledger is a Drizzle table with no registry field behind it, so
 *      only a hook can see it. The direct `invoice:workOrder` link is the
 *      registry's concern: `onDelete: 'restrict'` on `work_order_invoices`.
 *   3. **Purge `WorkOrderBillingInstallment`.** Another Drizzle table, the job's
 *      own billing schedule, with nothing else to reference it once the job is
 *      gone.
 *
 * **What is NOT here, and why.** The job's own line items are
 * `onDelete: 'cascade'` on `work_order_line_items`; the delete engine collects
 * them, runs the line guard (`guardAllocatedLineDelete`) over every one of them
 * before writing anything, and publishes their lifecycle events. Visits, QC
 * items and recurrence rules cascade at the DB level by design. This hook used
 * to delete the lines by hand; it no longer touches a child record.
 */
export const guardWorkOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  if (userId !== systemUserId) {
    await requirePermission(userId, organizationId, PermissionKey.dispatchBoardManage)
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

  await database
    .delete(schema.WorkOrderBillingInstallment)
    .where(
      and(
        eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
        eq(schema.WorkOrderBillingInstallment.workOrderId, workOrderId)
      )
    )
}
