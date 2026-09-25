// packages/lib/src/mrp/reads/purchase-orders.ts

import { type Database, schema } from '@auxx/database'
import { type DayKey, toCalendarDay } from '@auxx/utils/calendar-day'
import { and, inArray, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { chunkArray } from '../../import/utils/chunk-array'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../resources/registry/resources/purchase-order-line-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import {
  readSystemRecords,
  type SystemInstanceRow,
  systemFields,
  systemInstanceColumns,
  systemRecordScope,
  systemValueJoin,
} from '../../resources/system-records'
import type { OpenPoLineInput, SupplierInput } from '../types'

// PURCHASE_ORDER_FIELDS and COMPANY_FIELDS are typed `Record<string, ResourceField>`, so
// `pickSystemAttributes` cannot check these two lists.
const PO_ATTRIBUTES = [
  'purchase_order_status',
  'purchase_order_vendor',
  'purchase_order_ordered_at',
  'purchase_order_expected_at',
] as const
const COMPANY_ORDERING_ATTRIBUTES = [
  'company_order_mode',
  'company_order_cycle_days',
  'company_next_order_date',
] as const

const PO_LINE_PICK = pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, [
  'purchase_order_line_purchase_order',
  'purchase_order_line_part',
  'purchase_order_line_vendor_part',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
] as const)

export type PurchaseOrderStatusValue = 'draft' | 'issued' | 'closed' | 'canceled'

export interface PurchaseOrderRow {
  id: string
  name: string | null
  createdAt: Date
  status: PurchaseOrderStatusValue
  vendorId: string | null
  orderedAt: DayKey | null
  expectedAt: DayKey | null
}

export interface PurchaseOrderLineRow {
  id: string
  purchaseOrderId: string | null
  partId: string | null
  vendorPartId: string | null
  quantityOrdered: number
  quantityReceived: number
}

const ID_CHUNK = 200

/** Purchase orders in `statuses`, by id or by vendor; the status filter is applied in SQL. */
export async function readPurchaseOrders(
  db: Database,
  organizationId: string,
  filter: { ids: readonly string[] } | { vendorIds: readonly string[] },
  statuses: readonly PurchaseOrderStatusValue[]
): Promise<PurchaseOrderRow[]> {
  const ctx = await systemFields(db, organizationId, 'purchase_order', PO_ATTRIBUTES, {
    required: ['purchase_order_status'],
  })
  if (!ctx?.fields.purchase_order_status) return []
  const statusFieldId = ctx.fields.purchase_order_status.id
  const vendorField = ctx.fields.purchase_order_vendor
  const byVendor = 'vendorIds' in filter
  if (byVendor && !vendorField) return []
  const ids = byVendor ? filter.vendorIds : filter.ids

  const instances: SystemInstanceRow[] = []
  for (const chunk of chunkArray([...new Set(ids)], ID_CHUNK)) {
    const statusValue = alias(schema.FieldValue, 'mrp_po_status_v')
    const vendorValue = alias(schema.FieldValue, 'mrp_po_vendor_v')
    let query = db
      .select(systemInstanceColumns)
      .from(schema.EntityInstance)
      .innerJoin(
        statusValue,
        and(
          systemValueJoin(statusValue, statusFieldId),
          inArray(statusValue.optionId, [...statuses])
        )
      )
      .$dynamic()
    const where: SQL[] = [systemRecordScope(organizationId, ctx.defId)]
    if (byVendor && vendorField) {
      query = query.innerJoin(
        vendorValue,
        and(
          systemValueJoin(vendorValue, vendorField.id),
          inArray(vendorValue.relatedEntityId, chunk)
        )
      )
    } else {
      where.push(inArray(schema.EntityInstance.id, chunk))
    }
    instances.push(...((await query.where(and(...where))) as SystemInstanceRow[]))
  }
  if (instances.length === 0) return []

  const records = await readSystemRecords(db, organizationId, ctx, { instances })
  return records.map((r) => ({
    id: r.id,
    name: r.displayName,
    createdAt: r.createdAt,
    status: r.option('purchase_order_status') as PurchaseOrderStatusValue,
    vendorId: r.related('purchase_order_vendor'),
    orderedAt: toCalendarDay(r.date('purchase_order_ordered_at')),
    expectedAt: toCalendarDay(r.date('purchase_order_expected_at')),
  }))
}

/** Live PO lines by the parts they buy or by the orders they belong to. */
export async function readPurchaseOrderLines(
  db: Database,
  organizationId: string,
  filter: { partIds: readonly string[] } | { purchaseOrderIds: readonly string[] }
): Promise<PurchaseOrderLineRow[]> {
  const ctx = await systemFields(db, organizationId, 'purchase_order_line', PO_LINE_PICK)
  if (!ctx) return []
  const [attribute, values] =
    'partIds' in filter
      ? (['purchase_order_line_part', filter.partIds] as const)
      : (['purchase_order_line_purchase_order', filter.purchaseOrderIds] as const)
  if (values.length === 0 || !ctx.fields[attribute]) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute, in: values },
  })
  return records.map((r) => ({
    id: r.id,
    purchaseOrderId: r.related('purchase_order_line_purchase_order'),
    partId: r.related('purchase_order_line_part'),
    vendorPartId: r.related('purchase_order_line_vendor_part'),
    quantityOrdered: r.number('purchase_order_line_quantity_ordered') ?? 0,
    quantityReceived: r.number('purchase_order_line_quantity_received') ?? 0,
  }))
}

/** Open lines on issued orders for these parts, as the projection takes them (02 §6.3; drafts never count, D17). */
export async function readOpenIssuedPoLines(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<OpenPoLineInput[]> {
  const lines = await readPurchaseOrderLines(db, organizationId, { partIds })
  const orderIds = [
    ...new Set(lines.flatMap((l) => (l.purchaseOrderId ? [l.purchaseOrderId] : []))),
  ]
  const orders = new Map(
    (await readPurchaseOrders(db, organizationId, { ids: orderIds }, ['issued'])).map((o) => [
      o.id,
      o,
    ])
  )
  const out: OpenPoLineInput[] = []
  for (const line of lines) {
    const order = line.purchaseOrderId ? orders.get(line.purchaseOrderId) : undefined
    const open = line.quantityOrdered - line.quantityReceived
    if (!order || !line.partId || open <= 0) continue
    out.push({
      id: line.id,
      purchaseOrderId: order.id,
      partId: line.partId,
      vendorPartId: line.vendorPartId,
      supplierId: order.vendorId,
      status: 'issued',
      quantityOpen: open,
      orderedAt: order.orderedAt,
      expectedAt: order.expectedAt,
    })
  }
  return out
}

export interface SupplierRow extends SupplierInput {
  name: string | null
}

/** Suppliers' ordering settings plus their last issued/closed order date, for the rhythm (02 §6.4). */
export async function readSupplierInputs(
  db: Database,
  organizationId: string,
  supplierIds: readonly string[]
): Promise<Map<string, SupplierRow>> {
  const out = new Map<string, SupplierRow>()
  const unique = [...new Set(supplierIds)]
  if (unique.length === 0) return out
  const ctx = await systemFields(db, organizationId, 'company', COMPANY_ORDERING_ATTRIBUTES)
  if (!ctx) return out
  const [companies, orders] = await Promise.all([
    readSystemRecords(db, organizationId, ctx, { ids: unique, includeArchived: true }),
    readPurchaseOrders(db, organizationId, { vendorIds: unique }, ['issued', 'closed']),
  ])
  const lastOrdered = new Map<string, DayKey>()
  for (const order of orders) {
    if (!order.vendorId || !order.orderedAt) continue
    const prev = lastOrdered.get(order.vendorId)
    if (!prev || order.orderedAt > prev) lastOrdered.set(order.vendorId, order.orderedAt)
  }
  for (const c of companies) {
    const mode = c.option('company_order_mode')
    out.set(c.id, {
      id: c.id,
      name: c.displayName,
      orderMode: mode === 'scheduled' || mode === 'when_needed' ? mode : null,
      orderCycleDays: c.number('company_order_cycle_days'),
      nextOrderDate: toCalendarDay(c.date('company_next_order_date')),
      lastIssuedOrderedAt: lastOrdered.get(c.id) ?? null,
    })
  }
  return out
}
