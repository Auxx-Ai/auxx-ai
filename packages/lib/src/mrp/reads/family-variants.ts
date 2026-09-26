// packages/lib/src/mrp/reads/family-variants.ts

import type { Database } from '@auxx/database'
import { isServicePartKind } from '../../inventory/costing/client'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFields } from '../../resources/system-records'

const VARIANT_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_product',
  'part_kind',
  'part_sku',
  'part_stock_status',
  'part_quantity_on_hand',
] as const)

/** One part of a product family (`part_product`), live parts only. */
export interface FamilyVariant {
  partId: string
  name: string | null
  sku: string | null
  kind: string | null
  stockStatus: string | null
  quantityOnHand: number | null
  /** `kind !== 'service'` (15 D38). */
  stocked: boolean
}

/** The product's variants in creation order; empty when the product has none or the org has no `part_product` field. */
export async function readFamilyVariants(
  db: Database,
  organizationId: string,
  productId: string
): Promise<FamilyVariant[]> {
  const ctx = await systemFields(db, organizationId, 'part', VARIANT_PICK)
  if (!ctx?.fields.part_product) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'part_product', in: [productId] },
  })
  return records.map((r) => {
    const kind = r.option('part_kind')
    return {
      partId: r.id,
      name: r.displayName,
      sku: r.text('part_sku'),
      kind,
      stockStatus: r.option('part_stock_status'),
      quantityOnHand: r.number('part_quantity_on_hand'),
      stocked: !isServicePartKind(kind),
    }
  })
}
