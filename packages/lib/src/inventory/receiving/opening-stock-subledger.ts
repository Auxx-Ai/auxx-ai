// packages/lib/src/inventory/receiving/opening-stock-subledger.ts

/**
 * What the parts were worth at the cutover: the shelf's side of the opening inventory
 * difference (plans/accounting/tasks/111 Q19/Q23). Every movement dated on or before the
 * cutover is summed at its frozen `extended_cost`, over parts that carry an `initial`.
 * A part with movements and no `initial` is a replay with no anchor — throughput, not stock —
 * so it is listed and excluded; a row with no value (pending cost, no cost, no inventory role)
 * is counted and excluded rather than refused.
 *
 * The role is read off the movement's frozen `glRole`, never re-derived from the part's
 * current kind. Reads only; the router asserts.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, lte, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { readSystemRecords, systemDefId } from '../../resources/system-records'
import { guard } from './guard'

/** The three inventory roles a movement's frozen `glRole` may name. */
export const OPENING_STOCK_INVENTORY_ROLES = [
  'inventory_raw_materials',
  'inventory_wip',
  'inventory_finished_goods',
] as const

export type OpeningStockInventoryRole = (typeof OPENING_STOCK_INVENTORY_ROLES)[number]

/** Σ signed `extendedCost` per inventory role, integer minor units. */
export type OpeningStockSubledgerTotals = Record<OpeningStockInventoryRole, number>

export interface PartValueAtCutover {
  partId: string
  name: string
  /** Net quantity of every movement on or before the cutover. */
  qtyAtCutover: number
  /** Σ frozen extended cost of the valued rows, minor units. */
  valueMinor: number
}

export interface UncountedPart {
  partId: string
  name: string
  /** What left the shelf before the cutover with nothing counted behind it: `−net(quantity)`. */
  throughputAtCutover: number
}

export interface PartsValueAtCutover {
  byRole: OpeningStockSubledgerTotals
  /** Σ `byRole`. */
  totalMinor: number
  /** Anchored parts, most valuable first. */
  byPart: PartValueAtCutover[]
  /** Parts with pre-cutover movements and no `initial`. */
  uncounted: UncountedPart[]
  /** Rows on anchored parts that carry no value yet and are left out of the sum. */
  pendingRows: number
}

/**
 * The parts' value on `onOrBefore` (`YYYY-MM-DD`), grouped as the difference screen needs it.
 * Unexploded `adjustSubparts` rows are excluded like every other valuation read.
 */
export async function readPartsValueAtCutover(
  db: Database,
  organizationId: string,
  options: { onOrBefore: string }
): Promise<Result<PartsValueAtCutover, Error>> {
  return guard(
    async () => {
      const empty: PartsValueAtCutover = {
        byRole: emptyTotals(),
        totalMinor: 0,
        byPart: [],
        uncounted: [],
        pendingRows: 0,
      }
      const t = schema.StockMovement
      const valued: SQL = and(
        isNotNull(t.extendedCostMinor),
        sql`${t.costBasis} IS DISTINCT FROM ${StockMovementCostBasis.PENDING}`,
        inArray(t.glRole, [...OPENING_STOCK_INVENTORY_ROLES])
      )!

      const rows = await db
        .select({
          partId: t.partId,
          role: t.glRole,
          hasInitial: sql<boolean>`bool_or(${t.type} = ${StockMovementType.INITIAL})`,
          netQty: sql<string>`coalesce(sum(${t.quantity}), 0)`,
          valueMinor: sql<string>`coalesce(sum(${t.extendedCostMinor}) FILTER (WHERE ${valued}), 0)`,
          unvalued: sql<string>`count(*) FILTER (WHERE NOT ${valued})`,
        })
        .from(t)
        .where(
          and(
            eq(t.organizationId, organizationId),
            isNotNull(t.occurredAt),
            lte(sql`${t.occurredAt}::date`, options.onOrBefore),
            eq(t.adjustSubparts, false)
          )
        )
        .groupBy(t.partId, t.glRole)

      // One part spans several (part, role) groups; anchoring is a fact of the part.
      const parts = new Map<
        string,
        {
          hasInitial: boolean
          netQty: number
          valueMinor: number
          unvalued: number
          byRole: Map<string, number>
        }
      >()
      for (const row of rows) {
        const entry = parts.get(row.partId) ?? {
          hasInitial: false,
          netQty: 0,
          valueMinor: 0,
          unvalued: 0,
          byRole: new Map<string, number>(),
        }
        entry.hasInitial ||= row.hasInitial === true
        entry.netQty += Number(row.netQty)
        const value = Number(row.valueMinor)
        entry.valueMinor += value
        entry.unvalued += Number(row.unvalued)
        if (row.role && value !== 0) {
          entry.byRole.set(row.role, (entry.byRole.get(row.role) ?? 0) + value)
        }
        parts.set(row.partId, entry)
      }

      const names = await readPartNames(db, organizationId, [...parts.keys()])
      const result: PartsValueAtCutover = { ...empty, byRole: emptyTotals() }
      for (const [partId, entry] of parts) {
        const name = names.get(partId) ?? partId
        if (!entry.hasInitial) {
          result.uncounted.push({ partId, name, throughputAtCutover: -entry.netQty })
          continue
        }
        result.pendingRows += entry.unvalued
        result.byPart.push({
          partId,
          name,
          qtyAtCutover: entry.netQty,
          valueMinor: entry.valueMinor,
        })
        for (const [role, minor] of entry.byRole) {
          if (isOpeningStockInventoryRole(role)) result.byRole[role] += minor
        }
      }
      result.totalMinor = OPENING_STOCK_INVENTORY_ROLES.reduce(
        (sum, role) => sum + result.byRole[role],
        0
      )
      result.byPart.sort((a, b) => b.valueMinor - a.valueMinor || a.name.localeCompare(b.name))
      result.uncounted.sort(
        (a, b) => b.throughputAtCutover - a.throughputAtCutover || a.name.localeCompare(b.name)
      )
      return result
    },
    'Failed to value the parts at the cutover',
    { organizationId }
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyTotals(): OpeningStockSubledgerTotals {
  return { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 }
}

async function readPartNames(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (partIds.length === 0) return names
  const partDefId = await systemDefId(db, organizationId, 'part')
  if (!partDefId) return names
  const records = await readSystemRecords(
    db,
    organizationId,
    { defId: partDefId, fields: {} },
    { ids: partIds, includeArchived: true, cells: false }
  )
  for (const record of records) {
    if (record.displayName) names.set(record.id, record.displayName)
  }
  return names
}

function isOpeningStockInventoryRole(value: string): value is OpeningStockInventoryRole {
  return (OPENING_STOCK_INVENTORY_ROLES as readonly string[]).includes(value)
}
