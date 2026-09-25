// packages/lib/src/mrp/run/load-inputs.ts

import type { Database } from '@auxx/database'
import {
  addDaysToDayKey,
  addMonthsToDayKey,
  type DayKey,
  dayKeyInZone,
  endOfMonthDay,
  previousDayKey,
  startOfMonthDay,
} from '@auxx/utils/calendar-day'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { chunkArray } from '../../import/utils/chunk-array'
import type { SubpartRow } from '../../inventory/costing/cost-calculator'
import { compareFactsToLedger } from '../../inventory/movements/fact/drift-check'
import {
  readDailyActivity,
  readDailySeries,
  readReceiptsForPoLines,
  readUsageBuckets,
  readWhereUsedShares,
} from '../../inventory/movements/fact/reads'
import {
  BuildStatus,
  OrderFulfillmentStatus,
  PurchaseOrderStatus,
} from '../../resources/registry/enum-values'
import { BUILD_FIELDS } from '../../resources/registry/resources/build-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import {
  findSystemRecordIdsByValue,
  readSystemRecords,
  systemFields,
} from '../../resources/system-records'
import type { MrpBufferMode } from '../client'
import { readVendorParts } from '../reads/labels'
import {
  readPurchaseOrderLines,
  readPurchaseOrders,
  readSupplierInputs,
} from '../reads/purchase-orders'
import type {
  DailyActivity,
  DailySeriesPoint,
  MonthlyBucket,
  MrpCostSource,
  MrpPartKind,
  OpenBuildInput,
  OpenPoLineInput,
  PartInput,
  ReceiptObservation,
  RunSettings,
  SupplierInput,
  VendorPartInput,
  WhereUsedShare,
} from '../types'

const PART_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_kind',
  'part_cost_source',
  'part_quantity_on_hand',
  'part_mrp_buffer_mode',
  'part_build_lead_time_days',
  'part_build_cycle_days',
  'part_mrp_lead_time_factor',
  'part_mrp_variability_factor',
] as const)
// PURCHASE_ORDER_FIELDS is not declared with `defineResourceFields`, so it cannot be picked yet.
const PO_STATUS_PICK = ['purchase_order_status'] as const
const BUILD_PICK = pickSystemAttributes(BUILD_FIELDS, [
  'build_part',
  'build_status',
  'build_quantity_planned',
  'build_quantity_produced',
] as const)
const ORDER_PICK = pickSystemAttributes(ORDER_FIELDS, [
  'order_fulfillment_status',
  'order_cancelled_at',
] as const)
const LINE_ITEM_PICK = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_order',
  'line_item_part',
  'line_item_qty',
  'line_item_fulfilled_qty',
] as const)

/** Parts per mirror query: bounds the dense series (parts × days) one statement returns. */
const MIRROR_PART_CHUNK = 500
/** Months of history seasonality learns from (02 §6.5). */
const SEASONAL_HISTORY_MONTHS = 24
/** PO lines ordered this far back feed the observed lead time (02 §6.2). */
const RECEIPT_HISTORY_DAYS = 365

/** The ADU window: the `aduWindowDays` whole book days before `asOf`. */
export interface RunWindow {
  /** Inclusive. */
  from: DayKey
  /** Inclusive; the day before `asOf`, since today is still moving. */
  to: DayKey
}

/** Everything the pure layer needs for one org's run. */
export interface RunInputs {
  asOf: DayKey
  zone: string
  window: RunWindow
  /** Every live part except `service`. */
  parts: PartInput[]
  vendorParts: VendorPartInput[]
  suppliers: SupplierInput[]
  /** Open lines on issued AND draft POs (D17), for planned parts only. */
  poLines: OpenPoLineInput[]
  builds: OpenBuildInput[]
  /** Ordered − fulfilled on open, uncancelled orders, by part (D10). */
  openDemand: Map<string, number>
  edges: SubpartRow[]
  /** Dense over the window. */
  series: DailySeriesPoint[]
  /** Sparse, over the 24 seasonal months plus the window. */
  activity: DailyActivity[]
  /** Complete months only; `sold` summed from `activity`. */
  monthly: MonthlyBucket[]
  /** Build consumption per component and produced part over the window (7a); direct sales are added by the run. */
  whereUsed: WhereUsedShare[]
  receipts: ReceiptObservation[]
  /** Parts whose mirror disagrees with the ledger (`compareFactsToLedger`). */
  driftedPartIds: Set<string>
}

/** Every read one plan run needs, in as few queries as the system-records API allows. */
export async function loadRunInputs(
  db: Database,
  organizationId: string,
  input: { asOf: DayKey; zone: string; settings: RunSettings }
): Promise<Result<RunInputs, Error>> {
  try {
    const { asOf, zone, settings } = input
    const window: RunWindow = {
      from: addDaysToDayKey(asOf, -Math.max(1, Math.round(settings.aduWindowDays))),
      to: previousDayKey(asOf),
    }

    const [parts, edges] = await Promise.all([
      readParts(db, organizationId),
      readFreshSubpartEdges(organizationId),
    ])
    const partIds = parts.map((p) => p.id)
    const planned = new Set(partIds)
    const plannedEdges = edges.filter(
      (e) => planned.has(e.parentPartId) && planned.has(e.childPartId)
    )

    const [vendorParts, pos, builds, openDemand, drift] = await Promise.all([
      readPlannedVendorParts(db, organizationId, partIds),
      readPlannedPurchaseOrders(db, organizationId, planned, { asOf, zone }),
      readOpenBuilds(db, organizationId, planned),
      readOpenDemand(db, organizationId, planned),
      compareFactsToLedger(db, organizationId),
    ])
    if (drift.isErr()) return err(drift.error)

    const supplierIds = new Set<string>()
    for (const vp of vendorParts) if (vp.supplierId) supplierIds.add(vp.supplierId)
    const suppliers: SupplierInput[] = [
      ...(await readSupplierInputs(db, organizationId, [...supplierIds])).values(),
    ].map(({ name: _name, ...supplier }) => ({
      ...supplier,
      orderCycleDays: positive(supplier.orderCycleDays),
    }))

    const withChildren = new Set(plannedEdges.map((e) => e.parentPartId))
    const withVendorPart = new Set(vendorParts.map((vp) => vp.partId))
    for (const part of parts) {
      part.hasBomChildren = withChildren.has(part.id)
      part.hasVendorPart = withVendorPart.has(part.id)
    }

    const mirror = await readMirror(db, organizationId, partIds, { asOf, zone, window })
    if (mirror.isErr()) return err(mirror.error)

    const receiptRows = await readReceiptsForPoLines(
      db,
      organizationId,
      pos.historyLines.map((l) => l.purchaseOrderLineId)
    )
    if (receiptRows.isErr()) return err(receiptRows.error)
    const receiptsByLine = new Map<string, { day: DayKey; quantity: number }[]>()
    for (const row of receiptRows.value) {
      const list = receiptsByLine.get(row.purchaseOrderLineId) ?? []
      list.push({ day: dayKeyInZone(row.occurredAt, zone), quantity: row.quantity })
      receiptsByLine.set(row.purchaseOrderLineId, list)
    }

    return ok({
      asOf,
      zone,
      window,
      parts,
      vendorParts,
      suppliers,
      poLines: pos.openLines,
      builds,
      openDemand,
      edges: plannedEdges,
      ...mirror.value,
      receipts: pos.historyLines.map((line) => ({
        ...line,
        receipts: receiptsByLine.get(line.purchaseOrderLineId) ?? [],
      })),
      driftedPartIds: new Set(drift.value.map((d) => d.partId)),
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** The org's edge list read fresh through the provider, which also re-warms the cache for the UI (08 D42). */
async function readFreshSubpartEdges(organizationId: string): Promise<SubpartRow[]> {
  const cache = getOrgCache()
  await cache.invalidateAndRecompute(organizationId, ['subpartEdges'])
  return cache.get(organizationId, 'subpartEdges')
}

const positive = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) && value > 0 ? value : null

async function readParts(db: Database, organizationId: string): Promise<PartInput[]> {
  const ctx = await systemFields(db, organizationId, 'part', PART_PICK)
  if (!ctx) return []
  const rows = await readSystemRecords(db, organizationId, ctx)
  const parts: PartInput[] = []
  for (const row of rows) {
    const kind = row.option('part_kind') as MrpPartKind | null
    if (kind === 'service') continue
    parts.push({
      id: row.id,
      kind,
      costSource: row.option('part_cost_source') as MrpCostSource | null,
      quantityOnHand: row.number('part_quantity_on_hand') ?? 0,
      bufferMode: row.option('part_mrp_buffer_mode') as MrpBufferMode | null,
      buildLeadTimeDays: row.number('part_build_lead_time_days'),
      buildCycleDays: positive(row.number('part_build_cycle_days')),
      leadTimeFactorOverride: row.number('part_mrp_lead_time_factor'),
      variabilityFactorOverride: row.number('part_mrp_variability_factor'),
      hasVendorPart: false,
      hasBomChildren: false,
    })
  }
  return parts
}

/** Vendor parts of the planned parts, through the shared reader. */
async function readPlannedVendorParts(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<VendorPartInput[]> {
  const rows = await readVendorParts(db, organizationId, { partIds })
  return rows.flatMap((row) =>
    row.partId
      ? [
          {
            id: row.id,
            partId: row.partId,
            supplierId: row.supplierId,
            leadTimeDays: row.leadTimeDays,
            minOrderQty: positive(row.minOrderQty),
            purchaseRatio: positive(row.purchaseRatio),
            isPreferred: row.isPreferred,
          },
        ]
      : []
  )
}

/** A PO line with a receipt history to observe, before its receipts are attached. */
type HistoryLine = Omit<ReceiptObservation, 'receipts'>

interface PurchaseOrderReads {
  openLines: OpenPoLineInput[]
  historyLines: HistoryLine[]
}

/** Draft and issued POs for on-order and `draft_po_pending`, plus issued and closed ones ordered in the last year for receipts. */
async function readPlannedPurchaseOrders(
  db: Database,
  organizationId: string,
  planned: ReadonlySet<string>,
  { asOf, zone }: { asOf: DayKey; zone: string }
): Promise<PurchaseOrderReads> {
  const out: PurchaseOrderReads = { openLines: [], historyLines: [] }
  const statusCtx = await systemFields(db, organizationId, 'purchase_order', PO_STATUS_PICK, {
    required: ['purchase_order_status'],
  })
  if (!statusCtx) return out
  // Status first, across every vendor: selecting by supplier would miss a PO to a vendor with no vendor part.
  const byStatus = await findSystemRecordIdsByValue(db, organizationId, statusCtx, {
    attribute: 'purchase_order_status',
    option: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.CLOSED],
  })
  const ids = [...byStatus.values()].flat()
  if (ids.length === 0) return out
  const historyFrom = addDaysToDayKey(asOf, -RECEIPT_HISTORY_DAYS)
  const orders = new Map(
    (await readPurchaseOrders(db, organizationId, { ids }, ['draft', 'issued', 'closed']))
      .filter((o) => o.status !== 'closed' || (o.orderedAt !== null && o.orderedAt >= historyFrom))
      .map((o) => [o.id, o])
  )
  if (orders.size === 0) return out

  const lines = await readPurchaseOrderLines(db, organizationId, {
    purchaseOrderIds: [...orders.keys()],
  })
  for (const line of lines) {
    const po = line.purchaseOrderId ? orders.get(line.purchaseOrderId) : undefined
    if (!po || !line.partId || !planned.has(line.partId)) continue
    const open = line.quantityOrdered - line.quantityReceived
    if (po.status !== 'closed' && open > 0) {
      out.openLines.push({
        id: line.id,
        purchaseOrderId: po.id,
        partId: line.partId,
        vendorPartId: line.vendorPartId,
        supplierId: po.vendorId,
        status: po.status === 'draft' ? 'draft' : 'issued',
        quantityOpen: open,
        orderedAt: po.orderedAt,
        expectedAt: po.expectedAt,
      })
    }
    if (po.status !== 'draft' && po.orderedAt && po.orderedAt >= historyFrom) {
      out.historyLines.push({
        purchaseOrderLineId: line.id,
        partId: line.partId,
        vendorPartId: line.vendorPartId,
        createdAt: dayKeyInZone(po.createdAt, zone),
        orderedAt: po.orderedAt,
        expectedAt: po.expectedAt,
        quantityOrdered: line.quantityOrdered,
      })
    }
  }
  return out
}

/** An open build with the status the part page shows; the run ignores `status`. */
export type OpenBuildRow = OpenBuildInput & { status: 'planned' | 'in_progress' }

/** `planned` and `in_progress` builds: on order for their produced part. */
export async function readOpenBuilds(
  db: Database,
  organizationId: string,
  planned: ReadonlySet<string>
): Promise<OpenBuildRow[]> {
  const ctx = await systemFields(db, organizationId, 'build', BUILD_PICK, {
    required: ['build_part', 'build_status', 'build_quantity_planned'],
  })
  if (!ctx) return []
  const byStatus = await findSystemRecordIdsByValue(db, organizationId, ctx, {
    attribute: 'build_status',
    option: [BuildStatus.PLANNED, BuildStatus.IN_PROGRESS],
  })
  const ids = [...byStatus.values()].flat()
  if (ids.length === 0) return []
  const rows = await readSystemRecords(db, organizationId, ctx, { ids })
  return rows.flatMap((row) => {
    const partId = row.related('build_part')
    const open =
      (row.number('build_quantity_planned') ?? 0) - (row.number('build_quantity_produced') ?? 0)
    if (!partId || !planned.has(partId) || open <= 0) return []
    const status =
      row.option('build_status') === BuildStatus.IN_PROGRESS ? 'in_progress' : 'planned'
    return [{ id: row.id, partId, status, quantityOpen: open, dueDay: null }]
  })
}

/** Ordered − fulfilled per part over order lines of open, uncancelled orders (02 §6.3). */
async function readOpenDemand(
  db: Database,
  organizationId: string,
  planned: ReadonlySet<string>
): Promise<Map<string, number>> {
  const demand = new Map<string, number>()
  const orderCtx = await systemFields(db, organizationId, 'order', ORDER_PICK, {
    required: ['order_fulfillment_status'],
  })
  const lineCtx = await systemFields(db, organizationId, 'line_item', LINE_ITEM_PICK, {
    required: ['line_item_order', 'line_item_part', 'line_item_qty'],
  })
  if (!orderCtx || !lineCtx) return demand

  const byStatus = await findSystemRecordIdsByValue(db, organizationId, orderCtx, {
    attribute: 'order_fulfillment_status',
    option: [OrderFulfillmentStatus.UNFULFILLED, OrderFulfillmentStatus.PARTIAL],
  })
  const candidateIds = [...byStatus.values()].flat()
  if (candidateIds.length === 0) return demand
  const orders = await readSystemRecords(db, organizationId, orderCtx, { ids: candidateIds })
  const unfulfilled = new Map<string, boolean>()
  for (const order of orders) {
    if (order.date('order_cancelled_at')) continue
    unfulfilled.set(
      order.id,
      order.option('order_fulfillment_status') === OrderFulfillmentStatus.UNFULFILLED
    )
  }
  if (unfulfilled.size === 0) return demand

  const lines = await readSystemRecords(db, organizationId, lineCtx, {
    by: { attribute: 'line_item_order', in: [...unfulfilled.keys()] },
  })
  for (const line of lines) {
    const orderId = line.related('line_item_order')
    const partId = line.related('line_item_part')
    if (!orderId || !partId || !planned.has(partId)) continue
    // An unfulfilled order shipped nothing, whatever a stale channel count says.
    const fulfilled = unfulfilled.get(orderId) ? 0 : (line.number('line_item_fulfilled_qty') ?? 0)
    const open = (line.number('line_item_qty') ?? 0) - fulfilled
    if (open > 0) demand.set(partId, (demand.get(partId) ?? 0) + open)
  }
  return demand
}

type MirrorReads = Pick<RunInputs, 'series' | 'activity' | 'monthly' | 'whereUsed'>

/** The daily series over the window, activity and monthly buckets over 24 months, where-used over the window. */
async function readMirror(
  db: Database,
  organizationId: string,
  partIds: string[],
  input: { asOf: DayKey; zone: string; window: RunWindow }
): Promise<Result<MirrorReads, Error>> {
  const { zone, window } = input
  const monthsTo = endOfMonthDay(addMonthsToDayKey(startOfMonthDay(input.asOf), -1))
  const monthsFrom = addMonthsToDayKey(startOfMonthDay(input.asOf), -SEASONAL_HISTORY_MONTHS)
  const activityFrom = monthsFrom < window.from ? monthsFrom : window.from
  const out: MirrorReads = { series: [], activity: [], monthly: [], whereUsed: [] }
  const usage: { partId: string; month: string; consumed: number; stockoutDays: number }[] = []

  for (const chunk of chunkArray(partIds, MIRROR_PART_CHUNK)) {
    const [series, activity, buckets, shares] = await Promise.all([
      readDailySeries(db, organizationId, {
        partIds: chunk,
        from: window.from,
        to: window.to,
        zone,
      }),
      readDailyActivity(db, organizationId, {
        partIds: chunk,
        from: activityFrom,
        to: window.to,
        zone,
      }),
      readUsageBuckets(db, organizationId, {
        partIds: chunk,
        grain: 'month',
        from: monthsFrom,
        to: monthsTo,
        zone,
      }),
      readWhereUsedShares(db, organizationId, chunk, { from: window.from, to: window.to, zone }),
    ])
    if (series.isErr()) return err(series.error)
    if (activity.isErr()) return err(activity.error)
    if (buckets.isErr()) return err(buckets.error)
    if (shares.isErr()) return err(shares.error)
    out.series.push(...series.value)
    out.activity.push(...activity.value)
    for (const b of buckets.value) {
      // Scrap is usage (01 §2), as in `computeUsage`.
      usage.push({ ...b, consumed: b.consumed + b.scrapped })
    }
    for (const s of shares.value) {
      out.whereUsed.push({
        partId: s.componentId,
        parentId: s.producedPartId,
        quantity: s.quantity,
      })
    }
  }

  const soldByMonth = new Map<string, number>()
  for (const a of out.activity) {
    if (a.saleQty <= 0) continue
    const key = `${a.partId}|${a.day.slice(0, 7)}`
    soldByMonth.set(key, (soldByMonth.get(key) ?? 0) + a.saleQty)
  }
  out.monthly = usage.map((b) => ({
    partId: b.partId,
    month: b.month,
    sold: soldByMonth.get(`${b.partId}|${b.month}`) ?? 0,
    consumed: b.consumed,
    stockoutDays: b.stockoutDays,
  }))
  return ok(out)
}
