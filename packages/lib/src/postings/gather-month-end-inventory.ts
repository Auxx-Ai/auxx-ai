// packages/lib/src/postings/gather-month-end-inventory.ts
//
// The READ half of the L1 month-end inventory entry. `buildMonthEndInventoryEntry`
// (build-month-end-inventory.ts) is the pure arithmetic; this file is everything
// that touches a database, and the two are split because they fail differently:
// an arithmetic failure is a bug and throws, a read failure is a runtime
// condition and comes back as a `Result` (docs/lib-module-guide.md section 3).
//
// ── The four reads ──────────────────────────────────────────────────────────
//
// 1. **The opening baseline** — `readOpeningBaseline`, through the org settings
//    cache. It supplies `cutoffPeriod`, `bookTimeZone` and the three frozen
//    opening balances, and it already fails closed with no default and no UTC.
// 2. **The prior effective posting** — the `posted` `month_end_inventory` row
//    with the greatest `periodKey` strictly before this one, then the greatest
//    `revision` inside that period. Its draft's `assertions.after` IS the prior
//    snapshot. At cutover there is none and the opening baseline stands in.
// 3. **The movement ledger** — Σ signed `stock_movement_extended_cost` grouped
//    by each movement's own FROZEN `stock_movement_gl_account` role, plus the
//    same sum restricted to `adjust`.
// 4. **The build rows** — Σ `build_labor_cost` and Σ `build_overhead_cost`.
//
// Lanes 3 and 4 are two SOURCES because the split cannot be recovered from one
// of them: a `stock_movement` freezes a single total `unit_cost` and carries no
// labour or overhead column at all. See `build-month-end-inventory.ts`'s header.
//
// ── 🛑 Three rules, each of which has a way of being got wrong ──────────────
//
// **A. Post-cutoff, an uncosted or role-less movement FAILS THE CLOSE.** It is
// never filtered. BEFORE the cutoff, NULL-cost movements are ignored — they
// predate the costing regime and the opening snapshot replaces that history
// entirely, which is the whole reason the window starts where it does. AFTER the
// cutoff every sanctioned writer already refuses to write one
// (`adjust-stock.ts` step 2, `complete-build.ts:228`, `receiveStock`), so a
// movement missing `occurred_at`, `unit_cost`, `extended_cost` or its inventory
// role means something wrote outside those doors. Filtering it would produce a
// balanced entry that understates inventory with NO SIGNAL — the exact failure
// this module exists to refuse, reintroduced on the other side of the line.
//
// **B. Period membership is the ACCOUNTING date, in the BOOK TIMEZONE.**
// `stock_movement_occurred_at` and `build_completed_at`, never `createdAt`.
// `createdAt` records when auxx.ai learned about a row and is audit evidence, not
// its accounting date. A receipt logged at 7pm on January 31 in
// `America/New_York` is already February 1 in UTC, so the window boundaries are
// computed as INSTANTS from wall-clock midnights in `bookTimeZone`.
//
// **C. Both lanes are CUMULATIVE from the cutoff, never per-period.** A build
// dated in January but entered after the January close must appear in the next
// open entry still carrying its own frozen labour and overhead. That only works
// because both lanes sum from the cutoff through the period end and the builder
// takes the delta against the prior snapshot. Never sum "movements in this
// month".
//
// ── What this file deliberately excludes, and why ───────────────────────────
//
// `stock_movement_adjust_subparts = true` rows — the PARENT of a bill-of-
// materials explosion — are excluded from both the sums and the fail-closed
// scan. `explodeBomMovement` writes one child movement per component and the
// children carry the real quantities, which is why `recalculateQoHForPart`
// excludes the parent from the quantity ledger too
// (`field-hooks/post/inventory-triggers.ts`, the `fv_flag` predicate). Summing
// both would double-count, and failing the close on a parent that is not
// supposed to carry a cost would block every close for a legitimate write. The
// CHILDREN are not excluded: `explodeBomMovement` writes them with no cost
// fields at all, so post-cutoff they trip rule A — correctly, because an
// uncosted movement that does move quantity is precisely the thing rule A is
// for.
//
// No permission checks anywhere here. The router asserts
// (`docs/lib-module-guide.md` section 6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { fromZonedTime } from 'date-fns-tz'
import { and, desc, eq, gte, isNull, lt, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { AuxxError, BadRequestError, UnprocessableEntityError } from '../errors'
import type { MonthEndInventoryInputs } from './build-month-end-inventory'
import { type MonthEndInventorySnapshot, parsePostingDraft } from './draft'
import { readOpeningBaseline } from './opening-baseline'
import { compareMonths, parsePeriodKey, periodKeyForDate } from './periods'

const logger = createScopedLogger('postings:gather-month-end-inventory')

/** The three inventory roles a movement's frozen `gl_account` may name. */
const INVENTORY_ROLES = [
  'inventory_raw_materials',
  'inventory_wip',
  'inventory_finished_goods',
] as const

type InventoryRole = (typeof INVENTORY_ROLES)[number]

/**
 * An aliased `FieldValue` table, as `alias()` returns it.
 *
 * Widened over the alias NAME on purpose: `alias(t, 'mv_gl')` and
 * `alias(t, 'mv_type')` have different types, so a join predicate helper typed
 * against one of them cannot accept the others.
 */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/** The movement attributes this reader needs. Every one is required. */
const MOVEMENT_ATTRIBUTES = [
  'stock_movement_type',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
  'stock_movement_adjust_subparts',
] as const

/** The build attributes this reader needs. */
const BUILD_ATTRIBUTES = ['build_labor_cost', 'build_overhead_cost', 'build_completed_at'] as const

/** How many offending movement ids an error message names before it stops. */
const MAX_NAMED_OFFENDERS = 10

/**
 * Gather everything the L1 month-end inventory entry for `periodKey` is computed
 * from.
 *
 * The returned {@link MonthEndInventoryInputs} is a flat record of integers, so
 * the pure builder that consumes it needs no database and every golden test can
 * construct one by hand.
 *
 * @param db The database handle. Reads only — nothing here writes.
 * @param organizationId The organization whose books are being closed.
 * @param periodKey The accounting MONTH being closed, `'2026-08'`. A day key is
 * refused: this entry summarizes a month.
 *
 * @returns The inputs, or an {@link UnprocessableEntityError} that names the
 * exact row, setting or movement to fix. Nothing here is ever defaulted,
 * skipped, or coerced to zero.
 */
export async function gatherMonthEndInventoryInputs(
  db: Database,
  organizationId: string,
  periodKey: string
): Promise<Result<MonthEndInventoryInputs, Error>> {
  try {
    const baselineResult = await readOpeningBaseline(organizationId)
    if (baselineResult.isErr()) return err(baselineResult.error)
    const { cutoffPeriod, bookTimeZone, balances: openingBalances } = baselineResult.value

    const month = requireMonthKey(periodKey)
    if (compareMonths(month, cutoffPeriod) <= 0) {
      return err(
        new UnprocessableEntityError(
          `Cannot close ${month}: the accounting cutoff is ${cutoffPeriod}, so ${month} is ` +
            'covered by the frozen opening balances rather than by the subledger. Close a ' +
            'month after the cutoff.',
          { organizationId, periodKey: month, cutoffPeriod }
        )
      )
    }

    // The half-open instant window `[start, end)`, both derived from wall-clock
    // midnights in the BOOK timezone. Expressed as "the first instant of the
    // month after" on both ends rather than "the last instant of" — the latter
    // needs a fictional 23:59:59.999 that a leap second or a sub-millisecond
    // timestamp can fall outside of.
    const windowStart = monthStartInstant(nextMonth(cutoffPeriod), bookTimeZone)
    const windowEnd = monthStartInstant(nextMonth(month), bookTimeZone)

    // The last DAY of the period, in the book timezone: the instant one
    // millisecond before the window closes, formatted through the same helper
    // every other period derivation uses. A calendar month's last day number is
    // zone-independent, but routing it through `periodKeyForDate` means this
    // date and the window boundaries cannot disagree.
    const txnDate = periodKeyForDate(new Date(windowEnd.getTime() - 1), 'day', bookTimeZone)

    const [prior, movements, absorption] = await Promise.all([
      readPriorSnapshot(db, organizationId, month, openingBalances),
      readMovementTotals(db, organizationId, windowStart, windowEnd),
      readAbsorptionTotals(db, organizationId, windowStart, windowEnd),
    ])

    const current: MonthEndInventorySnapshot = {
      balances: {
        inventory_raw_materials:
          openingBalances.inventory_raw_materials + movements.byRole.inventory_raw_materials,
        inventory_wip: openingBalances.inventory_wip + movements.byRole.inventory_wip,
        inventory_finished_goods:
          openingBalances.inventory_finished_goods + movements.byRole.inventory_finished_goods,
      },
      activityTotals: {
        absorbedLabor: absorption.absorbedLabor,
        absorbedOverhead: absorption.absorbedOverhead,
        inventoryAdjustments: movements.inventoryAdjustments,
      },
    }

    return ok({ periodKey: month, txnDate, prior, current })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to gather month-end inventory inputs', {
      error,
      organizationId,
      periodKey,
    })
    return err(new AuxxError('Internal error'))
  }
}

// ── The period ─────────────────────────────────────────────────────────────

/**
 * `periodKey` must be a MONTH key.
 *
 * A day key is refused rather than widened to the month containing it: this
 * entry summarizes a month, and silently accepting `'2026-08-18'` would let a
 * caller believe it closed the 18th while the arithmetic closed August.
 */
function requireMonthKey(periodKey: string): string {
  const parsed = parsePeriodKey(periodKey)
  if (parsed.granularity !== 'month') {
    throw new BadRequestError(
      `The month-end inventory entry closes a month, not a day - "${periodKey}" is a date. ` +
        'Pass a YYYY-MM period key.',
      { periodKey }
    )
  }
  return periodKey
}

/** `'2026-12'` -> `'2027-01'`. Month keys are zero-padded, so December rolls. */
function nextMonth(monthKey: string): string {
  const { year, month } = parsePeriodKey(monthKey)
  const nextYear = month === 12 ? year + 1 : year
  const next = month === 12 ? 1 : month + 1
  return `${String(nextYear).padStart(4, '0')}-${String(next).padStart(2, '0')}`
}

/**
 * The INSTANT at which `monthKey` begins in `timeZone`.
 *
 * This is rule B made mechanical. `fromZonedTime` reads the wall-clock string as
 * local to the zone and returns the UTC instant it corresponds to, which is the
 * same `date-fns-tz` call `workflow-engine/nodes/wait/*` and `sequences/anchor`
 * already use for exactly this. Hand-rolled offset arithmetic gets DST wrong
 * roughly twice a year, and one of those two times is inside a month boundary.
 */
function monthStartInstant(monthKey: string, timeZone: string): Date {
  const instant = fromZonedTime(`${monthKey}-01T00:00:00`, timeZone)
  if (Number.isNaN(instant.getTime())) {
    throw new UnprocessableEntityError(
      `Could not place the start of ${monthKey} in the book timezone "${timeZone}"`,
      { periodKey: monthKey, timeZone }
    )
  }
  return instant
}

// ── The prior snapshot ─────────────────────────────────────────────────────

/**
 * What the previous effective posting asserted about the world after itself.
 *
 * The selection rule is exact and load-bearing: the `posted`
 * `month_end_inventory` row with the greatest `periodKey` STRICTLY BEFORE this
 * period, then the greatest `revision` within that period. The original of a
 * reversal pair is `reversed` and drops out; its effective reversal or re-entry
 * is `posted`. Every revision carries the balances resulting AFTER itself, so
 * the highest posted revision of the latest earlier period is the one number the
 * delta may be measured from.
 *
 * The `<` is a plain string compare, which is exact for zero-padded `YYYY-MM`
 * and is the same property `compareMonths` relies on.
 *
 * 🛑 **A prior row whose draft carries no assertions is a CORRUPT CHAIN and
 * fails the close, naming the document.** It must NOT fall back to the opening
 * baseline: that would silently restate every month between the cutoff and now
 * into one entry, which balances perfectly and is invisible until somebody
 * reconciles by hand. `postEntry` refuses to claim a `month_end_inventory`
 * without assertions (`draft.ts`'s `requiresAssertions`), so such a row can only
 * have been written by something that bypassed it.
 */
async function readPriorSnapshot(
  db: Database,
  organizationId: string,
  periodKey: string,
  openingBalances: MonthEndInventorySnapshot['balances']
): Promise<MonthEndInventorySnapshot> {
  const [row] = await db
    .select({
      docNumber: schema.GlPosting.docNumber,
      periodKey: schema.GlPosting.periodKey,
      revision: schema.GlPosting.revision,
      draft: schema.GlPosting.draft,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'month_end_inventory'),
        eq(schema.GlPosting.status, 'posted'),
        lt(schema.GlPosting.periodKey, periodKey)
      )
    )
    .orderBy(desc(schema.GlPosting.periodKey), desc(schema.GlPosting.revision))
    .limit(1)

  // The cutover. No previous posting exists, so the prior IS the frozen
  // reconciled opening baseline — and its activity totals are all zero, because
  // nothing has been absorbed or adjusted since a cutoff that has only just
  // happened. This never assumes zero BALANCES and never manufactures a
  // synthetic `GlPosting` for an entry auxx.ai did not post.
  if (!row) {
    return {
      balances: { ...openingBalances },
      activityTotals: { absorbedLabor: 0, absorbedOverhead: 0, inventoryAdjustments: 0 },
    }
  }

  const draft = parsePostingDraft(row.draft)
  if (!draft.assertions) {
    throw new UnprocessableEntityError(
      `The previous month-end inventory posting ${row.docNumber} (${row.periodKey} revision ` +
        `${row.revision}) carries no balance assertions, so there is nothing for ${periodKey} ` +
        'to measure its delta against. The assertion chain is broken and must be repaired ' +
        'before another close; falling back to the opening baseline here would silently ' +
        'restate every month since the cutoff into one entry.',
      { organizationId, periodKey, priorDocNumber: row.docNumber, priorPeriodKey: row.periodKey }
    )
  }

  return draft.assertions.after
}

// ── The movement ledger ────────────────────────────────────────────────────

interface MovementTotals {
  /** Σ signed `extendedCost` per inventory role, over the window. */
  byRole: Record<InventoryRole, number>
  /** The same sum restricted to `adjust`. SIGNED — negative is shrinkage. */
  inventoryAdjustments: number
}

/**
 * The cumulative movement totals from the cutoff through the period end.
 *
 * `inventoryAdjustments` is a SEPARATE total, not a subtraction from the
 * balances: an `adjust` movement legitimately appears in both. It moved
 * inventory (so it belongs in the balance) and `G12` requires count and
 * shrinkage to be classified into their own role rather than buried in the COGS
 * plug (so it belongs in its own total too). The builder's 5095 lane and its
 * inventory lanes are different legs of the same entry, and the plug absorbs the
 * difference.
 *
 * Aggregated in SQL, in one pass over the window, because this runs over the
 * whole ledger from the cutoff forward and grows every month.
 */
async function readMovementTotals(
  db: Database,
  organizationId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<MovementTotals> {
  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!movementDefId) {
    throw new UnprocessableEntityError(
      'This organization has no stock movement entity definition, so its inventory balance ' +
        'cannot be read from the subledger',
      { organizationId }
    )
  }

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...MOVEMENT_ATTRIBUTES])) as Record<
    (typeof MOVEMENT_ATTRIBUTES)[number],
    { id: string } | null
  >

  const required = [
    'stock_movement_type',
    'stock_movement_unit_cost',
    'stock_movement_extended_cost',
    'stock_movement_gl_account',
    'stock_movement_occurred_at',
  ] as const
  const missing = required.filter((attribute) => !fields[attribute])
  if (missing.length > 0) {
    throw new UnprocessableEntityError(
      `Closing the books is not available until the stock movement costing fields are ` +
        `provisioned. Missing: ${missing.join(', ')}.`,
      { organizationId, missing }
    )
  }

  const occurredAt = alias(schema.FieldValue, 'mv_occurred')
  const extendedCost = alias(schema.FieldValue, 'mv_extended')
  const unitCost = alias(schema.FieldValue, 'mv_unit')
  const glAccount = alias(schema.FieldValue, 'mv_gl')
  const movementType = alias(schema.FieldValue, 'mv_type')
  const explosionParent = alias(schema.FieldValue, 'mv_explode')

  /** `EntityInstance` -> its `FieldValue` row for one field. */
  const on = (table: FieldValueAlias, fieldId: string): SQL | undefined =>
    and(
      eq(table.entityId, schema.EntityInstance.id),
      eq(table.organizationId, schema.EntityInstance.organizationId),
      eq(table.fieldId, fieldId)
    )

  /** Every live, non-explosion-parent movement in the org. */
  const scope = and(
    eq(schema.EntityInstance.organizationId, organizationId),
    eq(schema.EntityInstance.entityDefinitionId, movementDefId),
    isNull(schema.EntityInstance.archivedAt),
    // See the module header: the parent of a BOM explosion carries no quantity
    // of its own and is excluded from the quantity ledger for the same reason.
    or(isNull(explosionParent.valueBoolean), eq(explosionParent.valueBoolean, false))
  )

  // `valueDate` is `timestamp with time zone`, so this is an INSTANT comparison
  // against two instants derived from wall-clock midnights in the book timezone
  // — rule B, discharged by the boundaries rather than by anything per-row.
  const inWindow = and(
    gte(occurredAt.valueDate, windowStart.toISOString()),
    lt(occurredAt.valueDate, windowEnd.toISOString())
  )

  // ── Rule A, first and on its own ──────────────────────────────────────────
  //
  // A movement counts as an offender when it is inside the window and missing a
  // cost or a role, OR when it has no accounting date at all but was LEARNED OF
  // after the window opened.
  //
  // 🛑 That second clause is the only place `createdAt` appears in this file, and
  // it is not a period classification — it is the answer to "is this undateable
  // row recent enough to be a defect?". A movement with no `occurred_at` cannot
  // be placed in any period, so the window predicate cannot see it at all; a
  // reader that stopped at the window predicate would therefore drop it in
  // silence, which is precisely the balanced-but-understated entry rule A
  // exists to refuse. Rows created before the window opened stay ignored — they
  // are the pre-costing history the opening snapshot replaces.
  //
  // Every join below is a LEFT join, on purpose. An INNER join on the cost
  // fields would make an uncosted movement invisible to this query — which is
  // rule A's failure mode expressed in SQL rather than in code.
  const offenders = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .leftJoin(explosionParent, on(explosionParent, fields.stock_movement_adjust_subparts?.id ?? ''))
    .leftJoin(occurredAt, on(occurredAt, fields.stock_movement_occurred_at!.id))
    .leftJoin(extendedCost, on(extendedCost, fields.stock_movement_extended_cost!.id))
    .leftJoin(unitCost, on(unitCost, fields.stock_movement_unit_cost!.id))
    .leftJoin(glAccount, on(glAccount, fields.stock_movement_gl_account!.id))
    .where(
      and(
        scope,
        or(
          and(
            inWindow,
            or(
              isNull(extendedCost.valueNumber),
              isNull(unitCost.valueNumber),
              isNull(glAccount.valueText),
              sql`length(trim(coalesce(${glAccount.valueText}, ''))) = 0`,
              notInArray(glAccount.valueText, [...INVENTORY_ROLES])
            )
          ),
          and(isNull(occurredAt.valueDate), gte(schema.EntityInstance.createdAt, windowStart))
        )
      )
    )
    .limit(MAX_NAMED_OFFENDERS + 1)

  if (offenders.length > 0) {
    const named = offenders.slice(0, MAX_NAMED_OFFENDERS).map((row) => row.id)
    const more = offenders.length > MAX_NAMED_OFFENDERS ? ' (and more)' : ''
    throw new UnprocessableEntityError(
      `Cannot close the books: ${named.length}${more} stock movement(s) written after the ` +
        'accounting cutoff have no accounting date, no frozen cost, or no inventory role. ' +
        'Every sanctioned writer refuses to write one, so these were written outside those ' +
        'doors. They are refused rather than skipped, because skipping them produces a ' +
        `journal entry that balances and understates inventory with no signal. Movements: ${named.join(', ')}${more}.`,
      { organizationId, movementIds: named }
    )
  }

  // ── The sums ──────────────────────────────────────────────────────────────
  const rows = await db
    .select({
      role: glAccount.valueText,
      total: sql<string | number>`coalesce(sum(${extendedCost.valueNumber}), 0)`,
      adjustTotal: sql<
        string | number
      >`coalesce(sum(${extendedCost.valueNumber}) filter (where ${movementType.optionId} = 'adjust'), 0)`,
    })
    .from(schema.EntityInstance)
    .leftJoin(explosionParent, on(explosionParent, fields.stock_movement_adjust_subparts?.id ?? ''))
    .innerJoin(occurredAt, on(occurredAt, fields.stock_movement_occurred_at!.id))
    .innerJoin(extendedCost, on(extendedCost, fields.stock_movement_extended_cost!.id))
    .innerJoin(glAccount, on(glAccount, fields.stock_movement_gl_account!.id))
    .leftJoin(movementType, on(movementType, fields.stock_movement_type!.id))
    .where(and(scope, inWindow))
    .groupBy(glAccount.valueText)

  const byRole: Record<InventoryRole, number> = {
    inventory_raw_materials: 0,
    inventory_wip: 0,
    inventory_finished_goods: 0,
  }
  let inventoryAdjustments = 0

  for (const row of rows) {
    const role = row.role
    // Unreachable: the offender scan above already refused every movement whose
    // role is absent or is not one of the three. Kept as a hard stop rather than
    // a silent `continue`, because a `continue` here would be rule A defeated by
    // a later edit to that scan.
    if (!role || !isInventoryRole(role)) {
      throw new UnprocessableEntityError(
        `Stock movements after the accounting cutoff carry the unknown inventory role ` +
          `"${String(role)}". Only ${INVENTORY_ROLES.join(', ')} may value the books.`,
        { organizationId, role: String(role) }
      )
    }
    byRole[role] += toMinorUnits(row.total, `${role} balance`)
    inventoryAdjustments += toMinorUnits(row.adjustTotal, 'inventory adjustments')
  }

  return { byRole, inventoryAdjustments }
}

function isInventoryRole(value: string): value is InventoryRole {
  return (INVENTORY_ROLES as readonly string[]).includes(value)
}

// ── The build rows ─────────────────────────────────────────────────────────

interface AbsorptionTotals {
  absorbedLabor: number
  absorbedOverhead: number
}

/**
 * Cumulative absorbed labour and overhead from the cutoff through the period
 * end, read from the FROZEN `build_labor_cost` / `build_overhead_cost`.
 *
 * 🛑 **Not from the movement ledger, and that is not an oversight.** A movement
 * freezes one total `unit_cost` and has no labour or overhead column, so the
 * split is not in there to recover. Re-deriving it from the part's CURRENT
 * `standardLaborCost` would value last month's production at this month's rates
 * — the restatement the frozen-cost rule exists to prevent.
 *
 * ⚠️ **Reversals are NOT filtered, deliberately.** `reverse-build.ts` writes a
 * NEGATED `build_labor_cost` onto a second build row, so the cumulative sum nets
 * a reversal out on its own. Filtering reversals would double-count the
 * correction: the original's absorption would stay in the total AND the negation
 * that cancels it would be gone.
 *
 * Membership is `build_completed_at`, in the book timezone, for the reason in
 * rule B. A planned or in-progress build has no completion date and contributes
 * nothing, which is correct — `B2` says a planned build writes no movements
 * either.
 */
async function readAbsorptionTotals(
  db: Database,
  organizationId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<AbsorptionTotals> {
  const buildDefId = await getCachedEntityDefId(organizationId, 'build')
  // An org with no build entity has produced nothing, so it has absorbed
  // nothing. Zero here is a real answer, not a default standing in for one.
  if (!buildDefId) return { absorbedLabor: 0, absorbedOverhead: 0 }

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BUILD_ATTRIBUTES])) as Record<
    (typeof BUILD_ATTRIBUTES)[number],
    { id: string } | null
  >

  if (!fields.build_completed_at || !fields.build_labor_cost || !fields.build_overhead_cost) {
    throw new UnprocessableEntityError(
      'Closing the books is not available until the build absorption fields ' +
        '(build_completed_at, build_labor_cost, build_overhead_cost) are provisioned.',
      { organizationId }
    )
  }

  const completedAt = alias(schema.FieldValue, 'b_completed')
  const laborCost = alias(schema.FieldValue, 'b_labor')
  const overheadCost = alias(schema.FieldValue, 'b_overhead')

  const on = (table: FieldValueAlias, fieldId: string): SQL | undefined =>
    and(
      eq(table.entityId, schema.EntityInstance.id),
      eq(table.organizationId, schema.EntityInstance.organizationId),
      eq(table.fieldId, fieldId)
    )

  const [row] = await db
    .select({
      labor: sql<string | number>`coalesce(sum(${laborCost.valueNumber}), 0)`,
      overhead: sql<string | number>`coalesce(sum(${overheadCost.valueNumber}), 0)`,
    })
    .from(schema.EntityInstance)
    .innerJoin(completedAt, on(completedAt, fields.build_completed_at.id))
    .leftJoin(laborCost, on(laborCost, fields.build_labor_cost.id))
    .leftJoin(overheadCost, on(overheadCost, fields.build_overhead_cost.id))
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, buildDefId),
        isNull(schema.EntityInstance.archivedAt),
        gte(completedAt.valueDate, windowStart.toISOString()),
        lt(completedAt.valueDate, windowEnd.toISOString())
      )
    )

  return {
    absorbedLabor: toMinorUnits(row?.labor ?? 0, 'absorbed labour'),
    absorbedOverhead: toMinorUnits(row?.overhead ?? 0, 'absorbed overhead'),
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Coerce one aggregate to integer minor units.
 *
 * `FieldValue.valueNumber` is `double precision`, so `SUM` comes back as a
 * float and — depending on the driver and the aggregate — as a number or a
 * string. Every stored cost is a whole number of minor units, so a sum of them
 * is exact well past any balance this ledger will hold; `Math.round` is here to
 * absorb float representation, not to make a fractional cent go away. A value
 * that is not finite is refused rather than rounded: `NaN` propagates silently
 * through the builder's subtraction and would surface naming an account role
 * rather than the sum that poisoned it.
 */
function toMinorUnits(value: string | number, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    throw new UnprocessableEntityError(
      `The ${label} total read from the subledger is not a finite number (${String(value)})`,
      { field: label, value: String(value) }
    )
  }
  return Math.round(numeric)
}
