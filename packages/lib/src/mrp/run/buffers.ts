// packages/lib/src/mrp/run/buffers.ts

import {
  MRP_DEMAND_CV_BANDS,
  MRP_LEAD_TIME_CLASS_DAYS,
  MRP_LEAD_TIME_FACTORS,
  MRP_MIN_RECEIPTS,
  MRP_MIN_USAGE_DAYS_FOR_VF,
  MRP_SHARED_BY_REASON_PREFIX,
  MRP_SHARED_PARENTS_MIN,
  MRP_SUPPLY_BANDS,
  MRP_VARIABILITY_FACTORS,
  MRP_VARIABILITY_LEVELS,
  type MrpBufferMode,
  type MrpFactorSource,
  type MrpLeadTimeClass,
  type MrpSupplyType,
  type MrpVariabilityLevel,
} from '../client'
import type { MrpPartKind, SubpartRow } from '../types'
import type { SupplyHistoryStats } from './lead-time'

// ── Factors ──

/** Short under 10 days, long from 30 (`MRP_LEAD_TIME_CLASS_DAYS`). */
export function leadTimeClass(leadTimeDays: number): MrpLeadTimeClass {
  if (leadTimeDays >= MRP_LEAD_TIME_CLASS_DAYS.long) return 'long'
  if (leadTimeDays >= MRP_LEAD_TIME_CLASS_DAYS.medium) return 'medium'
  return 'short'
}

export interface ResolvedFactor {
  value: number
  source: MrpFactorSource
}

/** LTF: the part override, else the org default setting, else by the decoupled lead time's class. */
export function resolveLeadTimeFactor(params: {
  override: number | null
  orgDefault: number | null
  decoupledLeadTimeDays: number
}): ResolvedFactor {
  if (params.override !== null) return { value: params.override, source: 'override' }
  if (params.orgDefault !== null) return { value: params.orgDefault, source: 'default' }
  return {
    value: MRP_LEAD_TIME_FACTORS[leadTimeClass(params.decoupledLeadTimeDays)],
    source: 'default',
  }
}

/** Demand class by daily CV; medium with fewer than 30 observed days (D15). */
export function demandVariabilityLevel(
  cv: number | null,
  observedDays: number
): MrpVariabilityLevel {
  if (cv === null || observedDays < MRP_MIN_USAGE_DAYS_FOR_VF) return 'medium'
  if (cv <= MRP_DEMAND_CV_BANDS.low) return 'low'
  if (cv > MRP_DEMAND_CV_BANDS.high) return 'high'
  return 'medium'
}

/** Supply class from lead-time spread, on-time and fill; medium with fewer than 3 clean receipts (D15). */
export function supplyVariabilityLevel(
  stats: Pick<
    SupplyHistoryStats,
    'count' | 'medianLeadTimeDays' | 'p90LeadTimeDays' | 'onTimeRate' | 'avgFill'
  > | null
): MrpVariabilityLevel {
  if (!stats || stats.count < MRP_MIN_RECEIPTS || !stats.medianLeadTimeDays) return 'medium'
  const spread =
    ((stats.p90LeadTimeDays ?? stats.medianLeadTimeDays) - stats.medianLeadTimeDays) /
    stats.medianLeadTimeDays
  const onTime = stats.onTimeRate ?? 1
  const fill = stats.avgFill ?? 1
  const b = MRP_SUPPLY_BANDS
  if (spread > b.spreadHigh || onTime < b.onTimeHigh || fill < b.fillHigh) return 'high'
  if (spread <= b.spreadLow && onTime >= b.onTimeLow && fill >= b.fillLow) return 'low'
  return 'medium'
}

/** VF (D15): the override, else the org default, else the higher of demand and (bought only) supply class, snapped. */
export function resolveVariabilityFactor(params: {
  override: number | null
  orgDefault: number | null
  cv: number | null
  observedDays: number
  supplyType: MrpSupplyType
  supplyStats: SupplyHistoryStats | null
}): ResolvedFactor & { level: MrpVariabilityLevel | null } {
  if (params.override !== null) return { value: params.override, source: 'override', level: null }
  if (params.orgDefault !== null) {
    return { value: params.orgDefault, source: 'default', level: null }
  }
  const demand = demandVariabilityLevel(params.cv, params.observedDays)
  const supply = params.supplyType === 'bought' ? supplyVariabilityLevel(params.supplyStats) : 'low'
  const level =
    MRP_VARIABILITY_LEVELS.indexOf(demand) >= MRP_VARIABILITY_LEVELS.indexOf(supply)
      ? demand
      : supply
  return { value: MRP_VARIABILITY_FACTORS[level], source: 'default', level }
}

// ── The proposal (02 §8) ──

export interface ProposalPartInput {
  partId: string
  supplyType: MrpSupplyType
  kind: MrpPartKind | null
  bufferMode: MrpBufferMode | null
  adu: number | null
  /** Class of the part's own stated lead time, for the `long_lead` reason. */
  leadTimeClass: MrpLeadTimeClass | null
  /** Any sale in the window. */
  sold: boolean
  soldFromShelf: boolean
  batchBuilt: boolean
}

export interface BufferProposal {
  partId: string
  proposedBuffered: boolean
  /** Override wins: `buffered` / `not_buffered`, else the proposal. */
  buffered: boolean
  reasons: string[]
}

/** The override if set, else the proposal (D8). */
export function effectiveBuffered(bufferMode: MrpBufferMode | null, proposed: boolean): boolean {
  if (bufferMode === 'buffered') return true
  if (bufferMode === 'not_buffered') return false
  return proposed
}

/** Part ids ordered parents before children (low-level code order); cycle members land last. */
export function topDownOrder(partIds: readonly string[], edges: readonly SubpartRow[]): string[] {
  const ids = new Set(partIds)
  const inDegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const id of ids) inDegree.set(id, 0)
  for (const e of edges) {
    if (!ids.has(e.parentPartId) || !ids.has(e.childPartId)) continue
    children.set(e.parentPartId, [...(children.get(e.parentPartId) ?? []), e.childPartId])
    inDegree.set(e.childPartId, (inDegree.get(e.childPartId) ?? 0) + 1)
  }
  const queue = [...ids].filter((id) => inDegree.get(id) === 0)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const child of children.get(id) ?? []) {
      const left = (inDegree.get(child) ?? 0) - 1
      inDegree.set(child, left)
      if (left === 0) queue.push(child)
    }
  }
  const placed = new Set(order)
  return [...order, ...[...ids].filter((id) => !placed.has(id))]
}

function proposeOne(
  part: ProposalPartInput,
  qualifyingParents: number
): { proposed: boolean; reasons: string[] } {
  if (!part.adu || part.adu <= 0) return { proposed: false, reasons: ['no_usage'] }
  if (part.supplyType === 'unclassified') return { proposed: false, reasons: ['unclassified'] }
  if (part.supplyType === 'bought') {
    const reasons = ['bought_consumed']
    if (part.leadTimeClass === 'long') reasons.push('long_lead')
    return { proposed: true, reasons }
  }
  if (part.kind === 'finished_good') {
    return part.soldFromShelf
      ? { proposed: true, reasons: ['sold_from_shelf'] }
      : { proposed: false, reasons: ['assemble_to_order'] }
  }
  const reasons: string[] = []
  if (qualifyingParents >= MRP_SHARED_PARENTS_MIN) {
    reasons.push(`${MRP_SHARED_BY_REASON_PREFIX}${qualifyingParents}`)
  }
  if (part.batchBuilt) reasons.push('batch_built')
  if (part.sold && part.soldFromShelf) reasons.push('sold_from_shelf')
  return { proposed: reasons.length > 0, reasons }
}

/** Proposals for every part, parents first so "shared by buffered-or-sold parents" sees their effective state. */
export function proposeBuffers(
  parts: readonly ProposalPartInput[],
  edges: readonly SubpartRow[]
): Map<string, BufferProposal> {
  const byId = new Map(parts.map((p) => [p.partId, p]))
  const parentsOf = new Map<string, Set<string>>()
  for (const e of edges) {
    const set = parentsOf.get(e.childPartId) ?? new Set<string>()
    set.add(e.parentPartId)
    parentsOf.set(e.childPartId, set)
  }
  const result = new Map<string, BufferProposal>()
  for (const id of topDownOrder([...byId.keys()], edges)) {
    const part = byId.get(id)
    if (!part) continue
    let qualifying = 0
    for (const parentId of parentsOf.get(id) ?? []) {
      if (result.get(parentId)?.buffered || byId.get(parentId)?.sold) qualifying++
    }
    const { proposed, reasons } = proposeOne(part, qualifying)
    result.set(id, {
      partId: id,
      proposedBuffered: proposed,
      buffered: effectiveBuffered(part.bufferMode, proposed),
      reasons,
    })
  }
  return result
}

// ── Decoupled lead time and zones ──

/** Own lead time + the longest unbuffered path below (02 §7 step 5); null when the part has no stated lead time. */
export function computeDecoupledLeadTimes(params: {
  partIds: readonly string[]
  edges: readonly SubpartRow[]
  leadTimeDays: ReadonlyMap<string, number | null>
  buffered: ReadonlyMap<string, boolean>
}): Map<string, number | null> {
  const children = new Map<string, string[]>()
  for (const e of params.edges) {
    children.set(e.parentPartId, [...(children.get(e.parentPartId) ?? []), e.childPartId])
  }
  const memo = new Map<string, number>()
  const visiting = new Set<string>()
  // A child without a stated lead time contributes 0 here; it carries its own `no_lead_time` flag.
  const path = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    let below = 0
    for (const child of children.get(id) ?? []) {
      if (!params.buffered.get(child)) below = Math.max(below, path(child))
    }
    visiting.delete(id)
    const total = (params.leadTimeDays.get(id) ?? 0) + below
    memo.set(id, total)
    return total
  }
  const result = new Map<string, number | null>()
  for (const id of params.partIds) {
    result.set(id, params.leadTimeDays.get(id) == null ? null : path(id))
  }
  return result
}

export interface BufferZones {
  redBase: number
  redSafety: number
  topOfRed: number
  topOfYellow: number
  topOfGreen: number
}

/** The three zones (primer §4.3, 02 §4.1); `leadTimeUsage` is the seasonal projection over the DLT, default ADU × DLT. */
export function computeZones(params: {
  adu: number
  decoupledLeadTimeDays: number
  leadTimeFactor: number
  variabilityFactor: number
  minOrderQty: number | null
  orderCycleDays: number | null
  leadTimeUsage?: number
}): BufferZones {
  const redBase = params.adu * params.decoupledLeadTimeDays * params.leadTimeFactor
  const redSafety = redBase * params.variabilityFactor
  const topOfRed = redBase + redSafety
  const yellow = params.leadTimeUsage ?? params.adu * params.decoupledLeadTimeDays
  const green = Math.max(
    params.minOrderQty ?? 0,
    params.orderCycleDays ? params.adu * params.orderCycleDays : 0,
    redBase
  )
  return {
    redBase,
    redSafety,
    topOfRed,
    topOfYellow: topOfRed + yellow,
    topOfGreen: topOfRed + yellow + green,
  }
}
