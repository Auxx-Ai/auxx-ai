// packages/lib/src/accounting/purchasing/bill-intake/find-order.ts

/**
 * Find the order a bill's printed PO reference names (§4.1 step 3).
 *
 * `purchaseOrderReference` folded equals exactly one of the vendor's open
 * orders' `purchase_order_number` or `purchase_order_reference` - anything
 * else (zero hits, or several) is `null`, so the caller leaves the order
 * empty rather than guessing among several candidates that share a number by
 * coincidence.
 *
 * Reads only, no actor. The router asserts view access on `purchase_order`
 * and calls in.
 */

import { type Database, schema } from '@auxx/database'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId } from '../../../cache'
import { systemFieldMap } from '../../../resources/system-records'
import { foldKey } from './assign'
import { guard } from './guard'

/** Statuses that take an order out of the running (plans/purchasing/07…, `PurchaseOrderStatus`). */
const CLOSED_STATUSES = new Set(['closed', 'canceled'])

/**
 * The one order the printed reference names among a vendor's open orders, or
 * `null` when the reference is blank, matches nothing, or matches more than
 * one.
 */
export async function findOrderByReference(
  db: Database,
  organizationId: string,
  vendorRecordId: RecordId,
  reference: string | null
): Promise<Result<RecordId | null, Error>> {
  return guard(
    async () => {
      const referenceFold = foldKey(reference)
      if (!referenceFold) return null

      const purchaseOrderDefId = await getCachedEntityDefId(organizationId, 'purchase_order')
      if (!purchaseOrderDefId) return null

      const fields = await systemFieldMap(db, organizationId, [
        'purchase_order_vendor',
        'purchase_order_number',
        'purchase_order_reference',
        'purchase_order_status',
      ] as const)

      const vendorField = fields.purchase_order_vendor
      const numberField = fields.purchase_order_number
      const referenceField = fields.purchase_order_reference
      if (!vendorField || (!numberField && !referenceField)) return null

      const vendorInstanceId = parseRecordId(vendorRecordId).entityInstanceId

      const vendorValue = alias(schema.FieldValue, 'po_vendor_value')
      const statusValue = alias(schema.FieldValue, 'po_status_value')
      // `?? ''` rather than a conditional join: a sentinel field id that can
      // never match a real one keeps the left join to exactly one row per
      // order even when the org has not materialised `purchase_order_status`
      // (the same idiom `intake/resolve.ts` uses for an optional field id).
      const statusFieldId = fields.purchase_order_status?.id ?? ''

      const orderRows = await db
        .select({ id: schema.EntityInstance.id, status: statusValue.optionId })
        .from(schema.EntityInstance)
        .innerJoin(
          vendorValue,
          and(
            eq(vendorValue.entityId, schema.EntityInstance.id),
            eq(vendorValue.organizationId, schema.EntityInstance.organizationId),
            eq(vendorValue.fieldId, vendorField.id),
            eq(vendorValue.relatedEntityId, vendorInstanceId)
          )
        )
        .leftJoin(
          statusValue,
          and(
            eq(statusValue.entityId, schema.EntityInstance.id),
            eq(statusValue.organizationId, schema.EntityInstance.organizationId),
            eq(statusValue.fieldId, statusFieldId)
          )
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, purchaseOrderDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )

      const openOrderIds = orderRows
        .filter((row) => !row.status || !CLOSED_STATUSES.has(row.status))
        .map((row) => row.id)
      if (openOrderIds.length === 0) return null

      const labelFieldIds = [numberField?.id, referenceField?.id].filter((id): id is string =>
        Boolean(id)
      )
      const labelRows = await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, openOrderIds),
            inArray(schema.FieldValue.fieldId, labelFieldIds)
          )
        )

      const labelsByOrder = new Map<string, { number: string | null; reference: string | null }>()
      for (const row of labelRows) {
        const entry = labelsByOrder.get(row.entityId) ?? { number: null, reference: null }
        if (row.fieldId === numberField?.id) entry.number = row.valueText
        if (row.fieldId === referenceField?.id) entry.reference = row.valueText
        labelsByOrder.set(row.entityId, entry)
      }

      const matches = openOrderIds.filter((id) => {
        const labels = labelsByOrder.get(id)
        if (!labels) return false
        const numberFold = foldKey(labels.number)
        const referenceLabelFold = foldKey(labels.reference)
        return numberFold === referenceFold || referenceLabelFold === referenceFold
      })

      if (matches.length !== 1) return null
      return toRecordId(purchaseOrderDefId, matches[0] as string)
    },
    'Failed to find a purchase order by its printed reference',
    { organizationId, vendorRecordId }
  )
}
