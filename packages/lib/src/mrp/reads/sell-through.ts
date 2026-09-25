// packages/lib/src/mrp/reads/sell-through.ts

import type { Database } from '@auxx/database'
import { addDaysToDayKey, type DayKey, todayInZone } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { getOrgCache } from '../../cache'
import { readDailyActivity, readDailySeries } from '../../inventory/movements/fact/reads'
import { guard } from './guard'
import { readPartLabels, readRecordNames } from './labels'
import { readItems, walkBom } from './part-item'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'

/** The trailing window Sold and Built count over (07 §4.6). */
export const SELL_THROUGH_DAYS = 30

/** The BOM descendant that stocks out first; its dates are on combined demand (02 §7a). */
export interface LimitingPart {
  partId: string
  name: string | null
  stockoutDate: DayKey
  orderByDate: DayKey | null
  isOverdue: boolean
  supplier: { id: string; name: string | null } | null
}

/** Units buildable from direct children's on hand; `partId` is the child that sets it. */
export interface BuildableCeiling {
  quantity: number
  partId: string
  name: string | null
  parentCount: number
}

export interface SellThrough {
  run: MrpRunRef | null
  /** Direct children in the BOM; 0 means the part has no BOM. */
  componentCount: number
  window: { from: DayKey; to: DayKey }
  /** `sale` + `ship` over the window. */
  sold: number
  /** `build_produce` over the window. */
  built: number
  /** On hand at the start of the window, replayed from the mirror. */
  opening: number
  /** `sold − built − max(0, opening)`, floored at 0. */
  unbuilt: number
  limiting: LimitingPart | null
  ceiling: BuildableCeiling | null
}

type WalkedNode = ReturnType<typeof walkBom>[number]

/** The descendant with the earliest stored stockout date; ties go to the first in BOM order. */
export function pickLimitingNode(
  nodes: readonly WalkedNode[],
  items: ReadonlyMap<string, Pick<MrpPlanItemRow, 'stockoutDate'>>
): WalkedNode | null {
  let best: WalkedNode | null = null
  let bestDay: DayKey | null = null
  for (const node of nodes) {
    const day = items.get(node.partId)?.stockoutDate ?? null
    if (day && (bestDay === null || day < bestDay)) {
      best = node
      bestDay = day
    }
  }
  return best
}

/** min over direct children of floor(on hand ÷ quantity per); children without a run item are skipped. */
export function computeBuildableCeiling(
  nodes: readonly WalkedNode[],
  items: ReadonlyMap<string, Pick<MrpPlanItemRow, 'onHand'>>
): { quantity: number; node: WalkedNode } | null {
  let out: { quantity: number; node: WalkedNode } | null = null
  for (const node of nodes) {
    if (node.depth !== 1 || node.quantityPer <= 0) continue
    const item = items.get(node.partId)
    if (!item) continue
    const quantity = Math.floor(Math.max(0, item.onHand) / node.quantityPer)
    if (out === null || quantity < out.quantity) out = { quantity, node }
  }
  return out
}

/** A part's 30-day sold/built/opening trust signal (01 §3 P3), its limiting part and its buildable ceiling. */
export async function readSellThrough(
  db: Database,
  organizationId: string,
  input: { partId: string; runId?: string | null }
): Promise<Result<SellThrough, Error>> {
  return guard(
    async () => {
      const { partId } = input
      const [run, zone, edges] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readBookTimeZoneOrUtc(organizationId),
        getOrgCache().get(organizationId, 'subpartEdges'),
      ])
      const tree = walkBom(partId, edges ?? [])
      const to = run?.asOfDay ?? todayInZone(zone)
      const from = addDaysToDayKey(to, -(SELL_THROUGH_DAYS - 1))

      const [activity, openingDay, items] = await Promise.all([
        readDailyActivity(db, organizationId, { partIds: [partId], from, to, zone }),
        readDailySeries(db, organizationId, { partIds: [partId], from, to: from, zone }),
        run
          ? readItems(
              db,
              organizationId,
              run.id,
              tree.map((n) => n.partId)
            )
          : new Map<string, MrpPlanItemRow>(),
      ])
      if (activity.isErr()) throw activity.error
      if (openingDay.isErr()) throw openingDay.error

      const sold = activity.value.reduce((sum, a) => sum + a.saleQty, 0)
      const built = activity.value.reduce((sum, a) => sum + a.produceQty, 0)
      const first = openingDay.value[0]
      const opening = first ? first.onHandEod - first.net : 0

      const limitingNode = pickLimitingNode(tree, items)
      const limitingItem = limitingNode ? items.get(limitingNode.partId) : undefined
      const ceiling = computeBuildableCeiling(tree, items)
      const supplierId = limitingItem?.suggestedSupplierId ?? null

      const [labels, supplierNames] = await Promise.all([
        readPartLabels(
          db,
          organizationId,
          [limitingNode?.partId, ceiling?.node.partId].filter((id): id is string => !!id)
        ),
        supplierId
          ? readRecordNames(db, organizationId, 'company', [supplierId])
          : new Map<string, string | null>(),
      ])

      return {
        run,
        componentCount: tree.filter((n) => n.depth === 1).length,
        window: { from, to },
        sold,
        built,
        opening,
        unbuilt: Math.max(0, sold - built - Math.max(0, opening)),
        limiting:
          limitingNode && limitingItem?.stockoutDate
            ? {
                partId: limitingNode.partId,
                name: labels.get(limitingNode.partId)?.name ?? null,
                stockoutDate: limitingItem.stockoutDate,
                orderByDate: limitingItem.orderByDate,
                isOverdue: limitingItem.isOverdue,
                supplier: supplierId
                  ? { id: supplierId, name: supplierNames.get(supplierId) ?? null }
                  : null,
              }
            : null,
        ceiling: ceiling
          ? {
              quantity: ceiling.quantity,
              partId: ceiling.node.partId,
              name: labels.get(ceiling.node.partId)?.name ?? null,
              parentCount: ceiling.node.parentCount,
            }
          : null,
      }
    },
    'Failed to read sell-through for a part',
    { organizationId, partId: input.partId, runId: input.runId }
  )
}
