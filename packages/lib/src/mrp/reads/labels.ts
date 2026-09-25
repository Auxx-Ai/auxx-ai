// packages/lib/src/mrp/reads/labels.ts

import type { Database } from '@auxx/database'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { VENDOR_PART_FIELDS } from '../../resources/registry/resources/vendor-part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, type SystemRecord, systemFields } from '../../resources/system-records'

/** The part attributes a row label shows. */
export const PART_LABEL_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_sku',
  'part_stock_status',
] as const)

export const VENDOR_PART_PICK = pickSystemAttributes(VENDOR_PART_FIELDS, [
  'vendor_part_part',
  'vendor_part_contact',
  'vendor_part_vendor_sku',
  'vendor_part_lead_time',
  'vendor_part_min_order_qty',
  'vendor_part_purchase_ratio',
  'vendor_part_is_preferred',
] as const)

export interface PartLabel {
  id: string
  name: string | null
  sku: string | null
  stockStatus: string | null
}

export interface VendorPartRow {
  id: string
  partId: string | null
  supplierId: string | null
  vendorSku: string | null
  leadTimeDays: number | null
  minOrderQty: number | null
  purchaseRatio: number | null
  isPreferred: boolean
}

/** Names, SKUs and stock status for parts; archived parts included so an old run still labels its rows. */
export async function readPartLabels(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, PartLabel>> {
  const out = new Map<string, PartLabel>()
  if (partIds.length === 0) return out
  const ctx = await systemFields(db, organizationId, 'part', PART_LABEL_PICK)
  if (!ctx) return out
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: partIds,
    includeArchived: true,
  })
  for (const r of records) {
    out.set(r.id, {
      id: r.id,
      name: r.displayName,
      sku: r.text('part_sku'),
      stockStatus: r.option('part_stock_status'),
    })
  }
  return out
}

/** Display names of any system records of `entityType` (companies, POs), values not read. */
export async function readRecordNames(
  db: Database,
  organizationId: string,
  entityType: string,
  ids: readonly string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out
  const ctx = await systemFields(db, organizationId, entityType, [] as const)
  if (!ctx) return out
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: unique,
    includeArchived: true,
    cells: false,
  })
  for (const r of records) out.set(r.id, r.displayName)
  return out
}

function toVendorPartRow(r: SystemRecord<(typeof VENDOR_PART_PICK)[number]>): VendorPartRow {
  return {
    id: r.id,
    partId: r.related('vendor_part_part'),
    supplierId: r.related('vendor_part_contact'),
    vendorSku: r.text('vendor_part_vendor_sku'),
    leadTimeDays: r.number('vendor_part_lead_time'),
    minOrderQty: r.number('vendor_part_min_order_qty'),
    purchaseRatio: r.number('vendor_part_purchase_ratio'),
    isPreferred: r.boolean('vendor_part_is_preferred') ?? false,
  }
}

/** Live vendor parts by id, or by the part / supplier they point at. */
export async function readVendorParts(
  db: Database,
  organizationId: string,
  filter:
    | { ids: readonly string[] }
    | { partIds: readonly string[] }
    | { supplierIds: readonly string[] }
): Promise<VendorPartRow[]> {
  const ctx = await systemFields(db, organizationId, 'vendor_part', VENDOR_PART_PICK)
  if (!ctx) return []
  if ('ids' in filter) {
    if (filter.ids.length === 0) return []
    return (await readSystemRecords(db, organizationId, ctx, { ids: filter.ids })).map(
      toVendorPartRow
    )
  }
  const [attribute, values] =
    'partIds' in filter
      ? (['vendor_part_part', filter.partIds] as const)
      : (['vendor_part_contact', filter.supplierIds] as const)
  if (values.length === 0 || !ctx.fields[attribute]) return []
  return (await readSystemRecords(db, organizationId, ctx, { by: { attribute, in: values } })).map(
    toVendorPartRow
  )
}
