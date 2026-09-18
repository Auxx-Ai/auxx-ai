// packages/lib/src/purchasing/bill-intake/load-order-lines.ts

/**
 * What the matcher is fed from the order's own side (§3.5): the purchase
 * order's lines, with the part's sku/title and the vendor part's own printed
 * code joined in.
 *
 * Reads only, no actor, no `UnifiedCrudHandler` - the router asserts view
 * access on `purchase_order` and calls in. Cells come through
 * `readSystemRecords` (plan §3b), so the lines are found by their own parent
 * relation (`by:`) rather than through the order's has_many mirror.
 */

import type { Database } from '@auxx/database'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { readSystemRecords, type SystemRecord, systemFields } from '../../resources/system-records'
import type { OrderLineFacts } from './client'
import { guard } from './guard'

/**
 * Every `purchase_order_line` attribute this loader reads.
 *
 * Hand-written rather than `pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, …)`:
 * that registry file is not a declared map yet and converts with the purchase
 * order's own module, not here.
 */
const LINE_ATTRIBUTES = [
  'purchase_order_line_purchase_order',
  'purchase_order_line_part',
  'purchase_order_line_vendor_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_sort_order',
] as const

// Hand-written: the picker rejects `dbColumn`-marked fields, but on an entity def
// the seeder still creates the `CustomField`, so these values are in `FieldValue`.
const PART_ATTRIBUTES = ['part_sku', 'part_title'] as const

/** `vendor-part-fields.ts` is not a declared map yet, so this one stays hand-written too. */
const VENDOR_PART_ATTRIBUTES = ['vendor_part_vendor_sku'] as const

/**
 * The order's lines, as the matcher needs them (§3.5).
 *
 * `[]` for an order the `purchase_order_line` def has not materialised, or
 * that carries no lines - both are "nothing to match against", not an error.
 */
export async function loadOrderLineFacts(
  db: Database,
  organizationId: string,
  purchaseOrderRecordId: RecordId
): Promise<Result<OrderLineFacts[], Error>> {
  return guard(
    async () => {
      const purchaseOrderInstanceId = parseRecordId(purchaseOrderRecordId).entityInstanceId

      const ctx = await systemFields(db, organizationId, 'purchase_order_line', LINE_ATTRIBUTES)
      if (!ctx?.fields.purchase_order_line_purchase_order) return []

      const lines = await readSystemRecords(db, organizationId, ctx, {
        by: {
          attribute: 'purchase_order_line_purchase_order',
          in: [purchaseOrderInstanceId],
        },
      })
      if (lines.length === 0) return []

      const labels = await readLabels(db, organizationId, lines)

      const ranked = lines.map((line, index) => {
        const partCell = line.cell('purchase_order_line_part')
        const partInstanceId = line.related('purchase_order_line_part')
        const vendorPartInstanceId = line.related('purchase_order_line_vendor_part')
        const sortOrder = line.number('purchase_order_line_sort_order')

        const fact: OrderLineFacts = {
          orderLineRecordId: line.recordId,
          partRecordId:
            partCell?.type === 'relationship' && partCell.recordId ? partCell.recordId : null,
          partSku: partInstanceId ? (labels.partSku.get(partInstanceId) ?? null) : null,
          partTitle: partInstanceId ? (labels.partTitle.get(partInstanceId) ?? null) : null,
          vendorSku: vendorPartInstanceId
            ? (labels.vendorSku.get(vendorPartInstanceId) ?? null)
            : null,
          description: line.text('purchase_order_line_description'),
          ordered: line.number('purchase_order_line_quantity_ordered') ?? 0,
          received: line.number('purchase_order_line_quantity_received') ?? 0,
          billed: line.number('purchase_order_line_quantity_billed') ?? 0,
          expectedUnitPriceCents: line.number('purchase_order_line_expected_unit_price'),
          sortOrder,
        }
        return { fact, sortKey: sortOrder ?? index }
      })

      return ranked.sort((a, b) => a.sortKey - b.sortKey).map(({ fact }) => fact)
    },
    'Failed to load purchase order line facts',
    { organizationId, purchaseOrderRecordId }
  )
}

interface LineLabels {
  partSku: Map<string, string>
  partTitle: Map<string, string>
  vendorSku: Map<string, string>
}

/**
 * The sku/title of every part and vendor part the lines point at.
 *
 * `includeArchived`: a line pointing at a part somebody archived still has to
 * show the sku it was ordered under, or the matcher loses its best key.
 */
async function readLabels(
  db: Database,
  organizationId: string,
  lines: SystemRecord<(typeof LINE_ATTRIBUTES)[number]>[]
): Promise<LineLabels> {
  const partIds = new Set<string>()
  const vendorPartIds = new Set<string>()
  for (const line of lines) {
    const partId = line.related('purchase_order_line_part')
    if (partId) partIds.add(partId)
    const vendorPartId = line.related('purchase_order_line_vendor_part')
    if (vendorPartId) vendorPartIds.add(vendorPartId)
  }

  const labels: LineLabels = { partSku: new Map(), partTitle: new Map(), vendorSku: new Map() }

  if (partIds.size > 0) {
    const ctx = await systemFields(db, organizationId, 'part', PART_ATTRIBUTES)
    if (ctx) {
      const parts = await readSystemRecords(db, organizationId, ctx, {
        ids: [...partIds],
        includeArchived: true,
      })
      for (const part of parts) {
        const sku = part.text('part_sku')
        if (sku) labels.partSku.set(part.id, sku)
        const title = part.text('part_title')
        if (title) labels.partTitle.set(part.id, title)
      }
    }
  }

  if (vendorPartIds.size > 0) {
    const ctx = await systemFields(db, organizationId, 'vendor_part', VENDOR_PART_ATTRIBUTES)
    if (ctx) {
      const vendorParts = await readSystemRecords(db, organizationId, ctx, {
        ids: [...vendorPartIds],
        includeArchived: true,
      })
      for (const vendorPart of vendorParts) {
        const sku = vendorPart.text('vendor_part_vendor_sku')
        if (sku) labels.vendorSku.set(vendorPart.id, sku)
      }
    }
  }

  return labels
}
