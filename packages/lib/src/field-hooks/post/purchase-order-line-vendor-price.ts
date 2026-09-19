// packages/lib/src/field-hooks/post/purchase-order-line-vendor-price.ts

/**
 * A purchase order line's agreed price writes the `vendor_part` price for that
 * vendor (73 §6.4).
 *
 * Before this, nothing wrote `vendor_part_unit_price` from an order or a bill:
 * the standing supplier terms stayed at whatever somebody typed when the offer
 * was created, so `part_cost` — and with it the roll's material input for every
 * purchased part — drifted away from what we are actually agreeing to pay. The
 * agreed price on an order line IS the latest agreed price by definition.
 *
 * 🛑 **This does NOT move `part_standard_cost`.** It moves the live replacement
 * cost, which is the input a roll reads when somebody runs one. A standard that
 * followed the last order would be a moving average wearing a standard's name.
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { roundMinorUnits } from '@auxx/utils/currency'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import type { FieldTriggerHandler } from '../types'
import { recalculatePartCostsForParts } from './bom-cost-triggers'

const logger = createScopedLogger('field-hooks:po-line-vendor-price')

/** One line's two facts: which supplier offer it is against, and at what price. */
interface AgreedPrice {
  vendorPartId: string
  unitPrice: number
}

/**
 * Push every changed line's agreed price onto its `vendor_part`.
 *
 * A line with no `vendor_part` link is skipped silently — it is an order
 * against a bare part, and there is no offer to update. A line whose price was
 * cleared is skipped too: an absent agreed price is not an agreement to pay
 * nothing.
 *
 * The write goes through hook-free `setValueWithType` and then calls
 * `recalculatePartCostsForParts` itself, rather than firing the
 * `mfg-vendor-part-unit-price` rule: one rule cascading into another is a loop
 * waiting to be closed, and the tail is the same tail that rule runs.
 */
export const writeVendorPartPriceFromOrderLine: FieldTriggerHandler = async (event) => {
  const { recordIds, organizationId } = event
  const lineIds = recordIds.map((id) => parseRecordId(id).entityInstanceId)
  if (lineIds.length === 0) return

  const agreed = await readAgreedPrices(organizationId, lineIds)
  if (agreed.size === 0) return

  const priceField = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttribute('vendor_part_unit_price')
  if (!priceField) return

  const vendorPartDefId = await requireCachedEntityDefId(organizationId, 'vendor_part')
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const ctx = createFieldValueContext(organizationId, userId, database)

  // Last write wins per offer, which is what a batch of lines against one
  // vendor part means: the order carries one agreed price for it.
  const byVendorPart = new Map<string, number>()
  for (const entry of agreed.values()) byVendorPart.set(entry.vendorPartId, entry.unitPrice)

  for (const [vendorPartId, unitPrice] of byVendorPart) {
    await setValueWithType(ctx, {
      recordId: toRecordId(vendorPartDefId, vendorPartId) as RecordId,
      fieldId: priceField.id,
      fieldType: toFieldType(priceField.type),
      value: { type: 'number', value: unitPrice },
    })
  }

  const partIds = await resolveParentPartIds(organizationId, [...byVendorPart.keys()])
  await recalculatePartCostsForParts(organizationId, partIds)

  logger.info('Wrote agreed order prices onto their vendor parts', {
    organizationId,
    lines: lineIds.length,
    vendorParts: byVendorPart.size,
    parts: partIds.length,
  })
}

/** The `vendor_part` link and the agreed price of each line, in one query. */
async function readAgreedPrices(
  organizationId: string,
  lineIds: readonly string[]
): Promise<Map<string, AgreedPrice>> {
  const rows = await database
    .select({
      entityId: schema.FieldValue.entityId,
      systemAttribute: schema.CustomField.systemAttribute,
      valueNumber: schema.FieldValue.valueNumber,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...lineIds]),
        inArray(schema.CustomField.systemAttribute, [
          'purchase_order_line_vendor_part',
          'purchase_order_line_expected_unit_price',
        ])
      )
    )

  const draft = new Map<string, Partial<AgreedPrice>>()
  for (const row of rows) {
    const entry = draft.get(row.entityId) ?? {}
    if (row.systemAttribute === 'purchase_order_line_vendor_part') {
      if (row.relatedEntityId) entry.vendorPartId = row.relatedEntityId
    } else if (row.valueNumber != null && row.valueNumber > 0) {
      entry.unitPrice = roundMinorUnits(row.valueNumber)
    }
    draft.set(row.entityId, entry)
  }

  const resolved = new Map<string, AgreedPrice>()
  for (const [lineId, entry] of draft) {
    if (entry.vendorPartId && entry.unitPrice != null) {
      resolved.set(lineId, { vendorPartId: entry.vendorPartId, unitPrice: entry.unitPrice })
    }
  }
  return resolved
}

/** The parts behind a set of vendor parts, so their live cost can be refreshed. */
async function resolveParentPartIds(
  organizationId: string,
  vendorPartIds: readonly string[]
): Promise<string[]> {
  if (vendorPartIds.length === 0) return []
  const rows = await database
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...vendorPartIds]),
        eq(schema.CustomField.systemAttribute, 'vendor_part_part')
      )
    )
  return [...new Set(rows.map((row) => row.relatedEntityId).filter((id): id is string => !!id))]
}
