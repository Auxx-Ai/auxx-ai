// packages/lib/src/mrp/reads/supply-history.ts

import type { Database } from '@auxx/database'
import { type DayKey, dayKeyInZone, daysBetween } from '@auxx/utils/calendar-day'
import { median } from '@auxx/utils/stats'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { NotFoundError } from '../../errors'
import { type PoLineReceiptRow, readReceiptsForPoLines } from '../../inventory/movements/fact/reads'
import {
  hasLeadTimeDrift,
  type LineObservation,
  type ObservationExclusion,
  observeLine,
  type SupplyHistoryStats,
  summarizeSupplyHistory,
} from '../run/lead-time'
import type { ReceiptObservation } from '../types'
import { guard } from './guard'
import { readPartLabels, readRecordNames, readVendorParts, type VendorPartRow } from './labels'
import {
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
  readPurchaseOrderLines,
  readPurchaseOrders,
  readSupplierInputs,
} from './purchase-orders'

/** One PO line as the Supply history list shows it (07 §4.5); excluded lines carry their reason. */
export interface SupplyHistoryLine {
  purchaseOrderLineId: string
  purchaseOrderId: string
  purchaseOrderName: string | null
  status: PurchaseOrderRow['status']
  orderedAt: DayKey | null
  expectedAt: DayKey | null
  lastReceivedAt: DayKey | null
  quantityOrdered: number
  quantityReceived: number
  observation: LineObservation | null
  excludedReason: ObservationExclusion | null
}

/** Observed stats for one vendor part beside its stated values (02 §6.2). */
export interface VendorPartSupply {
  /** Null groups a part's lines that name no vendor part, per supplier. */
  vendorPartId: string | null
  partId: string | null
  partName: string | null
  partSku: string | null
  supplierId: string | null
  supplierName: string | null
  stated: {
    leadTimeDays: number | null
    minOrderQty: number | null
    purchaseRatio: number | null
    isPreferred: boolean
  }
  stats: SupplyHistoryStats
  leadTimeDrift: boolean
  medianLineQuantity: number | null
  lines: SupplyHistoryLine[]
}

export interface PartSupplyHistory {
  zone: string
  vendorParts: VendorPartSupply[]
}

export interface SupplierPerformance {
  zone: string
  supplier: {
    id: string
    name: string | null
    orderMode: 'when_needed' | 'scheduled' | null
    statedCycleDays: number | null
    nextOrderDate: DayKey | null
  }
  /** Median days between consecutive issued/closed orders, beside the stated cycle (D16). */
  medianOrderIntervalDays: number | null
  orderCount: number
  vendorParts: VendorPartSupply[]
}

/** Median gap between consecutive distinct order days. */
export function medianOrderInterval(orderedDays: readonly (DayKey | null)[]): number | null {
  const days = [...new Set(orderedDays.filter((d): d is DayKey => d !== null))].sort()
  const gaps: number[] = []
  for (let i = 1; i < days.length; i++) {
    const gap = daysBetween(days[i - 1] as DayKey, days[i] as DayKey)
    if (gap !== null) gaps.push(gap)
  }
  return median(gaps)
}

/** Lines of issued/closed orders grouped by vendor part (or part + supplier when the line names none), with stats. */
export function buildSupplyHistory(params: {
  zone: string
  vendorParts: readonly VendorPartRow[]
  lines: readonly PurchaseOrderLineRow[]
  orders: ReadonlyMap<string, PurchaseOrderRow>
  receipts: readonly PoLineReceiptRow[]
  partLabels: ReadonlyMap<string, { name: string | null; sku: string | null }>
  supplierNames: ReadonlyMap<string, string | null>
}): VendorPartSupply[] {
  const receiptsByLine = new Map<string, { day: DayKey; quantity: number }[]>()
  for (const r of params.receipts) {
    const list = receiptsByLine.get(r.purchaseOrderLineId) ?? []
    list.push({ day: dayKeyInZone(r.occurredAt, params.zone), quantity: r.quantity })
    receiptsByLine.set(r.purchaseOrderLineId, list)
  }
  const vendorPartById = new Map(params.vendorParts.map((vp) => [vp.id, vp]))

  const groups = new Map<
    string,
    {
      vendorPart: VendorPartRow | null
      partId: string | null
      supplierId: string | null
      rows: {
        line: PurchaseOrderLineRow
        order: PurchaseOrderRow
        observation: ReceiptObservation
      }[]
    }
  >()
  for (const vp of params.vendorParts) {
    groups.set(vp.id, { vendorPart: vp, partId: vp.partId, supplierId: vp.supplierId, rows: [] })
  }
  for (const line of params.lines) {
    const order = line.purchaseOrderId ? params.orders.get(line.purchaseOrderId) : undefined
    if (!order) continue
    const vendorPart = line.vendorPartId ? (vendorPartById.get(line.vendorPartId) ?? null) : null
    const key = vendorPart ? vendorPart.id : `${line.partId ?? ''}|${order.vendorId ?? ''}`
    let group = groups.get(key)
    if (!group) {
      group = { vendorPart, partId: line.partId, supplierId: order.vendorId, rows: [] }
      groups.set(key, group)
    }
    group.rows.push({
      line,
      order,
      observation: {
        purchaseOrderLineId: line.id,
        partId: line.partId ?? '',
        vendorPartId: line.vendorPartId,
        createdAt: dayKeyInZone(order.createdAt, params.zone),
        orderedAt: order.orderedAt,
        expectedAt: order.expectedAt,
        quantityOrdered: line.quantityOrdered,
        receipts: receiptsByLine.get(line.id) ?? [],
      },
    })
  }

  return [...groups.values()].map((group) => {
    const vp = group.vendorPart
    const stats = summarizeSupplyHistory(group.rows.map((r) => r.observation))
    const label = group.partId ? params.partLabels.get(group.partId) : undefined
    const lines = group.rows
      .map(({ line, order, observation }): SupplyHistoryLine => {
        const observed = observeLine(observation)
        const days = observation.receipts.map((r) => r.day).sort()
        return {
          purchaseOrderLineId: line.id,
          purchaseOrderId: order.id,
          purchaseOrderName: order.name,
          status: order.status,
          orderedAt: order.orderedAt,
          expectedAt: order.expectedAt,
          lastReceivedAt: days[days.length - 1] ?? null,
          quantityOrdered: line.quantityOrdered,
          quantityReceived: observation.receipts.reduce((sum, r) => sum + r.quantity, 0),
          observation: observed.ok ? observed.value : null,
          excludedReason: observed.ok ? null : observed.reason,
        }
      })
      .sort((a, b) => ((a.orderedAt ?? '') < (b.orderedAt ?? '') ? 1 : -1))
    return {
      vendorPartId: vp?.id ?? null,
      partId: group.partId,
      partName: label?.name ?? null,
      partSku: label?.sku ?? null,
      supplierId: group.supplierId,
      supplierName: group.supplierId ? (params.supplierNames.get(group.supplierId) ?? null) : null,
      stated: {
        leadTimeDays: vp?.leadTimeDays ?? null,
        minOrderQty: vp?.minOrderQty ?? null,
        purchaseRatio: vp?.purchaseRatio ?? null,
        isPreferred: vp?.isPreferred ?? false,
      },
      stats,
      leadTimeDrift: hasLeadTimeDrift(vp?.leadTimeDays ?? null, stats),
      medianLineQuantity: median(
        group.rows.map((r) => r.line.quantityOrdered).filter((q) => q > 0)
      ),
      lines,
    }
  })
}

/** Receipts, labels and names for a set of lines already scoped to issued/closed orders. */
async function assemble(
  db: Database,
  organizationId: string,
  zone: string,
  vendorParts: VendorPartRow[],
  lines: PurchaseOrderLineRow[],
  orders: Map<string, PurchaseOrderRow>
): Promise<VendorPartSupply[]> {
  const scoped = lines.filter((l) => l.purchaseOrderId && orders.has(l.purchaseOrderId))
  const receipts = await readReceiptsForPoLines(
    db,
    organizationId,
    scoped.map((l) => l.id)
  )
  if (receipts.isErr()) throw receipts.error
  const partIds = [
    ...vendorParts.flatMap((vp) => (vp.partId ? [vp.partId] : [])),
    ...scoped.flatMap((l) => (l.partId ? [l.partId] : [])),
  ]
  const supplierIds = [
    ...vendorParts.flatMap((vp) => (vp.supplierId ? [vp.supplierId] : [])),
    ...[...orders.values()].flatMap((o) => (o.vendorId ? [o.vendorId] : [])),
  ]
  const [partLabels, supplierNames] = await Promise.all([
    readPartLabels(db, organizationId, [...new Set(partIds)]),
    readRecordNames(db, organizationId, 'company', supplierIds),
  ])
  return buildSupplyHistory({
    zone,
    vendorParts,
    lines: scoped,
    orders,
    receipts: receipts.value,
    partLabels,
    supplierNames,
  })
}

/** Per vendor part of one part: observed lead time, lateness and fill beside the stated values (02 §6.2). */
export async function readSupplyHistory(
  db: Database,
  organizationId: string,
  input: { partId: string }
): Promise<Result<PartSupplyHistory, Error>> {
  return guard(
    async () => {
      const zone = await readBookTimeZoneOrUtc(organizationId)
      const [vendorParts, lines] = await Promise.all([
        readVendorParts(db, organizationId, { partIds: [input.partId] }),
        readPurchaseOrderLines(db, organizationId, { partIds: [input.partId] }),
      ])
      const orderIds = lines.flatMap((l) => (l.purchaseOrderId ? [l.purchaseOrderId] : []))
      const orders = await readPurchaseOrders(db, organizationId, { ids: orderIds }, [
        'issued',
        'closed',
      ])
      const byId = new Map(orders.map((o) => [o.id, o]))
      return {
        zone,
        vendorParts: await assemble(db, organizationId, zone, vendorParts, lines, byId),
      }
    },
    'Failed to read supply history',
    { organizationId, partId: input.partId }
  )
}

/** One supplier's vendor parts with their observed stats, and its order interval beside the stated cycle (07 §4.7). */
export async function readSupplierPerformance(
  db: Database,
  organizationId: string,
  input: { supplierId: string }
): Promise<Result<SupplierPerformance, Error>> {
  return guard(
    async () => {
      const zone = await readBookTimeZoneOrUtc(organizationId)
      const [suppliers, vendorParts, orders] = await Promise.all([
        readSupplierInputs(db, organizationId, [input.supplierId]),
        readVendorParts(db, organizationId, { supplierIds: [input.supplierId] }),
        readPurchaseOrders(db, organizationId, { vendorIds: [input.supplierId] }, [
          'issued',
          'closed',
        ]),
      ])
      const supplier = suppliers.get(input.supplierId)
      if (!supplier) throw new NotFoundError('Supplier not found')
      const lines = await readPurchaseOrderLines(db, organizationId, {
        purchaseOrderIds: orders.map((o) => o.id),
      })
      const byId = new Map(orders.map((o) => [o.id, o]))
      const vendorPartSupply = await assemble(db, organizationId, zone, vendorParts, lines, byId)
      return {
        zone,
        supplier: {
          id: supplier.id,
          name: supplier.name,
          orderMode: supplier.orderMode,
          statedCycleDays: supplier.orderCycleDays,
          nextOrderDate: supplier.nextOrderDate,
        },
        medianOrderIntervalDays: medianOrderInterval(orders.map((o) => o.orderedAt)),
        orderCount: orders.length,
        // The card lists stats per vendor part; the per-line list is the part tab's.
        vendorParts: vendorPartSupply.map((vp) => ({ ...vp, lines: [] })),
      }
    },
    'Failed to read supplier performance',
    { organizationId, supplierId: input.supplierId }
  )
}
