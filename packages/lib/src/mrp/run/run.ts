// packages/lib/src/mrp/run/run.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { addDaysToDayKey, type DayKey } from '@auxx/utils/calendar-day'
import { err, ok, type Result } from 'neverthrow'
import {
  readBookTimeZoneOrUtc,
  todayInBookTimeZone,
} from '../../accounting/ledger/setup/book-time-zone'
import { readOrganizationSettings } from '../../settings/read'
import type {
  DailyActivity,
  DailySeriesPoint,
  MonthlyBucket,
  OpenBuildInput,
  OpenPoLineInput,
  PartInput,
  PlanItem,
  ReceiptObservation,
  RunSettings,
  SeasonalIndex,
  VendorPartInput,
  WhereUsedShare,
} from '../types'
import {
  computeDecoupledLeadTimes,
  computeZones,
  leadTimeClass,
  type ProposalPartInput,
  proposeBuffers,
  resolveLeadTimeFactor,
  resolveVariabilityFactor,
} from './buffers'
import { computeFlags, isUnbuiltSeller, unbuiltSalesPartIds } from './flags'
import {
  classifySupply,
  hasLeadTimeDrift,
  pickPreferredVendorPart,
  resolveStatedLeadTime,
  type SupplyHistoryStats,
  summarizeSupplyHistory,
} from './lead-time'
import { loadRunInputs, type RunInputs } from './load-inputs'
import { computePosition, computePriority, suggestWhenNeeded } from './net-flow'
import { recomputeNextOrder, type ScheduledPartInput } from './scheduled'
import {
  computeBaseAdu,
  computeSeasonalIndex,
  projectUsage,
  resolveSeasonalIndexes,
} from './seasonality'
import { computeStockout, type ProjectionInput, projectedReceiptsForPart } from './stockout'
import { computeShelfSignals, computeUsage } from './usage'
import { completeRun, failRun, type MrpRunTrigger, startRun } from './write-run'

const logger = createScopedLogger('mrp')

const SETTING_KEYS = [
  'mrp.aduWindowDays',
  'mrp.defaultLeadTimeFactor',
  'mrp.defaultVariabilityFactor',
] as const

const DEFAULT_ADU_WINDOW_DAYS = 90

/** Plan one org and store the run: the 02 §7 steps over `loadRunInputs`, written through `write-run.ts`. */
export async function runMrpPlan(
  db: Database,
  organizationId: string,
  input: { asOf?: DayKey; trigger: MrpRunTrigger }
): Promise<Result<{ runId: string; itemCount: number; durationMs: number }, Error>> {
  const startedAt = Date.now()
  const [asOf, zone, rawSettings] = await Promise.all([
    input.asOf ?? todayInBookTimeZone(organizationId),
    readBookTimeZoneOrUtc(organizationId).then(validZone),
    readOrganizationSettings(organizationId, SETTING_KEYS),
  ])
  const settings: RunSettings = {
    aduWindowDays: positiveOr(rawSettings['mrp.aduWindowDays'], DEFAULT_ADU_WINDOW_DAYS),
    defaultLeadTimeFactor: numberOrNull(rawSettings['mrp.defaultLeadTimeFactor']),
    defaultVariabilityFactor: numberOrNull(rawSettings['mrp.defaultVariabilityFactor']),
  }

  const started = await startRun(db, organizationId, {
    asOf,
    params: { ...settings, zone, seasonalHistoryMonths: 24 },
    trigger: input.trigger,
  })
  if (started.isErr()) return err(started.error)
  const runId = started.value
  const log = logger.with({ organizationId, runId, asOf, trigger: input.trigger })

  try {
    const inputs = await loadRunInputs(db, organizationId, { asOf, zone, settings })
    if (inputs.isErr()) throw inputs.error
    const items = planItems(inputs.value, settings)
    const written = await completeRun(db, runId, items)
    if (written.isErr()) throw written.error
    const durationMs = Date.now() - startedAt
    log.info('MRP run completed', { itemCount: written.value.itemCount, durationMs })
    return ok({ runId, itemCount: written.value.itemCount, durationMs })
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    log.error('MRP run failed', { error: failure.message })
    const marked = await failRun(db, runId, failure)
    if (marked.isErr())
      log.error('Could not mark the MRP run failed', { error: marked.error.message })
    return err(failure)
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positiveOr(value: unknown, fallback: number): number {
  const n = numberOrNull(value)
  return n !== null && n > 0 ? n : fallback
}

/** The stored zone when Postgres and Intl will accept it, else UTC. */
function validZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return 'UTC'
  }
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}

/** Per-part facts the later steps share. */
interface PartState {
  part: PartInput
  supplyType: PlanItem['supplyType']
  vendorPart: VendorPartInput | null
  leadTimeDays: number | null
  leadTimeSource: PlanItem['leadTimeSource']
  usage: ReturnType<typeof computeUsage>
  seasonalIndex: SeasonalIndex | null
  baseAdu: number
  stats: SupplyHistoryStats | null
  sold: number
  produced: number
  opening: number
  poLines: OpenPoLineInput[]
  builds: OpenBuildInput[]
}

/** Every part's `PlanItem` from the loaded inputs; pure, the 02 §7 steps in order. */
export function planItems(inputs: RunInputs, settings: RunSettings): PlanItem[] {
  const { asOf, window, edges } = inputs
  const partIds = inputs.parts.map((p) => p.id)
  const series = groupBy<DailySeriesPoint>(inputs.series, (r) => r.partId)
  const activity = groupBy<DailyActivity>(inputs.activity, (r) => r.partId)
  const monthly = groupBy<MonthlyBucket>(inputs.monthly, (r) => r.partId)
  const vendorParts = groupBy<VendorPartInput>(inputs.vendorParts, (r) => r.partId)
  const poLines = groupBy<OpenPoLineInput>(inputs.poLines, (r) => r.partId)
  const builds = groupBy<OpenBuildInput>(inputs.builds, (r) => r.partId)
  const history = groupBy<ReceiptObservation>(inputs.receipts, (r) => r.partId)
  const suppliers = new Map(inputs.suppliers.map((s) => [s.id, s]))

  // Steps 1–3: classify, usage, seasonality.
  const own = new Map<string, SeasonalIndex | null>()
  const shares: WhereUsedShare[] = [...inputs.whereUsed]
  const states = new Map<string, PartState>()
  for (const part of inputs.parts) {
    const { supplyType } = classifySupply(part)
    const vendorPart =
      supplyType === 'bought' ? pickPreferredVendorPart(vendorParts.get(part.id) ?? []) : null
    const stated = resolveStatedLeadTime(part, supplyType, vendorPart)
    const points = series.get(part.id) ?? []
    const allActivity = activity.get(part.id) ?? []
    const windowActivity = allActivity.filter((a) => a.day >= window.from)
    const sold = windowActivity.reduce((sum, a) => sum + a.saleQty, 0)
    const produced = windowActivity.reduce((sum, a) => sum + a.produceQty, 0)
    const first = points[0]
    const everSold = allActivity.some((a) => a.saleQty > 0)
    own.set(
      part.id,
      computeSeasonalIndex(monthly.get(part.id) ?? [], everSold ? 'sold' : 'consumed').index
    )
    // A part sold directly counts as its own parent (02 §6.5 step 3).
    if (sold > 0) shares.push({ partId: part.id, parentId: part.id, quantity: sold })

    let stats: SupplyHistoryStats | null = null
    if (supplyType === 'bought') {
      const lines = history.get(part.id) ?? []
      stats = summarizeSupplyHistory(
        vendorPart ? lines.filter((l) => l.vendorPartId === vendorPart.id) : lines
      )
    }
    states.set(part.id, {
      part,
      supplyType,
      vendorPart,
      leadTimeDays: stated.leadTimeDays,
      leadTimeSource: stated.source,
      usage: computeUsage(points),
      seasonalIndex: null,
      baseAdu: 0,
      stats,
      sold,
      produced,
      opening: first ? first.onHandEod - first.net : 0,
      poLines: poLines.get(part.id) ?? [],
      builds: builds.get(part.id) ?? [],
    })
  }
  const indexes = resolveSeasonalIndexes(own, shares)
  for (const state of states.values()) {
    state.seasonalIndex = indexes.get(state.part.id) ?? null
    const adu = state.usage.adu
    state.baseAdu = adu ? computeBaseAdu(adu, state.seasonalIndex, window.from, asOf) : 0
  }

  // Step 4: buffer proposal, overrides applied.
  const proposalInputs: ProposalPartInput[] = []
  for (const s of states.values()) {
    const shelf = computeShelfSignals(
      (activity.get(s.part.id) ?? []).filter((a) => a.day >= window.from)
    )
    proposalInputs.push({
      partId: s.part.id,
      supplyType: s.supplyType,
      kind: s.part.kind,
      bufferMode: s.part.bufferMode,
      adu: s.usage.adu,
      leadTimeClass: s.leadTimeDays !== null ? leadTimeClass(s.leadTimeDays) : null,
      sold: s.sold > 0,
      soldFromShelf: shelf.soldFromShelf,
      batchBuilt: shelf.batchBuilt,
    })
  }
  const proposals = proposeBuffers(proposalInputs, edges)
  const bufferedMap = new Map(partIds.map((id) => [id, proposals.get(id)?.buffered ?? false]))

  // Step 5: decoupled lead time.
  const dlts = computeDecoupledLeadTimes({
    partIds,
    edges,
    leadTimeDays: new Map(partIds.map((id) => [id, states.get(id)?.leadTimeDays ?? null])),
    buffered: bufferedMap,
  })

  // unbuilt_sales: made finished goods selling past what was built, and everything below them.
  const unbuiltSellers = [...states.values()]
    .filter(
      (s) =>
        s.part.kind === 'finished_good' &&
        s.supplyType === 'made' &&
        isUnbuiltSeller({ sold: s.sold, produced: s.produced, opening: s.opening })
    )
    .map((s) => s.part.id)
  const unbuilt = unbuiltSalesPartIds(unbuiltSellers, edges)

  // Steps 6, 7, 9: zones, position, when-needed suggestion, stockout and order-by.
  const items = new Map<string, PlanItem>()
  const scheduledBySupplier = new Map<string, ScheduledPartInput[]>()
  for (const s of states.values()) {
    const { part, vendorPart, usage } = s
    const proposal = proposals.get(part.id)
    const buffered = proposal?.buffered ?? false
    const dlt = dlts.get(part.id) ?? null
    const supplier = vendorPart?.supplierId ? suppliers.get(vendorPart.supplierId) : undefined
    const scheduled = s.supplyType === 'bought' && supplier?.orderMode === 'scheduled'
    const orderCycleDays = scheduled
      ? (supplier?.orderCycleDays ?? null)
      : s.supplyType === 'made'
        ? part.buildCycleDays
        : null

    const ltf =
      dlt !== null
        ? resolveLeadTimeFactor({
            override: part.leadTimeFactorOverride,
            orgDefault: settings.defaultLeadTimeFactor,
            decoupledLeadTimeDays: dlt,
          })
        : null
    const vf = resolveVariabilityFactor({
      override: part.variabilityFactorOverride,
      orgDefault: settings.defaultVariabilityFactor,
      cv: usage.cv,
      observedDays: usage.observedDays,
      supplyType: s.supplyType,
      supplyStats: s.stats,
    })
    const zones =
      buffered && usage.adu && usage.adu > 0 && dlt !== null && ltf
        ? computeZones({
            adu: usage.adu,
            decoupledLeadTimeDays: dlt,
            leadTimeFactor: ltf.value,
            variabilityFactor: vf.value,
            minOrderQty: vendorPart?.minOrderQty ?? null,
            orderCycleDays,
            leadTimeUsage: s.seasonalIndex
              ? projectUsage(
                  s.baseAdu,
                  s.seasonalIndex,
                  asOf,
                  addDaysToDayKey(asOf, Math.ceil(dlt))
                )
              : undefined,
          })
        : null

    const openDemand = inputs.openDemand.get(part.id) ?? 0
    const position = computePosition({
      onHand: part.quantityOnHand,
      poLines: s.poLines,
      builds: s.builds,
      openDemand,
    })
    const projection: ProjectionInput = {
      fromDay: asOf,
      onHand: position.onHand - position.openDemand,
      receipts: projectedReceiptsForPart({
        asOf,
        poLines: s.poLines,
        builds: s.builds,
        leadTimeDays: s.leadTimeDays,
        buildLeadTimeDays: part.buildLeadTimeDays,
        medianLatenessDays: s.stats?.medianLatenessDays ?? null,
      }),
      baseAdu: s.baseAdu,
      seasonalIndex: s.seasonalIndex,
    }
    const cushion = zones?.topOfRed ?? 0
    const stock = computeStockout(projection, cushion, dlt)

    const suggestion = scheduled
      ? null
      : suggestWhenNeeded({
          buffered,
          supplyType: s.supplyType,
          netFlow: position.netFlow,
          topOfYellow: zones?.topOfYellow ?? null,
          topOfGreen: zones?.topOfGreen ?? null,
          minOrderQty: vendorPart?.minOrderQty ?? null,
          purchaseRatio: vendorPart?.purchaseRatio ?? null,
        })
    const purchase = suggestion?.kind === 'purchase'

    if (scheduled && supplier) {
      const list = scheduledBySupplier.get(supplier.id) ?? []
      list.push({
        partId: part.id,
        vendorPartId: vendorPart?.id ?? null,
        leadTimeDays: s.leadTimeDays,
        cushion,
        projection,
        minOrderQty: vendorPart?.minOrderQty ?? null,
        purchaseRatio: vendorPart?.purchaseRatio ?? null,
      })
      scheduledBySupplier.set(supplier.id, list)
    }

    items.set(part.id, {
      partId: part.id,
      supplyType: s.supplyType,
      buffered,
      proposedBuffered: proposal?.proposedBuffered ?? false,
      proposalReasons: proposal?.reasons ?? [],
      adu: usage.adu,
      sigma: usage.sigma,
      cv: usage.cv,
      stockoutDaysExcluded: usage.stockoutDaysExcluded,
      onHand: position.onHand,
      onOrder: position.onOrder,
      openDemand: position.openDemand,
      netFlow: position.netFlow,
      leadTimeDays: s.leadTimeDays,
      leadTimeSource: s.leadTimeSource,
      decoupledLeadTimeDays: dlt,
      observedLeadTimeDays: s.stats?.medianLeadTimeDays ?? null,
      observedReceipts: s.stats ? s.stats.count : null,
      leadTimeFactor: ltf?.value ?? null,
      leadTimeFactorSource: ltf?.source ?? null,
      variabilityFactor: vf.value,
      variabilityFactorSource: vf.source,
      orderCycleDays,
      orderMode: scheduled ? 'scheduled' : 'when_needed',
      nextOrderDate: null,
      nextArrivalDate: null,
      followingArrivalDate: null,
      pullsOrderForward: null,
      seasonalIndex: s.seasonalIndex,
      baseAdu: usage.adu === null ? null : s.baseAdu,
      topOfRed: zones?.topOfRed ?? null,
      topOfYellow: zones?.topOfYellow ?? null,
      topOfGreen: zones?.topOfGreen ?? null,
      stockoutDate: stock.stockoutDate,
      orderByDate: stock.orderByDate,
      priority: null,
      suggestionKind: suggestion?.kind ?? null,
      suggestedQty: suggestion ? suggestion.quantity : null,
      suggestedPurchaseUnits: suggestion ? suggestion.purchaseUnits : null,
      suggestedVendorPartId: purchase ? (vendorPart?.id ?? null) : null,
      suggestedSupplierId: purchase ? (vendorPart?.supplierId ?? null) : null,
      flags: [],
      isOverdue: false,
    })
  }

  // Step 8: scheduled suppliers, every part ticked (the run stores the default).
  const wontMake = new Set<string>()
  for (const [supplierId, parts] of scheduledBySupplier) {
    const supplier = suppliers.get(supplierId)
    if (!supplier) continue
    const plan = recomputeNextOrder({ asOf, supplier, parts })
    for (const p of plan.parts) {
      const item = items.get(p.partId)
      if (!item) continue
      if (p.wontMakeNextArrival) wontMake.add(p.partId)
      item.nextOrderDate = plan.nextOrderDate
      item.nextArrivalDate = p.nextArrivalDate
      item.followingArrivalDate = p.followingArrivalDate
      item.pullsOrderForward = p.pullsOrderForward
      // Set even at quantity 0: the supplier card groups a scheduled supplier's parts by these.
      item.suggestedVendorPartId = p.vendorPartId
      item.suggestedSupplierId = supplierId
      if (p.quantity !== null && p.quantity > 0) {
        item.suggestionKind = 'purchase'
        item.suggestedQty = p.quantity
        item.suggestedPurchaseUnits = p.purchaseUnits
        item.orderByDate = plan.nextOrderDate
      }
    }
  }

  // Step 10: priority, overdue and flags.
  for (const item of items.values()) {
    const s = states.get(item.partId)
    if (!s) continue
    item.priority = computePriority({
      buffered: item.buffered,
      netFlow: item.netFlow,
      topOfGreen: item.topOfGreen,
      orderByDate: item.orderByDate,
      asOf,
    })
    item.isOverdue = item.orderByDate !== null && item.orderByDate < asOf
    item.flags = computeFlags({
      asOf,
      supplyType: item.supplyType,
      leadTimeSource: item.leadTimeSource,
      bufferMode: s.part.bufferMode,
      // TODO(mrp): count relief-skipped fulfillment lines per part (01 §3 P1); no cheap read yet.
      reliefGapLines: 0,
      unbuiltSales: unbuilt.has(item.partId),
      negativeOnHand: s.usage.negativeDays > 0 || item.onHand < 0,
      thinUsage: s.usage.censorCapped,
      leadTimeDrift: s.stats !== null && hasLeadTimeDrift(item.leadTimeDays, s.stats),
      mirrorDrift: inputs.driftedPartIds.has(item.partId),
      wontMakeNextArrival: wontMake.has(item.partId),
      poLines: s.poLines,
    })
  }

  return partIds.flatMap((id) => {
    const item = items.get(id)
    return item ? [item] : []
  })
}
