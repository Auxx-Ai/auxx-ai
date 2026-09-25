// packages/lib/src/mrp/reads/where-used.ts

import type { Database } from '@auxx/database'
import { addDaysToDayKey, type DayKey, todayInZone } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { getOrgCache } from '../../cache'
import { buildParentGraph, type SubpartRow } from '../../inventory/costing/cost-calculator'
import {
  readDailySeries,
  readWhereUsedShares,
  type WhereUsedShareRow,
} from '../../inventory/movements/fact/reads'
import { guard } from './guard'
import { readPartLabels } from './labels'
import { readItems } from './part-item'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'

/** Used when the run's params carry no window (08 §6 default). */
const DEFAULT_WINDOW_DAYS = 90

type ItemBits = Pick<
  MrpPlanItemRow,
  'orderByDate' | 'stockoutDate' | 'suggestionKind' | 'suggestedQty' | 'isOverdue' | 'onHand'
>

/** A direct parent, or the part itself for direct sales (7a: "counts as its own parent"). */
export interface WhereUsedParent {
  partId: string
  name: string | null
  stockStatus: string | null
  /** Per-unit quantity on the current BOM edge; null when the share comes only from history. */
  quantityPer: number | null
  /** On the current BOM; false for a parent only history names. */
  inBom: boolean
  isDirectSale: boolean
  consumed: number
  /** Share of the part's consumption over the window, 0..1. */
  share: number
  item: ItemBits | null
}

/** A top-level product above the part in the current BOM: what running out of it would stop. */
export interface WhereUsedProduct {
  partId: string
  name: string | null
  stockStatus: string | null
  item: ItemBits | null
}

export interface WhereUsed {
  run: MrpRunRef | null
  window: { from: DayKey; to: DayKey }
  totalConsumed: number
  parents: WhereUsedParent[]
  products: WhereUsedProduct[]
}

/** Roots reachable upward from `partId` through the parent graph, excluding the part. */
export function topLevelAncestors(partId: string, edges: readonly SubpartRow[]): string[] {
  const parents = buildParentGraph(edges)
  const roots = new Set<string>()
  const seen = new Set<string>([partId])
  const stack = [...(parents.get(partId) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const up = parents.get(id) ?? []
    if (up.length === 0) roots.add(id)
    else stack.push(...up)
  }
  return [...roots].sort()
}

/** Direct parents with their share: BOM edges plus history's parents, and the remainder as direct sales. */
export function shapeParents(params: {
  partId: string
  edges: readonly SubpartRow[]
  shares: readonly WhereUsedShareRow[]
  totalConsumed: number
}): Omit<WhereUsedParent, 'name' | 'stockStatus' | 'item'>[] {
  const { partId, totalConsumed } = params
  const perUnit = new Map<string, number>()
  for (const e of params.edges) {
    if (e.childPartId === partId)
      perUnit.set(e.parentPartId, (perUnit.get(e.parentPartId) ?? 0) + e.quantity)
  }
  const consumedBy = new Map<string, number>()
  for (const s of params.shares) {
    if (s.componentId === partId && s.producedPartId !== partId)
      consumedBy.set(s.producedPartId, (consumedBy.get(s.producedPartId) ?? 0) + s.quantity)
  }
  const share = (q: number) => (totalConsumed > 0 ? q / totalConsumed : 0)
  const ids = new Set([...perUnit.keys(), ...consumedBy.keys()])
  const rows = [...ids].map((id) => {
    const consumed = consumedBy.get(id) ?? 0
    return {
      partId: id,
      quantityPer: perUnit.get(id) ?? null,
      inBom: perUnit.has(id),
      isDirectSale: false,
      consumed,
      share: share(consumed),
    }
  })
  const viaBuilds = [...consumedBy.values()].reduce((sum, q) => sum + q, 0)
  const direct = Math.max(0, totalConsumed - viaBuilds)
  if (direct > 0) {
    rows.push({
      partId,
      quantityPer: null,
      inBom: false,
      isDirectSale: true,
      consumed: direct,
      share: share(direct),
    })
  }
  return rows.sort((a, b) => b.consumed - a.consumed || a.partId.localeCompare(b.partId))
}

/** For a part: the products it limits and the share of its consumption per parent (02 §7a). */
export async function readWhereUsed(
  db: Database,
  organizationId: string,
  input: { partId: string; runId?: string | null }
): Promise<Result<WhereUsed, Error>> {
  return guard(
    async () => {
      const { partId } = input
      const [run, zone, edges] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readBookTimeZoneOrUtc(organizationId),
        getOrgCache().get(organizationId, 'subpartEdges'),
      ])
      const params = (run?.params ?? {}) as { aduWindowDays?: unknown }
      const windowDays =
        typeof params.aduWindowDays === 'number' && params.aduWindowDays > 0
          ? params.aduWindowDays
          : DEFAULT_WINDOW_DAYS
      const to = addDaysToDayKey(run?.asOfDay ?? todayInZone(zone), -1)
      const from = addDaysToDayKey(to, -(windowDays - 1))
      const range = { from, to, zone }

      const [shares, series] = await Promise.all([
        readWhereUsedShares(db, organizationId, [partId], range),
        readDailySeries(db, organizationId, { partIds: [partId], ...range }),
      ])
      if (shares.isErr()) throw shares.error
      if (series.isErr()) throw series.error
      const totalConsumed = series.value.reduce((sum, d) => sum + d.consumed, 0)

      const parentRows = shapeParents({
        partId,
        edges: edges ?? [],
        shares: shares.value,
        totalConsumed,
      })
      const productIds = topLevelAncestors(partId, edges ?? [])
      const ids = [...new Set([...parentRows.map((p) => p.partId), ...productIds])]
      const [labels, items] = await Promise.all([
        readPartLabels(db, organizationId, ids),
        run ? readItems(db, organizationId, run.id, ids) : new Map<string, MrpPlanItemRow>(),
      ])
      const bits = (id: string): ItemBits | null => {
        const item = items.get(id)
        return item
          ? {
              orderByDate: item.orderByDate,
              stockoutDate: item.stockoutDate,
              suggestionKind: item.suggestionKind,
              suggestedQty: item.suggestedQty,
              isOverdue: item.isOverdue,
              onHand: item.onHand,
            }
          : null
      }

      return {
        run,
        window: { from, to },
        totalConsumed,
        parents: parentRows.map((p) => ({
          ...p,
          name: labels.get(p.partId)?.name ?? null,
          stockStatus: labels.get(p.partId)?.stockStatus ?? null,
          item: bits(p.partId),
        })),
        products: productIds.map((id) => ({
          partId: id,
          name: labels.get(id)?.name ?? null,
          stockStatus: labels.get(id)?.stockStatus ?? null,
          item: bits(id),
        })),
      }
    },
    'Failed to read where-used',
    { organizationId, partId: input.partId }
  )
}
