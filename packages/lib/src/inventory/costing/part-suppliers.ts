// packages/lib/src/inventory/costing/part-suppliers.ts

// Which supplier each part's supplier cost comes from: the `selectWinningVendor` offer, so a
// Set costs group matches the "supplier" suggestion in its rows (plans/mrp/22 §3.5). Reads only.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { readSystemRecords, systemFields } from '../../resources/system-records'
import { selectWinningVendor } from './vendor-cost'

export interface PartSupplier {
  supplierId: string
  supplierName: string
}

const VENDOR_PART_ATTRIBUTES = [
  'vendor_part_part',
  'vendor_part_contact',
  'vendor_part_unit_price',
  'vendor_part_shipping_cost',
  'vendor_part_tariff_rate',
  'vendor_part_other_cost',
  'vendor_part_is_preferred',
] as const

/** Part id → its winning supplier; a part with no priced offer is absent. */
export async function readPartSuppliers(
  db: Database,
  organizationId: string
): Promise<Map<string, PartSupplier>> {
  const ctx = await systemFields(db, organizationId, 'vendor_part', VENDOR_PART_ATTRIBUTES)
  if (!ctx) return new Map()
  const records = await readSystemRecords(db, organizationId, ctx)

  const offersByPart = new Map<
    string,
    {
      id: string
      supplierId: string
      unitPrice: number | null
      shippingCost: number | null
      tariffRate: number | null
      otherCost: number | null
      isPreferred: boolean
    }[]
  >()
  for (const record of records) {
    const partId = record.related('vendor_part_part')
    const supplierId = record.related('vendor_part_contact')
    if (!partId || !supplierId) continue
    const offers = offersByPart.get(partId) ?? []
    offers.push({
      id: record.id,
      supplierId,
      unitPrice: record.number('vendor_part_unit_price'),
      shippingCost: record.number('vendor_part_shipping_cost'),
      tariffRate: record.number('vendor_part_tariff_rate'),
      otherCost: record.number('vendor_part_other_cost'),
      isPreferred: record.boolean('vendor_part_is_preferred') === true,
    })
    offersByPart.set(partId, offers)
  }

  const winners = new Map<string, string>()
  for (const [partId, offers] of offersByPart) {
    const winner = selectWinningVendor(offers)
    if (winner) winners.set(partId, winner.supplierId)
  }

  const supplierIds = [...new Set(winners.values())]
  const names = new Map<string, string>()
  if (supplierIds.length > 0) {
    const rows = await db
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, supplierIds)
        )
      )
    for (const row of rows) names.set(row.id, row.displayName ?? 'Unnamed supplier')
  }

  const out = new Map<string, PartSupplier>()
  for (const [partId, supplierId] of winners) {
    out.set(partId, { supplierId, supplierName: names.get(supplierId) ?? 'Unnamed supplier' })
  }
  return out
}
