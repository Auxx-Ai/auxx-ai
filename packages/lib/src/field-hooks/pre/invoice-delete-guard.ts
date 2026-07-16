// packages/lib/src/field-hooks/pre/invoice-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError, ForbiddenError } from '../../errors'
import { isAdminOrOwner } from '../../members'
import { unstampSourceLines } from '../../money/invoice-lifecycle'
import { hasSucceededCharges } from '../../money/payments/ledger'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `invoices` (plans/dispatch/money/12-delete-safety.md §A). Fires inside
 * `deleteEntity` for EVERY delete path — generic `record.delete`, bulk delete, the drawer's
 * `money.deleteInvoice`, and any future Kopilot/API caller — closing the gap where only the
 * drawer's bespoke lifecycle delete (`invoice-lifecycle.ts`) enforced these invariants.
 *
 * Order: admin gate → succeeded-charges guard → purge ledger residue (clears the
 * `PaymentTransaction.invoiceInstanceId` RESTRICT FK so the instance delete that follows this
 * hook can never throw) → unstamp source lines → delete the invoice's own line copies.
 */
export const guardInvoiceDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event

  const [isAdmin, systemUserId] = await Promise.all([
    isAdminOrOwner(organizationId, userId),
    getOrgCache().get(organizationId, 'systemUser'),
  ])
  if (!isAdmin && userId !== systemUserId) {
    throw new ForbiddenError('Only admins can delete invoices')
  }

  const { entityInstanceId: invoiceInstanceId } = parseRecordId(recordId)

  if (await hasSucceededCharges(organizationId, invoiceInstanceId)) {
    throw new BadRequestError('Remove recorded payments before deleting this invoice')
  }

  // Only pending/failed/canceled ledger rows can remain at this point — the guard above
  // already ruled out any succeeded/disputed charge, and a succeeded refund can't exist
  // without one. Purge them directly so the instance delete below never trips the RESTRICT FK.
  await database
    .delete(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId)
      )
    )

  await unstampSourceLines(organizationId, userId, recordId)

  // Delete the invoice's own line copies (`invoice = X AND workOrder empty`, the §B.3
  // invariant) — the same loop `deleteInvoice` used to run inline before this hook took over.
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const { ids: ownLineIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'invoice-own-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'invoice-own-lines-invoice',
            fieldId: 'line_item:invoice',
            operator: 'is',
            value: recordId,
          },
          {
            id: 'invoice-own-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'empty',
            value: null,
          },
        ],
      },
    ],
    limit: 1000,
    mode: 'oneshot',
  })
  for (const lineInstanceId of ownLineIds) {
    // Suppress the line-level billing post-delete hook — the invoice is being deleted, and
    // the invoices post-delete hook re-projects its work order once after the delete lands.
    await handler.delete(toRecordId('line_item', lineInstanceId), {
      suppressPostDeleteHooks: true,
    })
  }
}
