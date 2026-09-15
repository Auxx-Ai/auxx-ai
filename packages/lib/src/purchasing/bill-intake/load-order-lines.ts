// packages/lib/src/purchasing/bill-intake/load-order-lines.ts

/**
 * What the matcher is fed from the order's own side (§3.5): the purchase
 * order's lines, with the part's sku/title and the vendor part's own printed
 * code joined in.
 *
 * Reads only, no actor, no `UnifiedCrudHandler` - the same trade
 * `expense-bill/reads.ts` and `intake/resolve.ts` both make: values come
 * straight off `FieldValue`'s own columns rather than through a typed
 * envelope, because there is no write here and no permission to assert. The
 * router asserts view access on `purchase_order` and calls in.
 *
 * Two `FieldValue` reads (§3.5): the lines (after reading the order's own
 * `purchase_order_lines` relation to find which lines are its own - the same
 * has_many-field read `expense-bill/reads.ts` uses for a bill's lines), then
 * the parts and vendor parts those lines point at, by id.
 */

import { type Database, schema } from '@auxx/database'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import type { OrderLineFacts } from './client'
import { guard } from './guard'

/** Every `purchase_order_line` attribute this loader reads, besides its parent. */
const LINE_ATTRIBUTES = [
  'purchase_order_line_part',
  'purchase_order_line_vendor_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_sort_order',
] as const

type LineAttribute = (typeof LINE_ATTRIBUTES)[number]

type FieldMap<A extends string> = Record<A, { id: string } | null>

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> row`. One row per (instance, field) is all this
 * module ever expects - none of the fields read here are has_many.
 */
async function selectCells(
  db: Database,
  organizationId: string,
  entityIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, Map<string, ValueRow>>> {
  const buckets = new Map<string, Map<string, ValueRow>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...entityIds]),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
      )
    )

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    byField.set(row.fieldId, row)
  }
  return buckets
}

/** The ids of every non-archived instance among `ids`, in the order given. */
async function liveInstanceIds(
  db: Database,
  organizationId: string,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...ids]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const live = new Set(rows.map((row) => row.id))
  return ids.filter((id) => live.has(id))
}

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

      const lineDefId = await getCachedEntityDefId(organizationId, 'purchase_order_line')
      if (!lineDefId) return []

      const headerFields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['purchase_order_lines'] as const)
      const linesField = headerFields.purchase_order_lines
      if (!linesField) return []

      // The order's own has_many relation carries one row per line, each with
      // `relatedEntityId` = a line instance id - the same shape
      // `expense-bill/reads.ts` reads a bill's `vendor_bill_lines` through.
      const relatedIds = await relatedLineIds(
        db,
        organizationId,
        purchaseOrderInstanceId,
        linesField.id
      )
      const lineInstanceIds = await liveInstanceIds(db, organizationId, relatedIds)
      if (lineInstanceIds.length === 0) return []

      const lineFields = (await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([...LINE_ATTRIBUTES] as const)) as FieldMap<LineAttribute>

      const lineFieldIds = LINE_ATTRIBUTES.map((attribute) => lineFields[attribute]?.id).filter(
        (id): id is string => Boolean(id)
      )
      const lineCells = await selectCells(db, organizationId, lineInstanceIds, lineFieldIds)

      const cell = (lineId: string, attribute: LineAttribute): ValueRow | undefined => {
        const fieldId = lineFields[attribute]?.id
        return fieldId ? lineCells.get(lineId)?.get(fieldId) : undefined
      }

      const partInstanceIds = new Set<string>()
      const vendorPartInstanceIds = new Set<string>()
      for (const lineId of lineInstanceIds) {
        const partId = cell(lineId, 'purchase_order_line_part')?.relatedEntityId
        if (partId) partInstanceIds.add(partId)
        const vendorPartId = cell(lineId, 'purchase_order_line_vendor_part')?.relatedEntityId
        if (vendorPartId) vendorPartInstanceIds.add(vendorPartId)
      }

      const [partDefId, partAndVendorPartFields] = await Promise.all([
        getCachedEntityDefId(organizationId, 'part'),
        getOrgCache()
          .from(organizationId, 'customFields')
          .bySystemAttributes(['part_sku', 'part_title', 'vendor_part_vendor_sku'] as const),
      ])

      const labelFieldIds = [
        partAndVendorPartFields.part_sku?.id,
        partAndVendorPartFields.part_title?.id,
        partAndVendorPartFields.vendor_part_vendor_sku?.id,
      ].filter((id): id is string => Boolean(id))

      const labelCells = await selectCells(
        db,
        organizationId,
        [...partInstanceIds, ...vendorPartInstanceIds],
        labelFieldIds
      )

      const partSkuOf = (partInstanceId: string): string | null => {
        const fieldId = partAndVendorPartFields.part_sku?.id
        return (fieldId ? labelCells.get(partInstanceId)?.get(fieldId)?.valueText : null) ?? null
      }
      const partTitleOf = (partInstanceId: string): string | null => {
        const fieldId = partAndVendorPartFields.part_title?.id
        return (fieldId ? labelCells.get(partInstanceId)?.get(fieldId)?.valueText : null) ?? null
      }
      const vendorSkuOf = (vendorPartInstanceId: string): string | null => {
        const fieldId = partAndVendorPartFields.vendor_part_vendor_sku?.id
        return (
          (fieldId ? labelCells.get(vendorPartInstanceId)?.get(fieldId)?.valueText : null) ?? null
        )
      }

      const lines = lineInstanceIds.map((lineId, index) => {
        const partInstanceId = cell(lineId, 'purchase_order_line_part')?.relatedEntityId ?? null
        const vendorPartInstanceId =
          cell(lineId, 'purchase_order_line_vendor_part')?.relatedEntityId ?? null
        const sortOrder = cell(lineId, 'purchase_order_line_sort_order')?.valueNumber ?? null

        const fact: OrderLineFacts = {
          orderLineRecordId: toRecordId(lineDefId, lineId),
          partRecordId: partInstanceId ? toRecordId(partDefId ?? 'part', partInstanceId) : null,
          partSku: partInstanceId ? partSkuOf(partInstanceId) : null,
          partTitle: partInstanceId ? partTitleOf(partInstanceId) : null,
          vendorSku: vendorPartInstanceId ? vendorSkuOf(vendorPartInstanceId) : null,
          description: cell(lineId, 'purchase_order_line_description')?.valueText ?? null,
          ordered: cell(lineId, 'purchase_order_line_quantity_ordered')?.valueNumber ?? 0,
          received: cell(lineId, 'purchase_order_line_quantity_received')?.valueNumber ?? 0,
          billed: cell(lineId, 'purchase_order_line_quantity_billed')?.valueNumber ?? 0,
          expectedUnitPriceCents:
            cell(lineId, 'purchase_order_line_expected_unit_price')?.valueNumber ?? null,
          sortOrder,
        }
        return { fact, sortKey: sortOrder ?? index }
      })

      return lines.sort((a, b) => a.sortKey - b.sortKey).map(({ fact }) => fact)
    },
    'Failed to load purchase order line facts',
    { organizationId, purchaseOrderRecordId }
  )
}

/** The line instance ids named by the order's own `purchase_order_lines` relation. */
async function relatedLineIds(
  db: Database,
  organizationId: string,
  purchaseOrderInstanceId: string,
  linesFieldId: string
): Promise<string[]> {
  const rows = await db
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, purchaseOrderInstanceId),
        eq(schema.FieldValue.fieldId, linesFieldId)
      )
    )
  return rows.map((row) => row.relatedEntityId).filter((id): id is string => Boolean(id))
}
