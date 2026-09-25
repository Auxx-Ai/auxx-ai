// packages/lib/src/accounting/purchasing/create-purchase-order.ts

/**
 * The one writer of a new purchase order and its lines (plans/mrp/08-implementation-plan.md D43).
 *
 * Through `UnifiedCrudHandler.create` so the RecordSequence hook mints `purchase_order_number`;
 * lines are created in a loop with `absorbInto` (never `bulkCreate`, which drops it) so the
 * parent's `record:created` announces them. Relationship values are `RecordId` strings: a bare
 * instance id is silently dropped on create. The order is left in its default `draft` status.
 */

import type { Database, Transaction } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { createGuard } from '../../utils/guard'

const guard = createGuard('purchasing:create-purchase-order')

/** Header attributes the writer accepts; `null`/`undefined` are omitted from the create. */
export interface PurchaseOrderHeaderValues {
  purchase_order_vendor: RecordId
  purchase_order_currency?: string | null
  purchase_order_reference?: string | null
  purchase_order_expected_at?: string | null
  purchase_order_shipping_total?: number | null
  purchase_order_tax_total?: number | null
  purchase_order_notes?: string | null
  purchase_order_attachments?: { ref: string }[] | null
}

/** Line attributes; the writer adds the parent pointer and `sort_order` from the array index. */
export interface PurchaseOrderLineValues {
  purchase_order_line_part: RecordId
  purchase_order_line_vendor_part?: RecordId | null
  purchase_order_line_description?: string | null
  purchase_order_line_quantity_ordered: number
  purchase_order_line_expected_unit_price?: number | null
}

export interface CreatePurchaseOrderInput {
  header: PurchaseOrderHeaderValues
  lines: PurchaseOrderLineValues[]
}

export interface CreatePurchaseOrderOptions {
  /** Reuse the caller's handler (and so its transaction and session). */
  handler?: UnifiedCrudHandler
}

export interface CreatedPurchaseOrder {
  purchaseOrderId: string
  purchaseOrderRecordId: RecordId
  /** The RecordSequence-minted `PO-…`, or null if the hook did not return one. */
  number: string | null
  /** Instance ids, in input order. */
  lineIds: string[]
}

/** Drop the keys the create path should never see as an explicit `null`. */
function defined(values: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
  )
}

/** Create a draft purchase order and its lines as the requesting user. */
export async function createPurchaseOrder(
  db: Database | Transaction,
  organizationId: string,
  userId: string,
  { header, lines }: CreatePurchaseOrderInput,
  options: CreatePurchaseOrderOptions = {}
): Promise<Result<CreatedPurchaseOrder, Error>> {
  return guard(
    async () => {
      const handler = options.handler ?? new UnifiedCrudHandler(organizationId, userId, db)

      const order = await handler.create('purchase_order', defined(header))
      const purchaseOrderRecordId = order.recordId

      const lineIds: string[] = []
      for (const [index, line] of lines.entries()) {
        const created = await handler.create(
          'purchase_order_line',
          defined({
            ...line,
            purchase_order_line_purchase_order: purchaseOrderRecordId,
            purchase_order_line_sort_order: index,
          }),
          { absorbInto: purchaseOrderRecordId }
        )
        lineIds.push(created.instance.id)
      }

      const number = order.values?.purchase_order_number
      return {
        purchaseOrderId: order.instance.id,
        purchaseOrderRecordId,
        number: typeof number === 'string' ? number : null,
        lineIds,
      }
    },
    'Failed to create a purchase order',
    { organizationId, lines: lines.length }
  )
}
