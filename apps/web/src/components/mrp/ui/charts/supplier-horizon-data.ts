// apps/web/src/components/mrp/ui/charts/supplier-horizon-data.ts

import type { RouterOutputs } from '~/trpc/react'
import { dayToT, formatDay, formatQty } from './position-chart-data'

export type SupplierHorizonData = RouterOutputs['mrp']['supplierHorizon']
export type HorizonOrder = SupplierHorizonData['orders'][number]
export type HorizonPart = SupplierHorizonData['parts'][number]

export type HorizonWindow = '6m' | '12m' | '24m'

export const HORIZON_WINDOWS: { value: HorizonWindow; label: string }[] = [
  { value: '6m', label: '6 m' },
  { value: '12m', label: '12 m' },
  { value: '24m', label: '24 m' },
]

/** Part lanes past this fold into a "+N more" label (16 §3.1). */
export const PART_LANE_CAP = 12
export const PART_LANE_CAP_COMPACT = 6

/** What a hover shows for one mark: a title and label/value rows. */
export interface HorizonTip {
  title: string
  rows: [string, string][]
}

/** One drawn mark; every `t` is days since the epoch (`dayToT`). */
export type HorizonMark =
  | {
      key: string
      kind: 'bar'
      tone: 'received' | 'open'
      from: number
      to: number
      tip: HorizonTip
    }
  | { key: string; kind: 'overdue'; from: number; to: number; tip: HorizonTip }
  | { key: string; kind: 'next'; from: number; to: number; tip: HorizonTip }
  | { key: string; kind: 'dot'; t: number; tip: HorizonTip }
  | { key: string; kind: 'tick'; t: number }
  | { key: string; kind: 'rhythm'; t: number; tip: HorizonTip }
  | {
      key: string
      kind: 'dumbbell'
      /** Order-by, clamped to today; null when the run has none. */
      from: number | null
      to: number | null
      muted: boolean
      tip: HorizonTip
    }

export type HorizonLaneKind = 'orders' | 'po' | 'next' | 'part' | 'more'

export interface HorizonLane {
  key: string
  label: string
  kind: HorizonLaneKind
  /** The record the label links to. */
  record: { definition: 'purchase_order' | 'part'; id: string } | null
  /** A part that won't make the next arrival: muted marks and a badge on the label. */
  wontMake: boolean
  /** A part that pulls the next order forward: the one part lane with a direct label. */
  pulls: boolean
  marks: HorizonMark[]
}

export interface HorizonLanesOptions {
  /** The chart's today: the run day, or the calendar day with no run. */
  today: string
  /** Drawer variant: part lanes cap at 6 and the cycle ticks drop. */
  compact?: boolean
  /** Phones: the Orders lane and its cycle ticks drop. */
  mobile?: boolean
}

/** `[lo, hi]` of the chart's time axis, padded half a day so edge marks sit inside the plot. */
export function horizonExtent(data: Pick<SupplierHorizonData, 'from' | 'to'>): [number, number] {
  return [dayToT(data.from) - 0.5, dayToT(data.to) + 0.5]
}

const qty = (o: HorizonOrder) =>
  `${formatQty(o.quantityReceived)} of ${formatQty(o.quantityOrdered)} received`

function orderTip(o: HorizonOrder): HorizonTip {
  const rows: [string, string][] = [['Ordered', formatDay(o.orderedAt)]]
  if (o.expectedAt) rows.push(['Expected', formatDay(o.expectedAt)])
  if (o.lastReceivedAt) rows.push(['Received', formatDay(o.lastReceivedAt)])
  if (o.projectedArrival) rows.push(['Projected', formatDay(o.projectedArrival)])
  rows.push(['Quantity', qty(o)])
  return { title: o.name ?? 'Purchase order', rows }
}

/** Past POs on one lane: ordered → last receipt (or expected), a dot when nothing was received. */
function ordersLane(data: SupplierHorizonData, withTicks: boolean): HorizonLane {
  const marks: HorizonMark[] = []
  for (const o of data.orders) {
    if (o.open) continue
    const tip = orderTip(o)
    const key = `po:${o.purchaseOrderId}`
    if (!o.lastReceivedAt) {
      marks.push({ key, kind: 'dot', t: dayToT(o.orderedAt), tip })
      continue
    }
    marks.push({
      key,
      kind: 'bar',
      tone: 'received',
      from: dayToT(o.orderedAt),
      to: dayToT(o.lastReceivedAt),
      tip,
    })
  }
  if (withTicks) marks.push(...cycleTicks(data))
  return {
    key: 'orders',
    label: 'Orders',
    kind: 'orders',
    record: null,
    wontMake: false,
    pulls: false,
    marks,
  }
}

/** Ticks every stated cycle, walking back from the latest order to `from` and forward to the rhythm date. */
export function cycleTicks(
  data: Pick<SupplierHorizonData, 'cycle' | 'orders' | 'from' | 'to'>
): HorizonMark[] {
  const { cycle } = data
  if (!cycle || cycle.statedDays <= 0) return []
  const latest = data.orders.reduce<string | null>(
    (max, o) => (max === null || o.orderedAt > max ? o.orderedAt : max),
    null
  )
  const anchor = latest ?? cycle.rhythmDate
  if (!anchor) return []
  const lo = dayToT(data.from)
  const hi = dayToT(data.to)
  const start = dayToT(anchor)
  const out: number[] = []
  for (let t = start; t >= lo; t -= cycle.statedDays) if (t <= hi) out.push(t)
  if (cycle.rhythmDate) {
    const end = Math.min(hi, dayToT(cycle.rhythmDate))
    for (let t = start + cycle.statedDays; t <= end; t += cycle.statedDays) out.push(t)
  }
  return out.sort((a, b) => a - b).map((t) => ({ key: `tick:${t}`, kind: 'tick', t }))
}

/** One open PO: ordered → expected, plus a hatched run to the projected arrival when overdue. */
function openPoLane(o: HorizonOrder): HorizonLane {
  const tip = orderTip(o)
  const key = `po:${o.purchaseOrderId}`
  const marks: HorizonMark[] = o.expectedAt
    ? [
        {
          key: `${key}:bar`,
          kind: 'bar',
          tone: 'open',
          from: dayToT(o.orderedAt),
          to: dayToT(o.expectedAt),
          tip,
        },
      ]
    : [{ key: `${key}:bar`, kind: 'dot', t: dayToT(o.orderedAt), tip }]
  if (o.expectedAt && o.projectedArrival) {
    marks.push({
      key: `${key}:overdue`,
      kind: 'overdue',
      from: dayToT(o.expectedAt),
      to: dayToT(o.projectedArrival),
      tip,
    })
  }
  return {
    key,
    label: o.name ?? 'Purchase order',
    kind: 'po',
    record: { definition: 'purchase_order', id: o.purchaseOrderId },
    wontMake: false,
    pulls: false,
    marks,
  }
}

function nextOrderLane(data: SupplierHorizonData): HorizonLane | null {
  const next = data.nextOrder
  if (!next) return null
  const rows: [string, string][] = [['Order', formatDay(next.orderDate)]]
  if (next.arrivalDate) rows.push(['Arrives', formatDay(next.arrivalDate)])
  if (data.cycle?.rhythmDate) rows.push(['Rhythm date', formatDay(data.cycle.rhythmDate)])
  if (next.pulledForwardBy.length > 0) {
    rows.push(['Pulled forward by', next.pulledForwardBy.join(', ')])
  }
  const tip = { title: 'Next order', rows }
  const marks: HorizonMark[] = next.arrivalDate
    ? [
        {
          key: 'next:bar',
          kind: 'next',
          from: dayToT(next.orderDate),
          to: dayToT(next.arrivalDate),
          tip,
        },
      ]
    : [{ key: 'next:bar', kind: 'dot', t: dayToT(next.orderDate), tip }]
  const rhythm = data.cycle?.rhythmDate
  if (rhythm && rhythm !== next.orderDate) {
    marks.push({
      key: 'next:rhythm',
      kind: 'rhythm',
      t: dayToT(rhythm),
      tip: { title: 'Rhythm date', rows: [['Cycle', `every ${data.cycle?.statedDays} d`]] },
    })
  }
  return {
    key: 'next',
    label: 'Next order',
    kind: 'next',
    record: null,
    wontMake: false,
    pulls: false,
    marks,
  }
}

function partLane(p: HorizonPart, today: number): HorizonLane {
  const rows: [string, string][] = []
  if (p.orderByDate) rows.push(['Order by', formatDay(p.orderByDate)])
  if (p.stockoutDate) rows.push(['Stockout', formatDay(p.stockoutDate)])
  if (p.suggestedQty !== null) rows.push(['Suggested', formatQty(p.suggestedQty)])
  if (p.pullsOrderForward) rows.push(['', 'Pulls the next order forward'])
  if (p.wontMakeNextArrival) rows.push(['', "Won't make the next arrival"])
  const label = p.name ?? p.sku ?? 'Part'
  const orderBy = p.orderByDate ? Math.max(today, dayToT(p.orderByDate)) : null
  const stockout = p.stockoutDate ? dayToT(p.stockoutDate) : null
  return {
    key: `part:${p.partId}`,
    label,
    kind: 'part',
    record: { definition: 'part', id: p.partId },
    wontMake: p.wontMakeNextArrival,
    pulls: p.pullsOrderForward,
    marks:
      orderBy === null && stockout === null
        ? []
        : [
            {
              key: `part:${p.partId}`,
              kind: 'dumbbell',
              from: orderBy,
              to: stockout,
              muted: p.wontMakeNextArrival,
              tip: { title: label, rows },
            },
          ],
  }
}

/** Parts by order-by date, nulls last; the read already sorts, this keeps the chart honest on its own. */
function sortParts(parts: readonly HorizonPart[]): HorizonPart[] {
  return [...parts].sort(
    (a, b) =>
      (a.orderByDate ?? '9999').localeCompare(b.orderByDate ?? '9999') ||
      a.partId.localeCompare(b.partId)
  )
}

/** The horizon's lanes top to bottom: Orders, open POs, Next order, parts, then "+N more" (16 §3.1). */
export function buildHorizonLanes(
  data: SupplierHorizonData,
  options: HorizonLanesOptions
): HorizonLane[] {
  const lanes: HorizonLane[] = []
  if (!options.mobile) lanes.push(ordersLane(data, !options.compact))
  for (const o of data.orders) if (o.open) lanes.push(openPoLane(o))
  const next = nextOrderLane(data)
  if (next) lanes.push(next)

  const cap = options.compact ? PART_LANE_CAP_COMPACT : PART_LANE_CAP
  const parts = sortParts(data.parts)
  const today = dayToT(options.today)
  for (const p of parts.slice(0, cap)) lanes.push(partLane(p, today))
  if (parts.length > cap) {
    lanes.push({
      key: 'more',
      label: `+${parts.length - cap} more`,
      kind: 'more',
      record: null,
      wontMake: false,
      pulls: false,
      marks: [],
    })
  }
  return lanes
}

/** `next`'s lanes with `prev`'s marks kept where lanes share a key, so the old window scrolls out. */
export function mergeLanes(
  prev: readonly HorizonLane[],
  next: readonly HorizonLane[]
): HorizonLane[] {
  const byKey = new Map(prev.map((l) => [l.key, l]))
  return next.map((lane) => {
    const old = byKey.get(lane.key)
    if (!old) return lane
    const marks = new Map(old.marks.map((m) => [m.key, m]))
    for (const m of lane.marks) marks.set(m.key, m)
    return { ...lane, marks: [...marks.values()] }
  })
}
