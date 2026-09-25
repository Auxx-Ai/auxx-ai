// packages/lib/src/inventory/builds/backflush-planner.ts

/**
 * The replay behind backflush (111 D23): which parts, in what order, over which days, and the
 * per-day decision `qoh(day) < 0 → one build of the shortfall`. `backflush.ts` writes what this
 * walks; `backflush-preview.ts` walks it read-only. Reads at the top, pure functions below.
 */

import type { Database } from '@auxx/database'
import { isDayKeyShape } from '@auxx/utils/calendar-day'
import { UnprocessableEntityError } from '../../errors'
import { isBuildablePartKind } from '../costing/client'
import { buildSubpartGraph, loadOrgPricingData } from '../costing/cost-calculator'
import { readPartNetThrough } from '../costing/dated-reads'
import { loadStandardCostWriteContext } from '../costing/standard-cost-queries'
import type { SubpartEdge } from '../costing/standard-cost-roll'
import { endOfLocalDay } from './backfill-builds'
import type { BackflushBuild } from './backflush-types'
import { readPartNames } from './build-queries'

/** A range longer than this is a mistake, not history. */
const MAX_DAYS = 366

export interface BackflushGraph {
  /** Live parts with a BOM and a made kind, parents before the children they consume. */
  order: string[]
  /** parent → direct children with the per-unit quantity a build consumes. */
  subparts: ReadonlyMap<string, SubpartEdge[]>
  names: ReadonlyMap<string, string>
  /** For the roll-first gate (111 Q20): a part with no confirmed standard is rolled before its first build. */
  standardCosts: ReadonlyMap<string, number>
  standardCostSources: ReadonlyMap<string, string>
}

export interface BackflushDay {
  day: string
  /** 23:59:59.999 of `day` in the book time zone: the build's accounting date and the replay's bound. */
  completedAt: Date
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function readBackflushGraph(
  db: Database,
  organizationId: string
): Promise<BackflushGraph> {
  const [context, pricing] = await Promise.all([
    loadStandardCostWriteContext(db, organizationId),
    loadOrgPricingData(organizationId),
  ])
  const subparts = buildSubpartGraph(
    pricing.subparts.filter((edge) => edge.quantity > 0 && edge.parentPartId && edge.childPartId)
  )
  const candidates = new Set<string>()
  for (const parentId of subparts.keys()) {
    if (!context.allPartIds.has(parentId)) continue
    if (isBuildablePartKind(context.partKinds.get(parentId) ?? 'component'))
      candidates.add(parentId)
  }
  const order = orderParentsFirst(candidates, subparts)
  const names = await readPartNames(db, organizationId, order)
  return {
    order,
    subparts,
    names,
    standardCosts: context.standardCosts,
    standardCostSources: context.standardCostSources,
  }
}

// ── Pure ──────────────────────────────────────────────────────────────────────

/**
 * Candidates in an order where every part precedes the candidates below it: reverse DFS
 * post-order over the subpart graph. Chosen over `computeStandardCosts(...).order` because that
 * needs the cost inputs loaded and drops a part it cannot value; the order here must hold every
 * made part, costed or not. A cycle is walked once and never revisited.
 */
export function orderParentsFirst(
  candidates: ReadonlySet<string>,
  subparts: ReadonlyMap<string, SubpartEdge[]>
): string[] {
  const visited = new Set<string>()
  const postOrder: string[] = []
  const walk = (partId: string) => {
    if (visited.has(partId)) return
    visited.add(partId)
    for (const edge of subparts.get(partId) ?? []) walk(edge.childId)
    if (candidates.has(partId)) postOrder.push(partId)
  }
  for (const partId of [...candidates].sort()) walk(partId)
  return postOrder.reverse()
}

/**
 * Every day from `from` to `to` inclusive (`YYYY-MM-DD`, book-zone days) whose end in `timeZone`
 * is at or before `now` — a build dated in the future would complete demand that has not happened yet.
 */
export function listBackflushDays(
  range: { from: string; to: string },
  timeZone: string,
  now: Date
): BackflushDay[] {
  const { from: first, to: last } = range
  if (!isDayKeyShape(first) || !isDayKeyShape(last)) {
    throw new UnprocessableEntityError('A backflush range is two YYYY-MM-DD days')
  }
  if (first > last) {
    throw new UnprocessableEntityError('The backflush range must not end before it starts')
  }
  const days: BackflushDay[] = []
  for (let day = first; day <= last; day = nextDay(day)) {
    if (days.length >= MAX_DAYS) {
      throw new UnprocessableEntityError(`A backflush covers at most ${MAX_DAYS} days at a time`)
    }
    const completedAt = endOfLocalDay(day, timeZone)
    if (Number.isNaN(completedAt.getTime())) {
      throw new UnprocessableEntityError(`Cannot derive the end of ${day} in ${timeZone}`)
    }
    if (completedAt.getTime() <= now.getTime()) days.push({ day, completedAt })
  }
  return days
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** Simulated ledger movement not yet read back: +produced on the part, −consumed on its children. */
export type BackflushDelta = Map<string, number>

/**
 * One day's decisions, parents first. `act` returns whether the build was completed; only then
 * does its consumption reach the children, so a refused parent never makes a child overbuild.
 *
 * Invariant: `net` is the ledger through the end of `day`; a child is decided after its parent
 * within the same day, so the parent's consumption — written, or simulated through `delta` — is
 * netted before the child is checked. Returns the number of `qoh >= 0` checks.
 */
export async function walkBackflushDay(
  graph: BackflushGraph,
  day: BackflushDay,
  net: ReadonlyMap<string, number>,
  delta: BackflushDelta,
  act: (build: BackflushBuild) => Promise<boolean>
): Promise<number> {
  let skipped = 0
  for (const partId of graph.order) {
    const qoh = (net.get(partId) ?? 0) + (delta.get(partId) ?? 0)
    if (qoh >= 0) {
      skipped += 1
      continue
    }
    const quantity = -qoh
    const build: BackflushBuild = {
      partId,
      partName: graph.names.get(partId) ?? null,
      day: day.day,
      completedAt: day.completedAt,
      quantity,
    }
    if (!(await act(build))) continue
    delta.set(partId, (delta.get(partId) ?? 0) + quantity)
    for (const edge of graph.subparts.get(partId) ?? []) {
      delta.set(edge.childId, (delta.get(edge.childId) ?? 0) - quantity * edge.qty)
    }
  }
  return skipped
}

/**
 * The whole walk. `carry` keeps the simulated delta across days (the preview, which writes
 * nothing) or resets it per day (the run, whose builds are in the ledger by the next read).
 */
export async function walkBackflush(params: {
  organizationId: string
  graph: BackflushGraph
  days: readonly BackflushDay[]
  carry: boolean
  act: (build: BackflushBuild) => Promise<boolean>
  onDayError: (day: BackflushDay, error: unknown) => void
  readNet?: typeof readPartNetThrough
}): Promise<{ skipped: number }> {
  const readNet = params.readNet ?? readPartNetThrough
  const delta: BackflushDelta = new Map()
  let skipped = 0
  for (const day of params.days) {
    if (!params.carry) delta.clear()
    // One bad day must not lose the range.
    try {
      const net = await readNet(params.organizationId, params.graph.order, day.completedAt)
      skipped += await walkBackflushDay(params.graph, day, net, delta, params.act)
    } catch (error) {
      params.onDayError(day, error)
    }
  }
  return { skipped }
}
