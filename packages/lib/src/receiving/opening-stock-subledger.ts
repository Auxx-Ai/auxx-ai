// packages/lib/src/receiving/opening-stock-subledger.ts

/**
 * What the opening-stock SUBLEDGER is worth, per inventory account, and whether
 * it agrees with the opening baseline settings that own the same three rows.
 *
 * ── Why this read exists ────────────────────────────────────────────────────
 *
 * `accounting.openingRawMaterials` / `…Wip` / `…FinishedGoods` are the frozen
 * December 31 physical count, valued at CPA-approved costs
 * (`postings/opening-baseline.ts`). They OWN the three inventory rows of the
 * opening trial balance: `opening-trial-balance/writes.ts` refuses to post a
 * draft whose locked row disagrees with the setting.
 *
 * The `initial` stock movements are the per-part half of that same count, so a
 * difference between the two is worth showing somebody: it is inventory the
 * balance sheet claims and no part accounts for (or the reverse), and the repair
 * is either a figure re-entered or stock nobody has opened yet.
 *
 * ── 🛑 A difference is NOT an arithmetic fault, and nothing here blocks ─────
 *
 * This is a REPORT. It is deliberately not a gate on anything, and the reason is
 * that the close does not compare these two numbers at all: the opening baseline
 * **replaces** pre-cutoff subledger history rather than being checked against it.
 * `postings/gather-month-end-inventory.ts` is explicit - at cutover there is no
 * prior posting and "the opening baseline stands in"; pre-cutoff movements are
 * ignored because "the opening snapshot replaces that history entirely, which is
 * the whole reason the window starts where it does"; a month at or before the
 * cutoff is refused as covered by the frozen opening balances; and the closing
 * balance is `openingBalances.<role> + movements.byRole.<role>` over POST-cutoff
 * movements only.
 *
 * So a $1,000 baseline against zero `initial` movements closes to
 * `nothing_to_close`, not to a phantom COGS plug. 🛑 **Do not add a finalize
 * refusal on this comparison.** One was built and removed: it made an org that
 * could finalize unable to, for no arithmetic reason. The "difference falls into
 * January's balancing plug" warning in `postings/opening-baseline.ts` is about a
 * DIFFERENT reconciliation - `accounting.opening<X>` against the provider's own
 * `accounting.qboOpening<X>` on the same date - and conflating the two is what
 * produced the refusal.
 *
 * ── 🛑 Only TWO of the three roles are derivable, and that is structural ────
 *
 * `INVENTORY_ROLE_BY_PART_KIND` (`client.ts`) maps `component` and
 * `subassembly` to raw materials and `finished_good` to finished goods.
 * **Nothing maps to `inventory_wip`**, and `postings/build-entry.ts` states it
 * outright: only two of the three inventory roles are reachable from
 * `partKind`. WIP is structurally zero here because `completeBuild` writes the
 * consume and the produce legs in ONE call, so material never rests in work in
 * process. {@link findOpeningStockDivergences} therefore compares the two
 * derivable roles only, and never reports WIP as a difference.
 *
 * ── 🛑 The role is read off the MOVEMENT, never re-derived ──────────────────
 *
 * `stock_movement_gl_account` is frozen at write time and `updatable: false`.
 * Re-deriving it from the part's CURRENT `part_kind` gives one movement two
 * accounts that can disagree - the exact failure
 * `buildReceiptEntry.inventoryAccountRole` exists to prevent - and a part
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
import { and, eq, isNull, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../postings/default-chart'
import { OPENING_BASELINE_SETTING_KEYS } from '../postings/setup-readiness'
import { StockMovementType } from '../resources/registry/enum-values'
import { getOrganizationSetting } from '../settings/settings-service'
import { guard } from './guard'

/** The three inventory roles a movement's frozen `gl_account` may name. */
export const OPENING_STOCK_INVENTORY_ROLES = [
  'inventory_raw_materials',
  'inventory_wip',
  'inventory_finished_goods',
] as const

export type OpeningStockInventoryRole = (typeof OPENING_STOCK_INVENTORY_ROLES)[number]

/**
 * The roles a part's kind can actually reach, and therefore the only ones the
 * reconciliation may compare. See the module header for why WIP is not one.
 */
export const DERIVABLE_OPENING_STOCK_ROLES = [
  'inventory_raw_materials',
  'inventory_finished_goods',
] as const satisfies readonly OpeningStockInventoryRole[]

/** Σ signed `extendedCost` of every `initial` movement, per inventory role. */
export type OpeningStockSubledgerTotals = Record<OpeningStockInventoryRole, number>

/** One inventory role where the subledger and the baseline setting disagree. */
export interface OpeningStockDivergence {
  role: OpeningStockInventoryRole
  /** The seeded chart's number for {@link OpeningStockDivergence.role}, `1310`. */
  accountCode: string
  /** The seeded chart's name, `Raw Materials / Parts`. */
  accountName: string
  /** The org settings key that owns this row. */
  settingKey: string
  /** Σ of the `initial` movements stamped with this role, integer minor units. */
  countedMinor: number
  /** The setting's value, integer minor units, or `null` when nobody set one. */
  baselineMinor: number | null
}

/** The movement attributes this reader needs. Every one is required. */
const MOVEMENT_ATTRIBUTES = [
  'stock_movement_type',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
] as const

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
 * @returns One figure per inventory role, in integer minor units, or an
 *   {@link UnprocessableEntityError} naming the movements that cannot be valued.
 */
export async function readOpeningStockSubledgerTotals(
  db: Database,
  organizationId: string
): Promise<Result<OpeningStockSubledgerTotals, Error>> {
  return guard(
    async () => {
      const byRole = emptyTotals()

      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      // No `stock_movement` definition means no movements, which is a fact
      // rather than a failure: the subledger is worth nothing yet.
      if (!movementDefId) return byRole

      const fields = (await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([...MOVEMENT_ATTRIBUTES])) as Record<
        (typeof MOVEMENT_ATTRIBUTES)[number],
        { id: string } | null
      >

      const missing = MOVEMENT_ATTRIBUTES.filter((attribute) => !fields[attribute])
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

      /** `EntityInstance` -> its `FieldValue` row for one field. */
      const on = (table: FieldValueAlias, fieldId: string): SQL | undefined =>
        and(
          eq(table.entityId, schema.EntityInstance.id),
          eq(table.organizationId, schema.EntityInstance.organizationId),
          eq(table.fieldId, fieldId)
        )

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
        eq(movementType.optionId, StockMovementType.INITIAL)
      )

      // ── The hard stop, first and on its own ─────────────────────────────
      //
      // Every cost/role join is a LEFT join on purpose. An INNER join would
      // make an uncosted movement invisible to this scan, which is the
      // fail-open reading expressed in SQL rather than in code.
      const offenders = await db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .innerJoin(movementType, on(movementType, fields.stock_movement_type!.id))
        .leftJoin(extendedCost, on(extendedCost, fields.stock_movement_extended_cost!.id))
        .leftJoin(unitCost, on(unitCost, fields.stock_movement_unit_cost!.id))
        .leftJoin(glAccount, on(glAccount, fields.stock_movement_gl_account!.id))
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
        .innerJoin(movementType, on(movementType, fields.stock_movement_type!.id))
        .innerJoin(extendedCost, on(extendedCost, fields.stock_movement_extended_cost!.id))
        .innerJoin(glAccount, on(glAccount, fields.stock_movement_gl_account!.id))
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

/**
 * Which of the two derivable inventory roles the subledger and the opening
 * baseline settings disagree about.
 *
 * Unset is not zero (`opening-baseline.ts` is explicit about that), so an unset
 * setting is reported as a divergence only when the subledger holds something -
 * "no baseline, no movements" is an org that has not started, not a
 * disagreement. A setting that IS present must match to the cent.
 *
 * 🛑 The answer is REPORTING, never a gate. See the module header: the close
 * replaces pre-cutoff history with the baseline rather than reconciling against
 * it, so a difference here is something for a person to resolve and not
 * something that may refuse a finalize, a post or a close.
 *
 * @param db The database handle. Reads only.
 * @param organizationId The organization being reconciled.
 * @returns The divergences, empty when the two agree, or the read's own refusal.
 */
export async function findOpeningStockDivergences(
  db: Database,
  organizationId: string
): Promise<Result<OpeningStockDivergence[], Error>> {
  const totals = await readOpeningStockSubledgerTotals(db, organizationId)
  if (totals.isErr()) return err(totals.error)

  const divergences: OpeningStockDivergence[] = []
  for (const role of DERIVABLE_OPENING_STOCK_ROLES) {
    const settingKey = OPENING_BASELINE_SETTING_KEYS[role]
    const raw = await getOrganizationSetting({ organizationId, key: settingKey })
    const baselineMinor = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    const countedMinor = totals.value[role]

    if (baselineMinor === null ? countedMinor === 0 : baselineMinor === countedMinor) continue

    const account = DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.role === role)
    divergences.push({
      role,
      accountCode: account?.code ?? role,
      accountName: account?.name ?? '',
      settingKey,
      countedMinor,
      baselineMinor,
    })
  }
  return ok(divergences)
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * An aliased `FieldValue` table, as `alias()` returns it.
 *
 * Widened over the alias NAME on purpose: `alias(t, 'osl_gl')` and
 * `alias(t, 'osl_type')` have different types, so one join helper cannot be
 * typed against a single alias.
 */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

function emptyTotals(): OpeningStockSubledgerTotals {
  return { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 }
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
  const value = typeof raw === 'number' ? raw : Number(raw)
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
