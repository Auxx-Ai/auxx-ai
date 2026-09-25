// packages/lib/src/mrp/actions/draft-purchase-orders.ts

import type { Database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { addDaysToDayKey, toDateKey } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import {
  createPurchaseOrder,
  type PurchaseOrderLineValues,
} from '../../accounting/purchasing/create-purchase-order'
import { UnprocessableEntityError } from '../../errors'
import { VENDOR_PART_FIELDS } from '../../resources/registry/resources/vendor-part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import {
  readSystemRecords,
  requireSystemFields,
  type SystemRecord,
  systemDefId,
} from '../../resources/system-records'
import { createGuard } from '../../utils/guard'
import {
  type ActionRefusal,
  positiveQuantity,
  readActionItems,
  resolveActionRun,
  runNote,
  uniqueByPart,
} from './shared'

const guard = createGuard('mrp:draft-purchase-orders')

const VENDOR_PART_PICK = pickSystemAttributes(VENDOR_PART_FIELDS, [
  'vendor_part_part',
  'vendor_part_contact',
  'vendor_part_lead_time',
  'vendor_part_unit_price',
] as const)

export interface DraftPurchaseOrdersInput {
  /** Defaults to the latest completed run. */
  runId?: string
  /**
   * `quantity` (eaches, D14) overrides `suggestedQty`; `vendorPartId` overrides
   * `suggestedVendorPartId`, and the supplier then comes from that vendor part.
   */
  items: Array<{ partId: string; quantity?: number; vendorPartId?: string }>
}

export interface DraftPurchaseOrdersResult {
  runId: string
  created: Array<{
    supplierId: string
    purchaseOrderId: string
    number: string | null
    partIds: string[]
  }>
  refused: ActionRefusal[]
}

interface DraftLine {
  partId: string
  quantity: number
  vendorPart: SystemRecord<(typeof VENDOR_PART_PICK)[number]>
}

/**
 * One draft purchase order per supplier from the selected purchase suggestions, through
 * `createPurchaseOrder` as the requesting user. The PO stays `draft` (02 D17). A refused part
 * or supplier is reported in `refused` and never loses the other suppliers (08 §4).
 */
export async function draftPurchaseOrders(
  db: Database,
  organizationId: string,
  userId: string,
  input: DraftPurchaseOrdersInput
): Promise<Result<DraftPurchaseOrdersResult, Error>> {
  return guard(
    async () => {
      const run = await resolveActionRun(db, organizationId, input.runId)
      const selected = uniqueByPart(input.items)
      const items = await readActionItems(
        db,
        organizationId,
        run.id,
        selected.map((s) => s.partId)
      )
      const result: DraftPurchaseOrdersResult = { runId: run.id, created: [], refused: [] }
      const refuse = (partId: string, reason: string) => result.refused.push({ partId, reason })

      const candidates: Array<{
        partId: string
        quantity: number
        vendorPartId: string
        overridden: boolean
        suggestedSupplierId: string | null
      }> = []
      for (const pick of selected) {
        const item = items.get(pick.partId)
        if (!item) {
          refuse(pick.partId, 'Not planned in this MRP run')
          continue
        }
        if (item.suggestionKind !== 'purchase') {
          refuse(pick.partId, 'The run does not suggest a purchase')
          continue
        }
        const vendorPartId = pick.vendorPartId ?? item.suggestedVendorPartId
        if (!vendorPartId) {
          refuse(pick.partId, 'No vendor part to order from')
          continue
        }
        const quantity = positiveQuantity(pick.quantity ?? item.suggestedQty)
        if (quantity === null) {
          refuse(pick.partId, 'No quantity to order')
          continue
        }
        candidates.push({
          partId: pick.partId,
          quantity,
          vendorPartId,
          overridden: pick.vendorPartId !== undefined,
          suggestedSupplierId: item.suggestedSupplierId,
        })
      }
      if (candidates.length === 0) return result

      const vendorPartCtx = await requireSystemFields(
        db,
        organizationId,
        'vendor_part',
        VENDOR_PART_PICK
      )
      const vendorParts = new Map(
        (
          await readSystemRecords(db, organizationId, vendorPartCtx, {
            ids: candidates.map((c) => c.vendorPartId),
          })
        ).map((record) => [record.id, record])
      )

      const bySupplier = new Map<string, DraftLine[]>()
      for (const candidate of candidates) {
        const vendorPart = vendorParts.get(candidate.vendorPartId)
        if (!vendorPart) {
          refuse(candidate.partId, 'The vendor part no longer exists')
          continue
        }
        if (vendorPart.related('vendor_part_part') !== candidate.partId) {
          refuse(candidate.partId, 'The vendor part belongs to a different part')
          continue
        }
        const supplierId = candidate.overridden
          ? vendorPart.related('vendor_part_contact')
          : (candidate.suggestedSupplierId ?? vendorPart.related('vendor_part_contact'))
        if (!supplierId) {
          refuse(candidate.partId, 'The vendor part has no supplier')
          continue
        }
        const lines = bySupplier.get(supplierId) ?? []
        lines.push({ partId: candidate.partId, quantity: candidate.quantity, vendorPart })
        bySupplier.set(supplierId, lines)
      }
      if (bySupplier.size === 0) return result

      const [partDefId, companyDefId] = await Promise.all([
        systemDefId(db, organizationId, 'part'),
        systemDefId(db, organizationId, 'company'),
      ])
      if (!partDefId || !companyDefId) {
        throw new UnprocessableEntityError('Parts or companies are not provisioned')
      }

      const today = toDateKey(new Date())
      for (const [supplierId, lines] of bySupplier) {
        const partIds = lines.map((line) => line.partId)
        const leadTimes = lines
          .map((line) => line.vendorPart.number('vendor_part_lead_time'))
          .filter((days): days is number => days !== null && days >= 0)
        const created = await createPurchaseOrder(db, organizationId, userId, {
          header: {
            purchase_order_vendor: toRecordId(companyDefId, supplierId),
            // The latest line's lead time, so the whole order is expected when it can all land.
            purchase_order_expected_at:
              leadTimes.length > 0
                ? addDaysToDayKey(today, Math.ceil(Math.max(...leadTimes)))
                : null,
            purchase_order_notes: `<p>${runNote(run, partIds)}</p>`,
          },
          lines: lines.map(
            (line): PurchaseOrderLineValues => ({
              purchase_order_line_part: toRecordId(partDefId, line.partId),
              purchase_order_line_vendor_part: line.vendorPart.recordId,
              purchase_order_line_quantity_ordered: line.quantity,
              purchase_order_line_expected_unit_price:
                line.vendorPart.number('vendor_part_unit_price'),
            })
          ),
        })
        if (created.isErr()) {
          for (const partId of partIds) refuse(partId, created.error.message)
          continue
        }
        result.created.push({
          supplierId,
          purchaseOrderId: created.value.purchaseOrderId,
          number: created.value.number,
          partIds,
        })
      }
      return result
    },
    'Failed to draft MRP purchase orders',
    { organizationId, runId: input.runId, items: input.items.length }
  )
}
