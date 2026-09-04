// packages/lib/src/builds/backfill-policy.ts

/**
 * What the bulk build backfill would create, for a range of demand that has
 * already happened.
 *
 * `plans/money/tasks/44-auto-build-cutoff-and-backfill.md` sections 7.1, 7.1a
 * and 7.2b, which is phase 1 of that plan's ladder (section 11.1) and the phase
 * it names as *"where the bugs are and where the testing leverage is"*.
 *
 * 🛑 **This is the whole of the decision, and it touches nothing.** No database,
 * no clock, no settings read, no writer. It is handed every order line in the
 * range, the production already committed against those parts, and the shelf,
 * and it returns the builds it would raise. The split is the one
 * `reconcile-policy.ts` / `reconcile-order-builds.ts` already make, for the same
 * reason: the painful cases here are a monthly build viewed by week, three units
 * of stock spread across eight monthly buckets, and an order placed at 7pm on
 * the last day of a month. Every one of those is a unit test only while the
 * decision needs nothing to run.
 *
 * ## The rails it exists to enforce
 *
 * - **The unit is uncovered QUANTITY, never "an order without a build"** (7.1).
 *   An order with two parts can carry a build for one and not the other, so it
 *   is neither covered nor uncovered as a whole. Orders are the input to this
 *   function and never a row in its output; rows are `(part, period)`.
 * - **On hand is consumed ONCE, earliest bucket first** (7.1). Three lifts on
 *   the shelf against eight monthly buckets is three units of coverage in total,
 *   not three per bucket. ⚠️ The obvious per-row implementation passes a
 *   single-bucket test and under-builds by `onHand x (buckets - 1)` everywhere
 *   else.
 * - **Net at the RANGE level, then distribute chronologically** (7.1a). A batch
 *   build's own period will not line up with the grouping the person is looking
 *   at — build by month, view by week, and one monthly build overlaps five
 *   weekly buckets. Netting per bucket counts it fivefold. So committed
 *   production and stock are two pools, drained earliest-bucket-first in one
 *   pass. That is also what makes {@link BackfillPlanInput.grouping} a
 *   presentation and write choice rather than an input to the arithmetic.
 * - **Committed production is `planned` and `in_progress` only** (7.1a). The
 *   caller owes this: a `completed` build's units are already in
 *   `part_quantity_on_hand` through its `build_produce` movement, so counting it
 *   as coverage *and* subtracting on hand counts the same production twice.
 *   Nothing here can detect the mistake, which is why
 *   {@link BackfillCoverage} says it too.
 * - **Bucketing is in the BOOK timezone** (`input.timeZone`). An order placed at
 *   7pm on January 31 in `America/New_York` is already February 1 in UTC, and
 *   bucketing it in UTC dates its build to the wrong accounting month. Same rule
 *   and the same `date-fns-tz` round-trip as `postings/periods.ts` and
 *   `resources/aggregate/date-buckets.ts`; hand-rolled offset arithmetic gets
 *   DST wrong roughly twice a year.
 * - **Never throws.** Total on every input, including a line with a `NaN`
 *   quantity, an invalid `placedAt`, or a negative `part_quantity_on_hand` —
 *   which is not hypothetical, section 5 records -280 across all 22 components
 *   of the org this was written for.
 *
 * ## What it deliberately does NOT do
 *
 * - **No permission check, no range bound, no cutoff.** Section 7.0's rule that
 *   a batch build is only safe below `inventory.autoBuildEnabledAt` is a caller
 *   gate, exactly as the enablement window is for `planOrderBuildConvergence`:
 *   keeping it out here is what lets this file stay clock-free.
 * - **No use of {@link BackfillCoverage.appliesAt} in the arithmetic.** v1 pools
 *   coverage per part and drains it chronologically over the buckets, which is
 *   7.1a's decision; the field carries 7.1a's deferred refinement, and
 *   {@link BackfillCoverage.appliesAt} says so on the contract.
 */

import {
  addDays,
  addMonths,
  addWeeks,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type {
  BackfillBucket,
  BackfillCoverage,
  BackfillDemandLine,
  BackfillExclusion,
  BackfillExclusionReason,
  BackfillGrouping,
  BackfillPartPlan,
  BackfillPlan,
  BackfillPlanInput,
} from './backfill-types'
import { resolvePartKind } from './client'

/**
 * Decide what the backfill would build.
 *
 * The pass, per part, in this order — the same order
 * `planOrderBuildConvergence`'s `admissionDecision` takes, so the two layers
 * answer "why not" the same way:
 *
 * | state of the part | result |
 * | --- | --- |
 * | nothing actually ordered | absent from the plan entirely |
 * | `component`, or unclassified | `not-a-built-part` exclusion |
 * | built, no bill of materials | `no-bill-of-materials` exclusion |
 * | built, demand fully met by committed production | `already-covered` exclusion |
 * | built, demand fully met by the shelf alone | `covered-by-stock` exclusion |
 * | built, with demand left over | a {@link BackfillPartPlan} and its buckets |
 *
 * 🛑 **The two "nothing left to build" reasons are not interchangeable, and when
 * both pools contributed the answer is `already-covered`.** They have different
 * remedies — cancel or complete the committed builds versus sell what is on the
 * shelf — and the deciding case is the SECOND run of the dialog, where every
 * part just built is fully covered by its own new builds. Reporting those as
 * `covered-by-stock` would claim the stock room is full of units nobody has
 * made yet. So the tie-break is: coverage consumed anything at all -> the
 * committed production is what the person has to act on -> `already-covered`.
 *
 * Every exclusion carries both quantities regardless of its reason, which is
 * 7.2b's rule that a row must prove itself — `quantityOnHand` proves
 * `covered-by-stock`, `quantityCovered` proves `already-covered`, and a
 * conditional that populated only the one the reason needs would be a branch to
 * get wrong for no saving. Both are the pool AVAILABLE over the range, matching
 * {@link BackfillPartPlan.quantityCovered}, not the amount consumed — a part
 * with no surviving bucket has no per-bucket consumption to report.
 *
 * The output is deterministic — parts ascending by id, buckets chronological
 * within a part — which is what lets a test assert on the whole structure and
 * what keeps a preview stable between two runs against unchanged data.
 */
export function planBackfill(input: BackfillPlanInput): BackfillPlan {
  const lines = input.lines.filter(isUsableLine)
  const linesByPart = groupLinesByPart(lines)
  const coverageByPart = sumCoverageByPart(input.coverage)
  // One window for every part, so `'range'` names the same period on each build
  // rather than each part's own first-to-last demand.
  const wholeRange = input.grouping === 'range' ? rangeWindow(lines, input.timeZone) : null

  const parts: BackfillPartPlan[] = []
  const excluded: BackfillExclusion[] = []

  for (const partId of [...linesByPart.keys()].sort(compareIds)) {
    const partLines = linesByPart.get(partId) ?? []
    const quantityOrdered = sumQuantity(partLines)
    // A part whose every line was dropped as unusable is not demand, and a row
    // reading "0 ordered, excluded" answers a question nobody asked.
    if (quantityOrdered <= 0) continue

    const quantityOnHand = finiteOrZero(input.quantitiesOnHand.get(partId))
    const quantityCovered = coverageByPart.get(partId) ?? 0

    const reason = admissionReason(input, partId)
    if (reason) {
      excluded.push({ partId, quantityOrdered, quantityOnHand, quantityCovered, reason })
      continue
    }

    const { buckets, coverageUsed } = distribute(
      draftBuckets(partLines, input.grouping, input.timeZone, wholeRange),
      quantityCovered,
      quantityOnHand
    )
    if (buckets.length === 0) {
      // Both pools may have contributed; committed production wins the tie
      // because it is the half the person can act on.
      const reason = coverageUsed > 0 ? 'already-covered' : 'covered-by-stock'
      excluded.push({ partId, quantityOrdered, quantityOnHand, quantityCovered, reason })
      continue
    }

    parts.push({
      partId,
      quantityOrdered,
      quantityCovered,
      quantityOnHand,
      quantityToBuild: buckets.reduce((total, bucket) => total + bucket.quantityToBuild, 0),
      buckets,
    })
  }

  return {
    parts,
    excluded,
    buildCount: parts.reduce((total, part) => total + part.buckets.length, 0),
    unitCount: parts.reduce((total, part) => total + part.quantityToBuild, 0),
  }
}

/**
 * Why this part produces no build at all, or `null` when it may build.
 *
 * Kind before bill of materials, matching `admissionDecision`: a `component` is
 * purchased, so its bill of materials is never read and never has to exist.
 * Coverage is not tested here — it is not a property of the part, it is what is
 * left after {@link distribute} has drained both pools.
 */
function admissionReason(
  input: BackfillPlanInput,
  partId: string
): Extract<BackfillExclusionReason, 'not-a-built-part' | 'no-bill-of-materials'> | null {
  if (resolvePartKind(input.partKinds.get(partId)) === 'component') return 'not-a-built-part'
  if (input.hasBom.get(partId) !== true) return 'no-bill-of-materials'
  return null
}

/**
 * Drain the two pools across the buckets, earliest first, and keep what is left.
 *
 * 🛑 **This one pass is both of section 7's netting rules**, not two special
 * cases: committed production and on-hand stock are pools at the RANGE level
 * (7.1a) and each is consumed once, by the earliest bucket that wants it (7.1).
 * Coverage drains before stock because committed production is already earmarked
 * for this demand; the totals do not depend on the order, only the two reported
 * columns do.
 *
 * ⚠️ A fully-consumed bucket is dropped **after** it has taken its share. Skipping
 * it instead would hand its coverage to the next bucket and re-create the
 * per-row bug from the other direction.
 *
 * Both pools are floored at zero: a negative `part_quantity_on_hand` is a ledger
 * missing its receipts (section 5), and reading it as *negative coverage* would
 * inflate every build in the range.
 */
function distribute(
  drafts: readonly DraftBucket[],
  quantityCovered: number,
  quantityOnHand: number
): Distribution {
  let coveragePool = Math.max(0, quantityCovered)
  let stockPool = Math.max(0, quantityOnHand)
  const available = { coverage: coveragePool, stock: stockPool }

  const buckets: BackfillBucket[] = []
  for (const draft of drafts) {
    const covered = Math.min(coveragePool, draft.quantityOrdered)
    coveragePool -= covered
    const fromStock = Math.min(stockPool, draft.quantityOrdered - covered)
    stockPool -= fromStock

    const quantityToBuild = draft.quantityOrdered - covered - fromStock
    if (quantityToBuild <= 0) continue

    buckets.push({
      partId: draft.partId,
      bucketId: `${draft.partId}:${draft.id}`,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      periodKey: draft.periodKey,
      quantityOrdered: draft.quantityOrdered,
      quantityCovered: covered,
      quantityFromStock: fromStock,
      quantityToBuild,
      orderIds: [...draft.orderIds].sort(compareIds),
    })
  }
  return {
    buckets,
    coverageUsed: available.coverage - coveragePool,
    stockUsed: available.stock - stockPool,
  }
}

/**
 * What {@link distribute} did, including to the buckets it dropped.
 *
 * The two `Used` totals count consumption across EVERY draft bucket, not only
 * the surviving ones — which is the entire point of them. A part that nets to
 * nothing has no surviving bucket to read the answer off, and "which pool
 * emptied this part" is exactly the question the exclusion reason answers.
 */
interface Distribution {
  buckets: BackfillBucket[]
  /** Committed production actually consumed. Non-zero means `already-covered`. */
  coverageUsed: number
  /** On-hand stock actually consumed. */
  stockUsed: number
}

/** A bucket before any netting: what was ordered in it, and by whom. */
interface DraftBucket {
  partId: string
  /**
   * Identity within the part — the order id under `'order'`, else the period
   * key. `${partId}:${id}` is {@link BackfillBucket.bucketId}, which is unique
   * across the whole plan because a part appears in it once.
   */
  id: string
  periodKey: string
  periodStart: Date
  periodEnd: Date
  quantityOrdered: number
  orderIds: Set<string>
}

/**
 * Collapse one part's lines into the buckets the chosen grouping asks for,
 * chronologically.
 *
 * Ties are broken on the bucket's identity so that two orders placed at the same
 * instant under `'order'` grouping have a stable order between runs.
 */
function draftBuckets(
  lines: readonly BackfillDemandLine[],
  grouping: BackfillGrouping,
  timeZone: string,
  wholeRange: BucketWindow | null
): DraftBucket[] {
  const byBucket = new Map<string, DraftBucket>()

  for (const line of lines) {
    const window = windowFor(line, grouping, timeZone, wholeRange)
    const id = grouping === 'order' ? line.orderId : window.periodKey
    const existing = byBucket.get(id)
    if (!existing) {
      byBucket.set(id, {
        partId: line.partId,
        id,
        periodKey: window.periodKey,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        quantityOrdered: line.quantity,
        orderIds: new Set([line.orderId]),
      })
      continue
    }
    existing.quantityOrdered += line.quantity
    existing.orderIds.add(line.orderId)
    // Only reachable under `'order'` grouping, where the window IS one line's
    // instant: two lines of one order carrying different dates settle on the
    // earlier, rather than on whichever the reader happened to hand us first.
    if (window.periodStart.getTime() < existing.periodStart.getTime()) {
      existing.periodKey = window.periodKey
      existing.periodStart = window.periodStart
      existing.periodEnd = window.periodEnd
    }
  }

  return [...byBucket.values()].sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime() || compareIds(a.id, b.id)
  )
}

/** The demand period one build claims. Half-open: `periodStart` in, `periodEnd` out. */
interface BucketWindow {
  periodKey: string
  periodStart: Date
  periodEnd: Date
}

/**
 * The window one line falls in.
 *
 * `'order'` collapses the period onto the order's own instant, which is what
 * {@link BackfillBucket} means by the two dates collapsing; its key is the local
 * day, and is deliberately display-only — two orders on one day share it, which
 * is why {@link BackfillBucket.bucketId} exists and why nothing may key a row
 * off `(partId, periodKey)`.
 *
 * `'range'` uses the window computed once over every line, so a part with demand
 * in one month still names the whole backfilled range as its period.
 */
function windowFor(
  line: BackfillDemandLine,
  grouping: BackfillGrouping,
  timeZone: string,
  wholeRange: BucketWindow | null
): BucketWindow {
  if (grouping === 'order') {
    return {
      periodKey: localFormat(line.placedAt, timeZone, 'yyyy-MM-dd'),
      periodStart: line.placedAt,
      periodEnd: line.placedAt,
    }
  }
  // `wholeRange` is null only when there are no usable lines, and then there is
  // no line to place either. The fallback keeps the function total.
  if (grouping === 'range') return wholeRange ?? calendarWindow(line.placedAt, 'day', timeZone)
  return calendarWindow(line.placedAt, grouping, timeZone)
}

/**
 * The calendar window containing an instant, in the book timezone.
 *
 * The round-trip is the repo's established one (`resources/aggregate/date-buckets.ts`):
 * `toZonedTime` gives a naive date whose fields ARE the zone's wall clock,
 * `date-fns` truncates it as plain calendar arithmetic, and `fromZonedTime`
 * reads those fields back in the zone to get the real instant. The key is
 * formatted from the truncated value rather than derived separately, so a key
 * and its boundaries can never disagree.
 *
 * Weeks are ISO — Monday start, `'2026-W05'` — matching `date-buckets.ts`, and
 * the key carries the ISO week-numbering year (`RRRR`), which is not always the
 * calendar year of the days in it.
 */
function calendarWindow(
  at: Date,
  grouping: 'day' | 'week' | 'month',
  timeZone: string
): BucketWindow {
  const local = toZonedTime(at, timeZone)
  if (grouping === 'month') {
    const start = startOfMonth(local)
    return {
      periodKey: format(start, 'yyyy-MM'),
      periodStart: fromZonedTime(start, timeZone),
      periodEnd: fromZonedTime(addMonths(start, 1), timeZone),
    }
  }
  if (grouping === 'week') {
    const start = startOfWeek(local, { weekStartsOn: 1 })
    return {
      periodKey: format(start, "RRRR-'W'II"),
      periodStart: fromZonedTime(start, timeZone),
      periodEnd: fromZonedTime(addWeeks(start, 1), timeZone),
    }
  }
  const start = startOfDay(local)
  return {
    periodKey: format(start, 'yyyy-MM-dd'),
    periodStart: fromZonedTime(start, timeZone),
    periodEnd: fromZonedTime(addDays(start, 1), timeZone),
  }
}

/**
 * The one window `'range'` grouping collapses everything into: the first local
 * day any line was placed, through the end of the last.
 *
 * Derived from the lines rather than taken from the request, because the request
 * is not something a pure decision is handed — and the days are local, so a
 * range that ends at 7pm on August 31 in `America/New_York` still closes at that
 * day's local midnight rather than a few hours short of it.
 */
function rangeWindow(lines: readonly BackfillDemandLine[], timeZone: string): BucketWindow | null {
  const first = lines[0]
  if (!first) return null
  let earliest = first.placedAt
  let latest = first.placedAt
  for (const line of lines) {
    if (line.placedAt.getTime() < earliest.getTime()) earliest = line.placedAt
    if (line.placedAt.getTime() > latest.getTime()) latest = line.placedAt
  }
  const firstDay = startOfDay(toZonedTime(earliest, timeZone))
  const lastDay = startOfDay(toZonedTime(latest, timeZone))
  return {
    periodKey: `${format(firstDay, 'yyyy-MM-dd')}..${format(lastDay, 'yyyy-MM-dd')}`,
    periodStart: fromZonedTime(firstDay, timeZone),
    periodEnd: fromZonedTime(addDays(lastDay, 1), timeZone),
  }
}

/** Format an instant's local calendar fields in the book timezone. */
function localFormat(at: Date, timeZone: string, pattern: string): string {
  return format(toZonedTime(at, timeZone), pattern)
}

/**
 * Is this line demand at all?
 *
 * Non-positive and non-finite quantities contribute nothing, the same reading
 * `sumQuantityByPart` and `planOrderBuildConvergence` already take. An invalid
 * `placedAt` is dropped for a different reason: it cannot be bucketed, and every
 * alternative — today, the range start, a bucket of its own — invents a period
 * the order does not have.
 */
function isUsableLine(line: BackfillDemandLine): boolean {
  return (
    Number.isFinite(line.quantity) && line.quantity > 0 && !Number.isNaN(line.placedAt.getTime())
  )
}

function groupLinesByPart(lines: readonly BackfillDemandLine[]): Map<string, BackfillDemandLine[]> {
  const byPart = new Map<string, BackfillDemandLine[]>()
  for (const line of lines) {
    const bucket = byPart.get(line.partId)
    if (bucket) bucket.push(line)
    else byPart.set(line.partId, [line])
  }
  return byPart
}

/**
 * Committed production per part, as one pool.
 *
 * Several `planned` builds for one part are one pool of units and nothing here
 * distinguishes them, which is the whole point of 7.1a's range-level netting.
 * A non-positive or non-finite quantity adds nothing rather than subtracting.
 */
function sumCoverageByPart(coverage: readonly BackfillCoverage[]): Map<string, number> {
  const byPart = new Map<string, number>()
  for (const entry of coverage) {
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) continue
    byPart.set(entry.partId, (byPart.get(entry.partId) ?? 0) + entry.quantity)
  }
  return byPart
}

function sumQuantity(lines: readonly BackfillDemandLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0)
}

/** `part_quantity_on_hand` as reported: negative is kept, `NaN` is not a number. */
function finiteOrZero(raw: number | undefined): number {
  return raw !== undefined && Number.isFinite(raw) ? raw : 0
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
