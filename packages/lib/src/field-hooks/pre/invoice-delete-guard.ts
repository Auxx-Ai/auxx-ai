// packages/lib/src/field-hooks/pre/invoice-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { unstampSourceLines } from '../../money/invoice-lifecycle'
import { hasSucceededCharges } from '../../money/payments/ledger'
import { PermissionKey, requirePermission } from '../../permissions'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `invoices` (plans/dispatch/money/12-delete-safety.md §A). Fires inside
 * `deleteEntity` for EVERY delete path — generic `record.delete`, bulk delete, the drawer's
 * `money.deleteInvoice`, and any future Kopilot/API caller — closing the gap where only the
 * drawer's bespoke lifecycle delete (`invoice-lifecycle.ts`) enforced these invariants.
 *
 * Order: admin gate → succeeded-charges guard → purge ledger residue (clears the
 * `PaymentTransaction.invoiceInstanceId` RESTRICT FK, then the `PaymentAllocation.invoiceInstanceId`
 * RESTRICT FK, money 16-deposit-accounting.md §C.6 — so the instance delete that follows this
 * hook can never throw) → unstamp source lines → delete the invoice's own line copies.
 */
export const guardInvoiceDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  if (userId !== systemUserId) {
    await requirePermission(userId, organizationId, PermissionKey.dispatchBoardManage)
  }

  const { entityInstanceId: invoiceInstanceId } = parseRecordId(recordId)

  if (await hasSucceededCharges(organizationId, invoiceInstanceId)) {
    throw new BadRequestError('Remove recorded payments before deleting this invoice')
  }

  // Only pending/failed/canceled ledger rows can remain at this point — the guard above
  // already ruled out any succeeded/disputed charge (allocated to this invoice OR merely
  // targeting it, money 16-deposit-accounting.md §C.6), and a succeeded refund can't exist
  // without one. Purge them directly so the instance delete below never trips the
  // intent-column RESTRICT FK.
  await database
    .delete(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId)
      )
    )

  // `PaymentAllocation.paymentTransactionId` cascades with the purge above, but an allocation
  // row carries its OWN restrict FK to this invoice (`PaymentAllocation.invoiceInstanceId`),
  // independent of which transaction it belongs to. The guard above already proves no
  // succeeded/disputed charge is allocated here — that's exactly what it checks — so no
  // allocation row should survive the purge; this is a defensive delete to guarantee that
  // RESTRICT FK never blocks the instance delete that follows this hook, even if that
  // invariant is ever violated by a future writer.
  await database
    .delete(schema.PaymentAllocation)
    .where(
      and(
        eq(schema.PaymentAllocation.organizationId, organizationId),
        eq(schema.PaymentAllocation.invoiceInstanceId, invoiceInstanceId)
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
  })
  for (const lineInstanceId of ownLineIds) {
    // Suppress the line-level billing post-delete hook — the invoice is being deleted, and
    // the invoices post-delete hook re-projects its work order once after the delete lands.
    await handler.delete(toRecordId('line_item', lineInstanceId), {
      suppressPostDeleteHooks: true,
    })
  }
}
