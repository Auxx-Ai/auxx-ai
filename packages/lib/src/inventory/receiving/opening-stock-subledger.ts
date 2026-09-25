// packages/lib/src/inventory/receiving/opening-stock-subledger.ts

/**
 * What the parts were worth at the cutover: the shelf's side of the opening inventory
 * difference (plans/accounting/tasks/111 Q19/Q23). Every movement dated on or before the
 * cutover is summed at its frozen `extended_cost`, over parts that carry an `initial`.
 * A part with movements and no `initial` is a replay with no anchor — throughput, not stock —
 * so it is listed and excluded; a row with no value (pending cost, no cost, no inventory role)
 * is counted and excluded rather than refused.
 *
 * The role is read off the movement's frozen `stock_movement_gl_account`, never re-derived
 * from the part's current kind. Reads only; the router asserts.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import {
  optionalFieldId,
  readSystemRecords,
  systemDefId,
  systemFieldMap,
  systemValueJoin,
} from '../../resources/system-records'
import { guard } from './guard'

/** The three inventory roles a movement's frozen `gl_account` may name. */
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
  /** Σ frozen `extended_cost` of the valued rows, minor units. */
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

const MOVEMENT_PICK = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
] as const)

/** Optional: an org that predates them has no pending rows and no exploded children. */
const OPTIONAL_PICK = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_cost_basis',
  'stock_movement_adjust_subparts',
] as const)

/**
 * The parts' value on `onOrBefore` (`YYYY-MM-DD`), grouped as the difference screen needs it.
 * Archived movements and exploded `adjust_subparts` children are excluded like every other
 * valuation read. An org with no `stock_movement` definition has an empty answer, not an error.
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
      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      if (!movementDefId) return empty

      const fields = await systemFieldMap(db, organizationId, [...MOVEMENT_PICK, ...OPTIONAL_PICK])
      const missing = MOVEMENT_PICK.filter((attribute) => !fields[attribute])
      if (missing.length > 0) {
        throw new UnprocessableEntityError(
          'The parts cannot be valued at the cutover until the stock movement fields are ' +
            `provisioned. Missing: ${missing.join(', ')}.`,
          { organizationId, missing: missing.join(',') }
        )
      }

      const part = alias(schema.FieldValue, 'pvc_part')
      const type = alias(schema.FieldValue, 'pvc_type')
      const quantity = alias(schema.FieldValue, 'pvc_qty')
      const extendedCost = alias(schema.FieldValue, 'pvc_ext')
      const glAccount = alias(schema.FieldValue, 'pvc_gl')
      const occurredAt = alias(schema.FieldValue, 'pvc_at')
      const costBasis = alias(schema.FieldValue, 'pvc_basis')
      const adjustSubparts = alias(schema.FieldValue, 'pvc_sub')

      const valued: SQL = and(
        isNotNull(extendedCost.valueNumber),
        or(
          isNull(costBasis.optionId),
          sql`${costBasis.optionId} <> ${StockMovementCostBasis.PENDING}`
        ),
        sql`${glAccount.valueText} IN (${sql.join(
          OPENING_STOCK_INVENTORY_ROLES.map((role) => sql`${role}`),
          sql`, `
        )})`
      )!

      const rows = await db
        .select({
          partId: part.relatedEntityId,
          role: glAccount.valueText,
          hasInitial: sql<boolean>`bool_or(${type.optionId} = ${StockMovementType.INITIAL})`,
          netQty: sql<string | number>`coalesce(sum(${quantity.valueNumber}), 0)`,
          valueMinor: sql<
            string | number
          >`coalesce(sum(${extendedCost.valueNumber}) FILTER (WHERE ${valued}), 0)`,
          unvalued: sql<string | number>`count(*) FILTER (WHERE NOT ${valued})`,
        })
        .from(schema.EntityInstance)
        .innerJoin(part, systemValueJoin(part, fields.stock_movement_part!.id))
        .innerJoin(occurredAt, systemValueJoin(occurredAt, fields.stock_movement_occurred_at!.id))
        .leftJoin(type, systemValueJoin(type, fields.stock_movement_type!.id))
        .leftJoin(quantity, systemValueJoin(quantity, fields.stock_movement_quantity!.id))
        .leftJoin(
          extendedCost,
          systemValueJoin(extendedCost, fields.stock_movement_extended_cost!.id)
        )
        .leftJoin(glAccount, systemValueJoin(glAccount, fields.stock_movement_gl_account!.id))
        .leftJoin(
          costBasis,
          systemValueJoin(costBasis, optionalFieldId(fields.stock_movement_cost_basis))
        )
        .leftJoin(
          adjustSubparts,
          systemValueJoin(adjustSubparts, optionalFieldId(fields.stock_movement_adjust_subparts))
        )
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, movementDefId),
            isNull(schema.EntityInstance.archivedAt),
            isNotNull(part.relatedEntityId),
            isNotNull(occurredAt.valueDate),
            lte(sql`${occurredAt.valueDate}::date`, options.onOrBefore),
            sql`coalesce(${adjustSubparts.valueBoolean}, false) = false`
          )
        )
        .groupBy(part.relatedEntityId, glAccount.valueText)

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
        if (!row.partId) continue
        const entry = parts.get(row.partId) ?? {
          hasInitial: false,
          netQty: 0,
          valueMinor: 0,
          unvalued: 0,
          byRole: new Map<string, number>(),
        }
        entry.hasInitial ||= row.hasInitial === true
        entry.netQty += Number(row.netQty)
        const value = wholeMinor(row.partId, row.valueMinor)
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

/** `extended_cost` is whole minor units by construction (`computeExtendedCost` rounds); a fraction means a row written around it. */
function wholeMinor(partId: string, raw: string | number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new UnprocessableEntityError(
      `The value of part ${partId} at the cutover is not a number.`,
      {
        partId,
      }
    )
  }
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) > 1e-6) {
    throw new UnprocessableEntityError(
      `The value of part ${partId} at the cutover is ${value}, not a whole number of minor units.`,
      { partId, value: String(value) }
    )
  }
  return rounded
}
