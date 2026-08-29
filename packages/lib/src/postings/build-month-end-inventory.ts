// packages/lib/src/postings/build-month-end-inventory.ts
//
// The L1 month-end inventory entry. One entry per month turns the subledger into
// the general ledger; under L1 no receipt, no build and no shipment posts
// individually, so this is the ENTIRE GL surface for inventory at cutover
// (plans/money/04-books.md §2.1).
//
// PURE. No database, no provider, no clock, no io. Every value it needs arrives
// in `MonthEndInventoryInputs`, which is a flat record of integers a golden test
// can build by hand. `gatherMonthEndInventoryInputs` does the reads; this file
// does the arithmetic. They are split because they fail differently: a read
// failure is a runtime condition, an arithmetic failure is a bug.
//
// Which is why this file THROWS `AuxxError` subclasses rather than returning a
// `Result`, exactly as `build-entry.ts` does and for the same reason: per
// docs/lib-module-guide.md `Result` is for runtime failure, and an entry that
// cannot balance its own arithmetic is not a runtime failure - it is a
// programmer error that must stop, loudly, before anything is persisted.
//
// ── The two source lanes, and why there are two ─────────────────────────────
//
// The inventory BALANCES come from the movement ledger: the frozen reconciled
// opening snapshot plus Σ signed `extendedCost` over eligible post-cutoff
// movements, grouped by each movement's own frozen `stock_movement_gl_account`.
//
// The ABSORPTION totals do NOT. A `stock_movement` freezes a single total
// `unit_cost` and carries no labour or overhead column, so the split cannot be
// recovered from the ledger at all; re-deriving it from the part's CURRENT
// `standardLaborCost` would value last month's production at this month's rates,
// which is the restatement the frozen-cost rule exists to prevent. The split IS
// frozen, on the build: `build_labor_cost` and `build_overhead_cost`. That is a
// property of the design, not an accident, and it is why the reader has two
// lanes instead of one.
//
// ⚠️ Those two build fields carry `updatable: false`, but that flag is ADVISORY -
// it is read by the grid cell and the connector catalog and by nothing on the
// write path. The guarantee this builder relies on is "only `completeBuild` and
// `reverseBuild` write them", NOT "the database refuses an update". That is a
// materially weaker claim than `GlPostingLine`'s structural immutability and it
// is worth knowing which one is holding the entry up.
//
// ── Everything here is a DELTA, and the deltas are CUMULATIVE ───────────────
//
// The entry posts `target − what we last asserted`, never the balance itself.
// `prior` is what the previous effective posting asserted (or, at cutover, the
// opening baseline); `current` is the cumulative state gathered through this
// period end. Both activity totals are cumulative from the opening cutoff, NOT
// the amounts in this one entry - that is what lets a build or an adjustment
// entered after its accounting month has closed show up in the next open entry
// still carrying its own frozen labour, overhead and 5095 classification,
// instead of disappearing into the COGS plug.
//
// 🛑 A delta is only computable because auxx.ai is the ONLY writer of
// 1310/1320/1330 in the GL (README §4.1). This is the cash value of "L1 or L3,
// never both": the moment something else posts to those accounts the delta is a
// lie, and nothing in this engine can detect it.
//
// ── 🛑 THE SIGN TABLE - three lanes, three DIFFERENT mappings ───────────────
//
// | Lane                                          | Positive delta | Negative delta |
// | --------------------------------------------- | -------------- | -------------- |
// | `inventory_raw_materials`   (balance)          | **Debit**      | Credit         |
// | `inventory_wip`             (balance)          | **Debit**      | Credit         |
// | `inventory_finished_goods`  (balance)          | **Debit**      | Credit         |
// | `payroll_clearing`          (absorbedLabor)    | **Credit**     | Debit          |
// | `applied_overhead`          (absorbedOverhead) | **Credit**     | Debit          |
// | `inventory_count_variance`  (adjustments)      | **Credit**     | Debit          |
//
// `amount` is always `Math.abs(delta)`; the sign lives in `direction` and
// nowhere else.
//
// 🛑 **The balance gate CANNOT catch a sign mistake here.** 5000 is the plug, so
// flipping any one lane's direction is absorbed by the plug at twice the error
// and `buildEntry` returns happily. A property test cannot catch it either, for
// the same reason. The ONLY guard is the exact per-lane, per-sign golden tests
// in `__tests__/build-month-end-inventory.test.ts`. If you change a direction
// here and a golden test does not go red, the test file is broken, not lenient.
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
// - **No `5090` / PPV leg.** Under L1 nothing posts to 5090 during the year and
//   the variance is not computable from a receipt anyway: `receive-stock.ts`
//   stamps `cost_basis: 'actual'` and never reads `part_standard_cost`, so there
//   is no standard/actual pair on the row to difference. PPV is a REPORT
//   (`G10` as amended, `plans/money/design/costing-facts.md`).
// - **No provider, and no provider id** (`G1`). A builder emits roles; the
//   resolver in front of the claim maps a role to the org's own account.
// - **No 1320 leg in practice.** WIP is structurally zero: every movement writer
//   resolves through `resolveInventoryRoleForPartKind`, whose range is two
//   values, and a build's consume and produce movements commit together at
//   completion (`B2`, `B8`). The lane is built anyway so it works the day that
//   stops being true - a zero delta simply drops out below.

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import type { MonthEndInventorySnapshot, PostingAssertions } from './draft'
import type { BuiltEntry, GlPostingLineInput, PostingDirection } from './types'

/**
 * Everything the month-end entry is computed from. A flat record of integers -
 * no rows, no ids, nothing that needs a database to construct.
 */
export interface MonthEndInventoryInputs {
  /** The accounting period this entry closes, e.g. `'2026-08'`. */
  periodKey: string
  /**
   * `YYYY-MM-DD` - the last day of `periodKey` in the org's book timezone.
   *
   * GIVEN, never computed here. The timezone is the required
   * `accounting.bookTimeZone` setting, read once by the caller and passed down,
   * so a test can pin it and so this file stays free of a clock. There is no
   * UTC fallback anywhere in this subsystem, deliberately.
   */
  txnDate: string
  /**
   * What the previous effective posting asserted about the world after itself -
   * or, at cutover, the frozen reconciled opening baseline.
   *
   * 🛑 Never zero-by-default. The first close reads
   * `accounting.opening*`; it does not assume zero and does not manufacture a
   * synthetic `GlPosting` for an entry auxx.ai did not post.
   */
  prior: MonthEndInventorySnapshot
  /** The cumulative state gathered through this period end. */
  current: MonthEndInventorySnapshot
}

/**
 * The built entry plus the assertion metadata the poster persists into
 * `GlPosting.draft`.
 *
 * The entry stays usable by the generic poster; the assertions are the month-end
 * contract around it, and they are what the NEXT month's delta is computed from.
 */
export interface BuiltMonthEndInventoryDraft {
  entry: BuiltEntry
  assertions: PostingAssertions
}

/** Both halves of every posting line's audit pair, in one place. */
const SOURCE_TYPE = 'month_end_inventory'

/** One delta lane, before it becomes a line. */
interface Lane {
  accountRole: string
  /** `current − prior` for this lane. Signed. */
  delta: number
  /** The direction a POSITIVE delta takes. See the sign table in the header. */
  positiveDirection: PostingDirection
  memo: string
}

function assertMinorUnits(amount: unknown, label: string): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new UnprocessableEntityError(
      `${label} must be an integer number of minor units, got ${String(amount)}`,
      { field: label, value: String(amount) }
    )
  }
  return amount
}

/**
 * Validate one side's six numbers before any arithmetic touches them.
 *
 * Named per field, because the repair is always "which number is wrong" and
 * `NaN` propagates silently through subtraction: `NaN − 0` is `NaN`,
 * `Math.abs(NaN)` is `NaN`, and `buildEntry` would then reject the entry naming
 * a ROLE rather than the input that poisoned it. One useless error message per
 * close is one too many when the reader is somebody trying to close the books.
 */
function assertSnapshot(snapshot: MonthEndInventorySnapshot, label: string): void {
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new UnprocessableEntityError(`${label} is missing`, { field: label })
  }
  const { balances, activityTotals } = snapshot
  if (typeof balances !== 'object' || balances === null) {
    throw new UnprocessableEntityError(`${label}.balances is missing`, {
      field: `${label}.balances`,
    })
  }
  if (typeof activityTotals !== 'object' || activityTotals === null) {
    throw new UnprocessableEntityError(`${label}.activityTotals is missing`, {
      field: `${label}.activityTotals`,
    })
  }
  assertMinorUnits(balances.inventory_raw_materials, `${label}.balances.inventory_raw_materials`)
  assertMinorUnits(balances.inventory_wip, `${label}.balances.inventory_wip`)
  assertMinorUnits(balances.inventory_finished_goods, `${label}.balances.inventory_finished_goods`)
  assertMinorUnits(activityTotals.absorbedLabor, `${label}.activityTotals.absorbedLabor`)
  assertMinorUnits(activityTotals.absorbedOverhead, `${label}.activityTotals.absorbedOverhead`)
  assertMinorUnits(
    activityTotals.inventoryAdjustments,
    `${label}.activityTotals.inventoryAdjustments`
  )
}

/** The sign table, applied. A negative delta flips the lane's direction. */
function directionFor(lane: Lane): PostingDirection {
  const flipped: PostingDirection = lane.positiveDirection === 'debit' ? 'credit' : 'debit'
  return lane.delta > 0 ? lane.positiveDirection : flipped
}

/**
 * Build the L1 month-end inventory entry:
 *
 * ```
 * Dr/Cr inventory_raw_materials     Δ raw materials balance
 * Dr/Cr inventory_wip               Δ WIP balance                 (omitted - structurally 0)
 * Dr/Cr inventory_finished_goods    Δ finished goods balance
 * Dr/Cr payroll_clearing            Δ cumulative absorbed labour
 * Dr/Cr applied_overhead            Δ cumulative absorbed overhead
 * Dr/Cr inventory_count_variance    Δ cumulative count adjustments
 * Dr/Cr cogs_product_cost           whatever balances the six above
 * ```
 *
 * **5000 is the PLUG, and that is what makes the entry self-correcting.** The
 * balance is ASSERTED, not accumulated, so a miscoded purchase distorts one
 * month and washes out the next. It is named "product cost" rather than
 * "materials" because it holds direct materials plus the labour and overhead
 * embedded in whatever finished goods shipped - a movement freezes only a total
 * unit cost, so no defensible COGS-labour split can be reconstructed and calling
 * this line "materials" would be false on the P&L.
 *
 * `5095` is broken out of that plug rather than buried in it, because `G12`
 * requires count and shrinkage adjustments to post to their own role separately
 * from PPV: they have different owners, different remedies and different trends,
 * and one account holding both answers neither question. Under L1 nothing posts
 * per-event, so a separate leg inside the monthly entry is the only way to
 * honour it.
 *
 * Zero legs are dropped before `buildEntry` sees them. That is not tidiness:
 * `buildEntry` rejects a zero amount outright, and a zero-amount leg against a
 * role the org has not mapped - 1320 WIP, which no code path can reach - would
 * fail the resolver, or force an account into the chart and into every
 * provider's chart, for no information at all.
 *
 * Lines are ordered debits first, then credits, stable within each side in the
 * sign table's order, with the plug last on its side. That is journal-entry
 * presentation order and this is the entry a CPA reads.
 *
 * @throws {UnprocessableEntityError} on a non-integer or non-finite input
 * (naming the field), on a month in which literally nothing moved, or - via
 * {@link buildEntry} - on an entry that does not balance.
 */
export function buildMonthEndInventoryEntry(
  inputs: MonthEndInventoryInputs
): BuiltMonthEndInventoryDraft {
  const { periodKey, txnDate, prior, current } = inputs

  assertSnapshot(prior, 'prior')
  assertSnapshot(current, 'current')

  const lanes: Lane[] = [
    {
      accountRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      delta: current.balances.inventory_raw_materials - prior.balances.inventory_raw_materials,
      positiveDirection: 'debit',
      memo: 'Raw materials balance change',
    },
    {
      accountRole: ACCOUNT_ROLES.INVENTORY_WIP,
      delta: current.balances.inventory_wip - prior.balances.inventory_wip,
      positiveDirection: 'debit',
      memo: 'Work in process balance change',
    },
    {
      accountRole: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      delta: current.balances.inventory_finished_goods - prior.balances.inventory_finished_goods,
      positiveDirection: 'debit',
      memo: 'Finished goods balance change',
    },
    {
      // Absorption comes OUT of the payroll pool and INTO inventory, so more
      // labour absorbed is a CREDIT here. The matching debit is already in the
      // inventory balance lanes above - it is not posted twice.
      accountRole: ACCOUNT_ROLES.PAYROLL_CLEARING,
      delta: current.activityTotals.absorbedLabor - prior.activityTotals.absorbedLabor,
      positiveDirection: 'credit',
      memo: 'Standard labour absorbed into inventory',
    },
    {
      accountRole: ACCOUNT_ROLES.APPLIED_OVERHEAD,
      delta: current.activityTotals.absorbedOverhead - prior.activityTotals.absorbedOverhead,
      positiveDirection: 'credit',
      memo: 'Overhead absorbed into inventory',
    },
    {
      // `inventoryAdjustments` is the only SIGNED total of the six. A shrinkage
      // is a negative cumulative adjustment, so a falling total is a DEBIT to
      // 5095 - an expense - which is what shrinkage is.
      accountRole: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
      delta:
        current.activityTotals.inventoryAdjustments - prior.activityTotals.inventoryAdjustments,
      positiveDirection: 'credit',
      memo: 'Inventory count and shrinkage adjustments',
    },
  ]

  let laneDebits = 0
  let laneCredits = 0
  for (const lane of lanes) {
    if (lane.delta === 0) continue
    if (directionFor(lane) === 'debit') laneDebits += Math.abs(lane.delta)
    else laneCredits += Math.abs(lane.delta)
  }

  // The plug: whatever makes the two sides equal. Positive means the six lanes
  // credit more than they debit, so 5000 takes the missing DEBIT.
  const plug = laneCredits - laneDebits
  const plugLane: Lane = {
    accountRole: ACCOUNT_ROLES.COGS_PRODUCT_COST,
    delta: plug,
    positiveDirection: 'debit',
    memo: 'Product cost of goods sold',
  }

  const all = [...lanes, plugLane].filter((lane) => lane.delta !== 0)

  // A month in which nothing moved has no entry to post. Every lane zero means
  // no balance changed, nothing was absorbed and nothing was adjusted - so
  // there is no delta to assert and the plug is zero too. Calling `buildEntry`
  // with an empty line array would throw "at least one line", which is true but
  // names the wrong thing; the caller needs to know this is a legitimate no-op
  // month and not a malformed entry.
  if (all.length === 0) {
    throw new UnprocessableEntityError(
      `Nothing moved in ${periodKey} - every inventory balance and activity total is unchanged, so there is no month-end entry to post`,
      { periodKey }
    )
  }

  const debits = all.filter((lane) => directionFor(lane) === 'debit')
  const credits = all.filter((lane) => directionFor(lane) === 'credit')

  const lines: GlPostingLineInput[] = [...debits, ...credits].map((lane, index) => ({
    accountRole: lane.accountRole,
    direction: directionFor(lane),
    amount: Math.abs(lane.delta),
    memo: lane.memo,
    sourceType: SOURCE_TYPE,
    // The period IS the source. There is no single row that produced this
    // entry - it is the whole subledger through a date - so `periodKey` is the
    // only honest audit pointer, and it is what makes the entry findable again.
    sourceId: periodKey,
    sortOrder: index,
  }))

  return {
    // `buildEntry` is the balance gate. It is redundant here - the plug is
    // computed to make the sides equal - and it is called anyway, because
    // "balances by construction" is a property of today's arithmetic and not of
    // tomorrow's edit to it.
    entry: buildEntry({ postingType: 'month_end_inventory', periodKey, txnDate, lines }),
    // Verbatim, both sides, unmodified. `after` is what next month subtracts;
    // `before` is what makes the chain testable (row N's `before` must equal row
    // N-1's `after`) and is what a reversal swaps.
    assertions: { kind: 'month_end_inventory', before: prior, after: current },
  }
}
