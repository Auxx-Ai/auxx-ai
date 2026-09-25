// packages/lib/src/mrp/reads/supplier-next-order.ts

import { type Database, schema } from '@auxx/database'
import { addDaysToDayKey, type DayKey } from '@auxx/utils/calendar-day'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import type { MrpOrderMode } from '../client'
import {
  type BridgeQuantity,
  bridgeQuantity,
  recomputeNextOrder,
  rhythmDate,
  type ScheduledPartInput,
  type ScheduledSupplierInput,
  type ScheduledSupplierPlan,
} from '../run/scheduled'
import { projectedReceiptsForPart } from '../run/stockout'
import type { OpenPoLineInput, SupplierInput } from '../types'
import { guard } from './guard'
import { readPartLabels, readRecordNames, readVendorParts, type VendorPartRow } from './labels'
import { readOpenIssuedPoLines, readSupplierInputs, type SupplierRow } from './purchase-orders'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'

const I = schema.MrpPlanRunItem

export interface SupplierCardPart {
  partId: string
  name: string | null
  sku: string | null
  vendorPartId: string | null
  orderByDate: DayKey | null
  stockoutDate: DayKey | null
  pullsOrderForward: boolean
  wontMakeNextArrival: boolean
  suggestedQty: number | null
  suggestedPurchaseUnits: number | null
  nextArrivalDate: DayKey | null
  followingArrivalDate: DayKey | null
  priority: number | null
}

/** One supplier block on the Suppliers page (07 §4.2), as the run stored it. */
export interface SupplierCard {
  supplierId: string
  name: string | null
  orderMode: MrpOrderMode
  orderCycleDays: number | null
  /** The supplier's calendar date without any pull-forward; scheduled only. */
  rhythmDate: DayKey | null
  /** Scheduled: the run's next order date. When needed: the earliest order-by. */
  nextOrderDate: DayKey | null
  nextArrivalDate: DayKey | null
  pulledForwardBy: string[]
  parts: SupplierCardPart[]
}

export interface SupplierNextOrders {
  run: MrpRunRef | null
  suppliers: SupplierCard[]
}

export interface BridgeOption extends BridgeQuantity {
  partId: string
  vendorPartId: string
  supplierId: string | null
  supplierName: string | null
  leadTimeDays: number
}

export interface LiveNextOrder {
  run: MrpRunRef
  supplier: { id: string; name: string | null }
  plan: ScheduledSupplierPlan
  /** For each unticked part, what each of its other vendor parts would need to bridge to the container (02 §6.4). */
  bridges: BridgeOption[]
}

const minDay = (days: readonly (DayKey | null)[]): DayKey | null =>
  days.reduce<DayKey | null>((min, d) => (d !== null && (min === null || d < min) ? d : min), null)

/** Group a run's scheduled items and when-needed purchase suggestions by supplier, earliest order first. */
export function groupSupplierCards(params: {
  items: readonly MrpPlanItemRow[]
  suppliers: ReadonlyMap<string, SupplierRow>
  labels: ReadonlyMap<string, { name: string | null; sku: string | null }>
  names: ReadonlyMap<string, string | null>
}): SupplierCard[] {
  const bySupplier = new Map<string, MrpPlanItemRow[]>()
  for (const item of params.items) {
    if (!item.suggestedSupplierId) continue
    if (item.orderMode !== 'scheduled' && item.suggestionKind !== 'purchase') continue
    const list = bySupplier.get(item.suggestedSupplierId) ?? []
    list.push(item)
    bySupplier.set(item.suggestedSupplierId, list)
  }
  const cards = [...bySupplier.entries()].map(([supplierId, items]): SupplierCard => {
    const supplier = params.suppliers.get(supplierId)
    const scheduled = items.some((i) => i.orderMode === 'scheduled')
    const parts = items
      .map((i): SupplierCardPart => {
        const label = params.labels.get(i.partId)
        return {
          partId: i.partId,
          name: label?.name ?? null,
          sku: label?.sku ?? null,
          vendorPartId: i.suggestedVendorPartId,
          orderByDate: i.orderByDate,
          stockoutDate: i.stockoutDate,
          pullsOrderForward: i.pullsOrderForward ?? false,
          wontMakeNextArrival: i.flags.includes('wont_make_next_arrival'),
          suggestedQty: i.suggestedQty,
          suggestedPurchaseUnits: i.suggestedPurchaseUnits,
          nextArrivalDate: i.nextArrivalDate,
          followingArrivalDate: i.followingArrivalDate,
          priority: i.priority,
        }
      })
      .sort(
        (a, b) =>
          Number(b.wontMakeNextArrival) - Number(a.wontMakeNextArrival) ||
          (a.orderByDate ?? '9999').localeCompare(b.orderByDate ?? '9999') ||
          a.partId.localeCompare(b.partId)
      )
    return {
      supplierId,
      name: supplier?.name ?? params.names.get(supplierId) ?? null,
      orderMode: scheduled ? 'scheduled' : 'when_needed',
      orderCycleDays: supplier?.orderCycleDays ?? items[0]?.orderCycleDays ?? null,
      rhythmDate: scheduled && supplier ? rhythmDate(supplier) : null,
      nextOrderDate: scheduled
        ? minDay(items.map((i) => i.nextOrderDate))
        : minDay(items.map((i) => i.orderByDate)),
      nextArrivalDate: minDay(items.map((i) => i.nextArrivalDate)),
      pulledForwardBy: parts.filter((p) => p.pullsOrderForward).map((p) => p.partId),
      parts,
    }
  })
  return cards.sort(
    (a, b) =>
      (a.nextOrderDate ?? '9999').localeCompare(b.nextOrderDate ?? '9999') ||
      a.supplierId.localeCompare(b.supplierId)
  )
}

/** The projection one stored item starts from: the run's position, today's open issued PO lines. */
function projectionFor(asOf: DayKey, item: MrpPlanItemRow, poLines: readonly OpenPoLineInput[]) {
  return {
    fromDay: asOf,
    onHand: item.onHand - item.openDemand,
    receipts: projectedReceiptsForPart({
      asOf,
      poLines: poLines.filter((l) => l.partId === item.partId),
      builds: [],
      leadTimeDays: item.leadTimeDays,
      buildLeadTimeDays: null,
      medianLatenessDays: null,
    }),
    baseAdu: item.baseAdu ?? item.adu ?? 0,
    seasonalIndex: item.seasonalIndex,
  }
}

const cushionOf = (item: MrpPlanItemRow) => (item.buffered ? (item.topOfRed ?? 0) : 0)

/** The pure scheduled input rebuilt from a run's stored items plus current open PO lines. */
export function buildScheduledSupplierInput(params: {
  asOf: DayKey
  supplier: SupplierInput
  items: readonly MrpPlanItemRow[]
  poLines: readonly OpenPoLineInput[]
  vendorParts: ReadonlyMap<string, Pick<VendorPartRow, 'minOrderQty' | 'purchaseRatio'>>
}): ScheduledSupplierInput {
  const parts = params.items.map((item): ScheduledPartInput => {
    const vp = item.suggestedVendorPartId
      ? params.vendorParts.get(item.suggestedVendorPartId)
      : null
    return {
      partId: item.partId,
      vendorPartId: item.suggestedVendorPartId,
      leadTimeDays: item.leadTimeDays,
      cushion: cushionOf(item),
      projection: projectionFor(params.asOf, item, params.poLines),
      minOrderQty: vp?.minOrderQty ?? null,
      purchaseRatio: vp?.purchaseRatio ?? null,
    }
  })
  return { asOf: params.asOf, supplier: params.supplier, parts }
}

/** Bridge quantities for each excluded part from each of its other vendor parts. */
export function bridgeOptions(params: {
  asOf: DayKey
  plan: ScheduledSupplierPlan
  items: readonly MrpPlanItemRow[]
  poLines: readonly OpenPoLineInput[]
  alternatives: readonly VendorPartRow[]
  supplierNames: ReadonlyMap<string, string | null>
}): BridgeOption[] {
  const out: BridgeOption[] = []
  const next = params.plan.nextOrderDate
  if (!next) return out
  for (const planned of params.plan.parts) {
    if (!planned.excluded) continue
    const item = params.items.find((i) => i.partId === planned.partId)
    if (!item || item.leadTimeDays === null) continue
    const containerArrivalDate = addDaysToDayKey(next, Math.ceil(item.leadTimeDays))
    for (const vp of params.alternatives) {
      if (vp.partId !== item.partId || vp.supplierId === params.plan.supplierId) continue
      if (vp.leadTimeDays === null) continue
      out.push({
        partId: item.partId,
        vendorPartId: vp.id,
        supplierId: vp.supplierId,
        supplierName: vp.supplierId ? (params.supplierNames.get(vp.supplierId) ?? null) : null,
        leadTimeDays: vp.leadTimeDays,
        ...bridgeQuantity({
          asOf: params.asOf,
          bridgeLeadTimeDays: vp.leadTimeDays,
          containerArrivalDate,
          cushion: cushionOf(item),
          projection: projectionFor(params.asOf, item, params.poLines),
          minOrderQty: vp.minOrderQty,
          purchaseRatio: vp.purchaseRatio,
        }),
      })
    }
  }
  return out
}

async function readSupplierItems(
  db: Database,
  organizationId: string,
  runId: string,
  supplierId?: string
): Promise<MrpPlanItemRow[]> {
  return db
    .select()
    .from(I)
    .where(
      and(
        eq(I.organizationId, organizationId),
        eq(I.mrpPlanRunId, runId),
        supplierId ? eq(I.suggestedSupplierId, supplierId) : isNotNull(I.suggestedSupplierId),
        or(eq(I.orderMode, 'scheduled'), eq(I.suggestionKind, 'purchase'))
      )
    )
}

/** The supplier cards from the run: scheduled suppliers with per-part quantities and pull-forward, when-needed ones with their suggestions. */
export async function readSupplierNextOrders(
  db: Database,
  organizationId: string,
  input: { runId?: string | null; supplierId?: string } = {}
): Promise<Result<SupplierNextOrders, Error>> {
  return guard(
    async () => {
      const run = await loadRun(db, organizationId, input.runId)
      if (!run) return { run: null, suppliers: [] }
      const items = await readSupplierItems(db, organizationId, run.id, input.supplierId)
      const supplierIds = [...new Set(items.flatMap((i) => i.suggestedSupplierId ?? []))]
      const [suppliers, labels] = await Promise.all([
        readSupplierInputs(db, organizationId, supplierIds),
        readPartLabels(
          db,
          organizationId,
          items.map((i) => i.partId)
        ),
      ])
      const names = await readRecordNames(
        db,
        organizationId,
        'company',
        supplierIds.filter((id) => !suppliers.has(id))
      )
      return { run, suppliers: groupSupplierCards({ items, suppliers, labels, names }) }
    },
    'Failed to read supplier next orders',
    { organizationId, runId: input.runId }
  )
}

/** The scheduled supplier's order date and quantities for the current ticks (02 §6.4); unticks are never saved. */
export async function recomputeNextOrderLive(
  db: Database,
  organizationId: string,
  input: { supplierId: string; excludedPartIds: readonly string[]; runId?: string | null }
): Promise<Result<LiveNextOrder, Error>> {
  return guard(
    async () => {
      const run = await loadRun(db, organizationId, input.runId)
      if (!run) throw new NotFoundError('No completed plan run')
      const items = (await readSupplierItems(db, organizationId, run.id, input.supplierId)).filter(
        (i) => i.orderMode === 'scheduled'
      )
      const suppliers = await readSupplierInputs(db, organizationId, [input.supplierId])
      const supplier = suppliers.get(input.supplierId)
      if (!supplier) throw new NotFoundError('Supplier not found')

      const partIds = items.map((i) => i.partId)
      const excluded = input.excludedPartIds.filter((id) => partIds.includes(id))
      const [poLines, vendorParts, alternatives] = await Promise.all([
        readOpenIssuedPoLines(db, organizationId, partIds),
        readVendorParts(db, organizationId, {
          ids: items.flatMap((i) => i.suggestedVendorPartId ?? []),
        }),
        excluded.length > 0
          ? readVendorParts(db, organizationId, { partIds: excluded })
          : Promise.resolve([]),
      ])
      const plan = recomputeNextOrder(
        buildScheduledSupplierInput({
          asOf: run.asOfDay,
          supplier,
          items,
          poLines,
          vendorParts: new Map(vendorParts.map((vp) => [vp.id, vp])),
        }),
        excluded
      )
      const supplierNames = await readRecordNames(
        db,
        organizationId,
        'company',
        alternatives.flatMap((vp) => vp.supplierId ?? [])
      )
      return {
        run,
        supplier: { id: supplier.id, name: supplier.name },
        plan,
        bridges: bridgeOptions({
          asOf: run.asOfDay,
          plan,
          items,
          poLines,
          alternatives,
          supplierNames,
        }),
      }
    },
    'Failed to recompute the next order',
    { organizationId, supplierId: input.supplierId }
  )
}
