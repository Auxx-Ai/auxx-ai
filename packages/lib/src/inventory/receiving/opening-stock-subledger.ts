// packages/lib/src/inventory/receiving/opening-stock-subledger.ts

/**
 * What the opening-stock SUBLEDGER is worth, per inventory role: the parts' side
 * of the opening, compared with the ledger's by `readOpeningInventoryDifference`
 * (plans/accounting/tasks/103 §5a).
 *
 * Nothing maps a part kind to `inventory_wip` (`INVENTORY_ROLE_BY_PART_KIND`), so
 * WIP is structurally zero here.
 *
 * ── 🛑 The role is read off the MOVEMENT, never re-derived ──────────────────
 *
 * `stock_movement_gl_account` is frozen at write time and `updatable: false`.
 * Re-deriving it from the part's CURRENT `part_kind` gives one movement two
 * accounts that can disagree - the exact failure
 * the frozen role exists to prevent - and a part
 * reclassified after its opening balance was written would silently restate the
 * count.
 *
 * ── 🛑 A role-less or uncosted `initial` movement is a HARD STOP ────────────
 *
 * Never filtered, for the reason `postings/gather-month-end-inventory.ts` gives
 * in its rule A: skipping it produces a reconciliation that agrees and
 * understates inventory with NO SIGNAL. There is no cutoff window to soften it
 * with either - `openStockBalance` refuses a non-positive quantity or unit cost
 * and stamps the role itself, so every sanctioned `initial` movement carries all
 * three. One that does not was written outside that door.
 *
 * Reads only. No permission checks: the router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { toMinor } from '@auxx/utils/currency'
import { and, eq, inArray, isNull, lte, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { StockMovementType } from '../../resources/registry/enum-values'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { systemDefId, systemFieldMap, systemValueJoin } from '../../resources/system-records'
import { guard } from './guard'

/** The three inventory roles a movement's frozen `gl_account` may name. */
export const OPENING_STOCK_INVENTORY_ROLES = [
  'inventory_raw_materials',
  'inventory_wip',
  'inventory_finished_goods',
] as const

export type OpeningStockInventoryRole = (typeof OPENING_STOCK_INVENTORY_ROLES)[number]

/** Σ signed `extendedCost` of every `initial` movement, per inventory role. */
export type OpeningStockSubledgerTotals = Record<OpeningStockInventoryRole, number>

/** The movement attributes this reader needs. Every one is required. */
const MOVEMENT_PICK = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_type',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
] as const)

/** How many offending movement ids a refusal names before it stops. */
const MAX_NAMED_OFFENDERS = 10

/**
 * Σ the SIGNED `stock_movement_extended_cost` of every `initial` stock movement
 * in the organization, grouped by the movement's own FROZEN
 * `stock_movement_gl_account` role.
 *
 * All three roles are always present in the answer, `0` when nothing landed in
 * one - a caller comparing against a baseline needs "nothing is there", not a
 * missing key.
 *
 * Signed, not absolute: a reversal of a mis-valued opening balance is a second
 * `initial` movement carrying the negated cost (`reverse-movement.ts`), so the
 * sum nets the pair out on its own. Filtering reversals would leave the original
 * standing in the total with the correction gone.
 *
 * Archived movements are EXCLUDED, like every other valuation read
 * (`gather-month-end-inventory.ts`). This is deliberately not the rule
 * `listOpeningStockCandidates` uses for `hasMovements`, which counts archived
 * rows so that archiving cannot re-open the once-only door: that is a GUARD
 * question and this is a VALUE question.
 *
 * @param db The database handle. Reads only.
 * @param organizationId The organization whose subledger is being valued.
 * @param options `onOrBefore` (`YYYY-MM-DD`) keeps only movements dated on or before it.
 * @returns One figure per inventory role, in integer minor units, or an
 *   {@link UnprocessableEntityError} naming the movements that cannot be valued.
 */
export async function readOpeningStockSubledgerTotals(
  db: Database,
  organizationId: string,
  options: { onOrBefore?: string } = {}
): Promise<Result<OpeningStockSubledgerTotals, Error>> {
  return guard(
    async () => {
      const byRole = emptyTotals()

      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      // No `stock_movement` definition means no movements, which is a fact
      // rather than a failure: the subledger is worth nothing yet.
      if (!movementDefId) return byRole

      const fields = await systemFieldMap(db, organizationId, MOVEMENT_PICK)

      const missing = MOVEMENT_PICK.filter((attribute) => !fields[attribute])
      if (missing.length > 0) {
        throw new UnprocessableEntityError(
          'The opening-stock subledger cannot be valued until the stock movement costing ' +
            `fields are provisioned. Missing: ${missing.join(', ')}.`,
          { organizationId, missing: missing.join(',') }
        )
      }

      const movementType = alias(schema.FieldValue, 'osl_type')
      const extendedCost = alias(schema.FieldValue, 'osl_extended')
      const unitCost = alias(schema.FieldValue, 'osl_unit')
      const glAccount = alias(schema.FieldValue, 'osl_gl')

      /**
       * Every live `initial` movement in the org.
       *
       * The BOM-explosion parent is not excluded because it cannot be one:
       * `openStockBalance` writes `stock_movement_adjust_subparts: false` on
       * every `initial` row, and only an `adjust` is ever exploded.
       */
      const scope = and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId),
        isNull(schema.EntityInstance.archivedAt),
        eq(movementType.optionId, StockMovementType.INITIAL),
        ...(options.onOrBefore
          ? [await datedOnOrBefore(db, organizationId, options.onOrBefore)]
          : [])
      )

      // ── The hard stop, first and on its own ─────────────────────────────
      //
      // Every cost/role join is a LEFT join on purpose. An INNER join would
      // make an uncosted movement invisible to this scan, which is the
      // fail-open reading expressed in SQL rather than in code.
      const offenders = await db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .innerJoin(movementType, systemValueJoin(movementType, fields.stock_movement_type!.id))
        .leftJoin(
          extendedCost,
          systemValueJoin(extendedCost, fields.stock_movement_extended_cost!.id)
        )
        .leftJoin(unitCost, systemValueJoin(unitCost, fields.stock_movement_unit_cost!.id))
        .leftJoin(glAccount, systemValueJoin(glAccount, fields.stock_movement_gl_account!.id))
        .where(
          and(
            scope,
            or(
              isNull(extendedCost.valueNumber),
              isNull(unitCost.valueNumber),
              isNull(glAccount.valueText),
              sql`length(trim(coalesce(${glAccount.valueText}, ''))) = 0`,
              notInArray(glAccount.valueText, [...OPENING_STOCK_INVENTORY_ROLES])
            )
          )
        )
        .limit(MAX_NAMED_OFFENDERS + 1)

      if (offenders.length > 0) {
        const named = offenders.slice(0, MAX_NAMED_OFFENDERS).map((row) => row.id)
        const more = offenders.length > MAX_NAMED_OFFENDERS ? ' (and more)' : ''
        throw new UnprocessableEntityError(
          `${named.length}${more} opening stock movement(s) have no frozen cost or no ` +
            'inventory role, so the opening-stock subledger cannot be valued. Opening a ' +
            'balance stamps all three at write time, so these were written outside that ' +
            'door. They are refused rather than skipped, because skipping them reconciles ' +
            `cleanly against a baseline they belong in. Movements: ${named.join(', ')}${more}.`,
          { organizationId, movementIds: named.join(',') }
        )
      }

      // ── The sum ─────────────────────────────────────────────────────────
      const rows = await db
        .select({
          role: glAccount.valueText,
          total: sql<string | number>`coalesce(sum(${extendedCost.valueNumber}), 0)`,
        })
        .from(schema.EntityInstance)
        .innerJoin(movementType, systemValueJoin(movementType, fields.stock_movement_type!.id))
        .innerJoin(
          extendedCost,
          systemValueJoin(extendedCost, fields.stock_movement_extended_cost!.id)
        )
        .innerJoin(glAccount, systemValueJoin(glAccount, fields.stock_movement_gl_account!.id))
        .where(scope)
        .groupBy(glAccount.valueText)

      for (const row of rows) {
        const role = row.role
        // Unreachable: the scan above already refused every movement whose role
        // is absent or is not one of the three. Kept as a hard stop rather than
        // a silent `continue`, because a `continue` here is that scan defeated
        // by a later edit to it.
        if (!role || !isOpeningStockInventoryRole(role)) {
          throw new UnprocessableEntityError(
            `Opening stock movements carry the unknown inventory role "${String(role)}". ` +
              `Only ${OPENING_STOCK_INVENTORY_ROLES.join(', ')} may value inventory.`,
            { organizationId, role: String(role) }
          )
        }
        byRole[role] += toMinorUnits(role, row.total)
      }

      return byRole
    },
    'Failed to value the opening stock subledger',
    { organizationId }
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyTotals(): OpeningStockSubledgerTotals {
  return { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 }
}

/** Movements whose `occurredAt` falls on or before `date`; refuses when the field is unprovisioned. */
async function datedOnOrBefore(db: Database, organizationId: string, date: string): Promise<SQL> {
  const fields = await systemFieldMap(db, organizationId, ['stock_movement_occurred_at'] as const)
  const occurredAt = fields.stock_movement_occurred_at
  if (!occurredAt) {
    throw new UnprocessableEntityError(
      'The opening-stock subledger cannot be dated until the stock movement date field is ' +
        'provisioned.',
      { organizationId }
    )
  }
  const dated = db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, occurredAt.id),
        lte(sql`${schema.FieldValue.valueDate}::date`, date)
      )
    )
  return inArray(schema.EntityInstance.id, dated)
}

function isOpeningStockInventoryRole(value: string): value is OpeningStockInventoryRole {
  return (OPENING_STOCK_INVENTORY_ROLES as readonly string[]).includes(value)
}

/**
 * A `SUM` over a `doublePrecision` column, as an integer count of minor units.
 *
 * `pg` hands a numeric aggregate back as a string, and `extendedCost` is already
 * whole minor units by construction (`computeExtendedCost` rounds), so anything
 * fractional arriving here is a movement written around that helper - refused
 * rather than rounded away.
 */
function toMinorUnits(role: string, raw: string | number): number {
  const value = toMinor(raw)
  if (!Number.isFinite(value)) {
    throw new UnprocessableEntityError(
      `The opening stock total for ${role} is not a number: ${String(raw)}.`,
      { role }
    )
  }
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) > 1e-6) {
    throw new UnprocessableEntityError(
      `The opening stock total for ${role} is ${value}, which is not a whole number of minor ` +
        'units. An extended cost is rounded when it is written, so a fractional total means a ' +
        'movement was valued outside that path.',
      { role, value: String(value) }
    )
  }
  return rounded
}
