// packages/lib/src/mrp/reads/supplier-horizon.ts

import type { Database } from '@auxx/database'
import {
  addDaysToDayKey,
  addMonthsToDayKey,
  type DayKey,
  dayKeyInZone,
  todayInZone,
} from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { NotFoundError } from '../../errors'
import { type PoLineReceiptRow, readReceiptsForPoLines } from '../../inventory/movements/fact/reads'
import { summarizeSupplyHistory } from '../run/lead-time'
import { rhythmDate } from '../run/scheduled'
import type { ReceiptObservation, SupplierInput } from '../types'
import { guard } from './guard'
import {
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
  readPurchaseOrderLines,
  readPurchaseOrders,
  readSupplierInputs,
} from './purchase-orders'
import type { MrpRunRef } from './runs'
import { readSupplierNextOrders, type SupplierCard } from './supplier-next-order'

export type SupplierHorizonWindow = '6m' | '12m' | '24m'

export interface SupplierHorizonOrder {
  purchaseOrderId: string
  name: string | null
  status: 'issued' | 'closed'
  orderedAt: DayKey
  expectedAt: DayKey | null
  lastReceivedAt: DayKey | null
  open: boolean
  /** Open and overdue: today + the supplier's median lateness (02 §6.2). */
  projectedArrival: DayKey | null
  quantityOrdered: number
  quantityReceived: number
}

export interface SupplierHorizonPart {
  partId: string
  name: string | null
  sku: string | null
  orderByDate: DayKey | null
  stockoutDate: DayKey | null
  pullsOrderForward: boolean
  wontMakeNextArrival: boolean
  suggestedQty: number | null
}

/** One supplier's horizon chart (plans/mrp/16-supplier-charts.md §3.3). */
export interface SupplierHorizon {
  runAsOf: DayKey | null
  from: DayKey
  to: DayKey
  hasEarlier: boolean
  orders: SupplierHorizonOrder[]
  /** Scheduled suppliers only. */
  cycle: { statedDays: number; rhythmDate: DayKey | null } | null
  nextOrder: { orderDate: DayKey; arrivalDate: DayKey | null; pulledForwardBy: string[] } | null
  parts: SupplierHorizonPart[]
}

const WINDOW_MONTHS: Record<SupplierHorizonWindow, number> = { '6m': 6, '12m': 12, '24m': 24 }
const FUTURE_DAYS = 90

const maxDay = (days: readonly (DayKey | null | undefined)[]): DayKey | null =>
  days.reduce<DayKey | null>((max, d) => (d && (max === null || d > max) ? d : max), null)

/** `to` is the later of the latest following arrival and today + 90; both edges move back `offset` windows. */
export function horizonWindow(params: {
  today: DayKey
  followingArrivals: readonly (DayKey | null)[]
  window: SupplierHorizonWindow
  offset?: number
}): { from: DayKey; to: DayKey } {
  const months = WINDOW_MONTHS[params.window]
  const edge = maxDay([addDaysToDayKey(params.today, FUTURE_DAYS), ...params.followingArrivals])
  const to = addMonthsToDayKey(edge as DayKey, -months * (params.offset ?? 0))
  return { from: addMonthsToDayKey(to, -months), to }
}

/** An open PO past its expected day lands at today + median lateness; otherwise null. */
export function projectedArrival(
  order: { open: boolean; expectedAt: DayKey | null },
  today: DayKey,
  medianLatenessDays: number | null
): DayKey | null {
  if (!order.open || !order.expectedAt || order.expectedAt >= today) return null
  return addDaysToDayKey(today, Math.max(0, Math.ceil(medianLatenessDays ?? 0)))
}

/** The last day a PO row draws to: its latest receipt, expected or projected day, or today while open. */
export function orderSpanEnd(order: SupplierHorizonOrder, today: DayKey): DayKey {
  return maxDay([
    order.orderedAt,
    order.lastReceivedAt,
    order.expectedAt,
    order.projectedArrival,
    order.open ? today : null,
  ]) as DayKey
}

/** One row per issued/closed PO with an order date, oldest first, and the supplier's median lateness. */
export function buildHorizonOrders(params: {
  zone: string
  today: DayKey
  orders: readonly PurchaseOrderRow[]
  lines: readonly PurchaseOrderLineRow[]
  receipts: readonly PoLineReceiptRow[]
}): { orders: SupplierHorizonOrder[]; medianLatenessDays: number | null } {
  const receiptsByLine = new Map<string, { day: DayKey; quantity: number }[]>()
  for (const r of params.receipts) {
    const list = receiptsByLine.get(r.purchaseOrderLineId) ?? []
    list.push({ day: dayKeyInZone(r.occurredAt, params.zone), quantity: r.quantity })
    receiptsByLine.set(r.purchaseOrderLineId, list)
  }
  const linesByOrder = new Map<string, PurchaseOrderLineRow[]>()
  for (const line of params.lines) {
    if (!line.purchaseOrderId) continue
    const list = linesByOrder.get(line.purchaseOrderId) ?? []
    list.push(line)
    linesByOrder.set(line.purchaseOrderId, list)
  }

  const observations: ReceiptObservation[] = []
  const rows: Omit<SupplierHorizonOrder, 'projectedArrival'>[] = []
  for (const order of params.orders) {
    if (order.status !== 'issued' && order.status !== 'closed') continue
    const lines = linesByOrder.get(order.id) ?? []
    for (const line of lines) {
      observations.push({
        purchaseOrderLineId: line.id,
        partId: line.partId ?? '',
        vendorPartId: line.vendorPartId,
        createdAt: dayKeyInZone(order.createdAt, params.zone),
        orderedAt: order.orderedAt,
        expectedAt: order.expectedAt,
        quantityOrdered: line.quantityOrdered,
        receipts: receiptsByLine.get(line.id) ?? [],
      })
    }
    if (!order.orderedAt) continue
    rows.push({
      purchaseOrderId: order.id,
      name: order.name,
      status: order.status,
      orderedAt: order.orderedAt,
      expectedAt: order.expectedAt,
      lastReceivedAt: maxDay(
        lines.flatMap((l) => (receiptsByLine.get(l.id) ?? []).map((r) => r.day))
      ),
      open:
        order.status === 'issued' && lines.some((l) => l.quantityOrdered - l.quantityReceived > 0),
      quantityOrdered: lines.reduce((sum, l) => sum + l.quantityOrdered, 0),
      quantityReceived: lines.reduce((sum, l) => sum + l.quantityReceived, 0),
    })
  }

  const { medianLatenessDays } = summarizeSupplyHistory(observations)
  const orders = rows
    .map((row) => ({
      ...row,
      projectedArrival: projectedArrival(row, params.today, medianLatenessDays),
    }))
    .sort(
      (a, b) =>
        a.orderedAt.localeCompare(b.orderedAt) || a.purchaseOrderId.localeCompare(b.purchaseOrderId)
    )
  return { orders, medianLatenessDays }
}

/** The horizon from the supplier's PO rows and its run card; with no run only the past lanes fill. */
export function assembleSupplierHorizon(params: {
  today: DayKey
  window: SupplierHorizonWindow
  offset?: number
  supplier: SupplierInput
  orders: readonly SupplierHorizonOrder[]
  run: Pick<MrpRunRef, 'asOfDay'> | null
  card: SupplierCard | null
}): SupplierHorizon {
  const card = params.run ? params.card : null
  const { from, to } = horizonWindow({
    today: params.today,
    followingArrivals: card?.parts.map((p) => p.followingArrivalDate) ?? [],
    window: params.window,
    offset: params.offset,
  })
  const { supplier } = params
  const scheduled = supplier.orderMode === 'scheduled' && (supplier.orderCycleDays ?? 0) > 0
  return {
    runAsOf: params.run?.asOfDay ?? null,
    from,
    to,
    hasEarlier: params.orders.some((o) => o.orderedAt < from),
    orders: params.orders.filter((o) => o.orderedAt <= to && orderSpanEnd(o, params.today) >= from),
    cycle: scheduled
      ? { statedDays: supplier.orderCycleDays as number, rhythmDate: rhythmDate(supplier) }
      : null,
    nextOrder: card?.nextOrderDate
      ? {
          orderDate: card.nextOrderDate,
          arrivalDate: card.nextArrivalDate,
          pulledForwardBy: card.pulledForwardBy,
        }
      : null,
    parts: (card?.parts ?? [])
      .map(
        (p): SupplierHorizonPart => ({
          partId: p.partId,
          name: p.name,
          sku: p.sku,
          orderByDate: p.orderByDate,
          stockoutDate: p.stockoutDate,
          pullsOrderForward: p.pullsOrderForward,
          wontMakeNextArrival: p.wontMakeNextArrival,
          suggestedQty: p.suggestedQty,
        })
      )
      .sort(
        (a, b) =>
          (a.orderByDate ?? '9999').localeCompare(b.orderByDate ?? '9999') ||
          a.partId.localeCompare(b.partId)
      ),
  }
}

/** One supplier's POs, next order and part order-by/stockout dates on one time axis (16 §3). */
export async function readSupplierHorizon(
  db: Database,
  organizationId: string,
  input: {
    supplierId: string
    window: SupplierHorizonWindow
    offset?: number
    runId?: string | null
  }
): Promise<Result<SupplierHorizon, Error>> {
  return guard(
    async () => {
      const [zone, suppliers, orders, nextOrders] = await Promise.all([
        readBookTimeZoneOrUtc(organizationId),
        readSupplierInputs(db, organizationId, [input.supplierId]),
        readPurchaseOrders(db, organizationId, { vendorIds: [input.supplierId] }, [
          'issued',
          'closed',
        ]),
        readSupplierNextOrders(db, organizationId, {
          supplierId: input.supplierId,
          runId: input.runId,
        }),
      ])
      const supplier = suppliers.get(input.supplierId)
      if (!supplier) throw new NotFoundError('Supplier not found')
      if (nextOrders.isErr()) throw nextOrders.error

      const lines = await readPurchaseOrderLines(db, organizationId, {
        purchaseOrderIds: orders.map((o) => o.id),
      })
      const receipts = await readReceiptsForPoLines(
        db,
        organizationId,
        lines.map((l) => l.id)
      )
      if (receipts.isErr()) throw receipts.error

      const today = todayInZone(zone)
      const { run, suppliers: cards } = nextOrders.value
      return assembleSupplierHorizon({
        today,
        window: input.window,
        offset: input.offset,
        supplier,
        orders: buildHorizonOrders({ zone, today, orders, lines, receipts: receipts.value }).orders,
        run,
        card: cards.find((c) => c.supplierId === input.supplierId) ?? null,
      })
    },
    'Failed to read the supplier horizon',
    { organizationId, supplierId: input.supplierId }
  )
}
