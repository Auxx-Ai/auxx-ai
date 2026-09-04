// packages/lib/src/builds/backfill-types.ts

/**
 * The contract the build backfill is written against.
 *
 * `plans/money/tasks/44-auto-build-cutoff-and-backfill.md` sections 6 and 7.
 *
 * This file is the seam between the four halves of the feature and it holds no
 * logic of its own:
 *
 * - `backfill-policy.ts` is PURE and decides what to build,
 * - `backfill-queries.ts` reads what the policy is handed,
 * - `backfill-builds.ts` executes the plan,
 * - the router and the dialog render it.
 *
 * The split follows `reconcile-policy.ts` / `reconcile-order-builds.ts` exactly,
 * for the reason that file's header gives: the decision has to be testable
 * without a database, a clock or a settings read.
 */

import type { ConvergenceSkipReason } from './reconcile-policy'

/**
 * How much demand one build covers.
 *
 * `'range'` collapses the whole window into one build per part.
 *
 * Section 7.3: when the run creates `completed` builds and the range spans more
 * than one accounting month, `'range'` is not selectable. `build_completed_at`
 * decides which month-end entry reflects the build, so a coarser grouping
 * misstates every month it spans.
 */
export type BackfillGrouping = 'order' | 'day' | 'week' | 'month' | 'range'

export const BACKFILL_GROUPINGS: readonly BackfillGrouping[] = [
  'order',
  'day',
  'week',
  'month',
  'range',
]

/**
 * Why an ordered part produces no build at all.
 *
 * Three members of {@link ConvergenceSkipReason} transfer to the aggregate
 * (section 7.2b). The other five are per-(order, part) concepts and would be
 * inventing a meaning they do not have here.
 *
 * 🛑 `already-covered` is NATIVE to the aggregate and has no per-order twin. It
 * is the state a part is in when committed production already meets the whole
 * demand, and it is deliberately not folded into `covered-by-stock`: the two
 * have different remedies, and conflating them is actively misleading on the
 * SECOND run of the dialog, where every part just built is fully covered and
 * would otherwise be reported as sitting on the shelf.
 */
export type BackfillExclusionReason =
  | Extract<ConvergenceSkipReason, 'not-a-built-part' | 'no-bill-of-materials' | 'covered-by-stock'>
  | 'already-covered'

export const BACKFILL_EXCLUSION_REASONS: readonly BackfillExclusionReason[] = [
  'not-a-built-part',
  'no-bill-of-materials',
  'covered-by-stock',
  'already-covered',
]

/** One order line's contribution to demand, already resolved to a part. */
export interface BackfillDemandLine {
  /** `EntityInstance.id` of the `order` the line hangs off. */
  orderId: string
  /** `EntityInstance.id` of the `part` the line reaches through `line_item_part`. */
  partId: string
  /** `line_item_qty`. Non-positive and non-finite values contribute nothing. */
  quantity: number
  /**
   * `order_placed_at`, falling back to the order row's `createdAt`.
   *
   * This is what buckets the line, and it is a business date: a connector
   * back-fill creates rows today carrying last year's date.
   */
  placedAt: Date
}

/**
 * Production already committed for a part, which demand must be netted against.
 *
 * Section 7.1a: this carries `planned` and `in_progress` builds ONLY. A
 * `completed` build's units are already in `part_quantity_on_hand` through its
 * `build_produce` movement, so counting it here and subtracting on hand counts
 * the same production twice.
 */
export interface BackfillCoverage {
  /** `EntityInstance.id` of the `part`. */
  partId: string
  /** `build_quantity_planned`. */
  quantity: number
  /**
   * When this coverage applies.
   *
   * An order-raised build resolves it through `build_order` to the order's
   * `order_placed_at`. A batch build resolves it to the start of its own demand
   * period. `null` when neither is knowable, which sorts first.
   *
   * ⚠️ **Deliberately UNUSED by the v1 policy, not forgotten.** Section 7.1a
   * pools coverage per part and drains it chronologically against the buckets;
   * consuming period-scoped coverage against its own overlapping buckets first
   * is the refinement that section explicitly defers. The field is populated so
   * that refinement needs no change to the reader.
   */
  appliesAt: Date | null
}

/** Everything the pure decision is allowed to see. No db, no clock, no settings. */
export interface BackfillPlanInput {
  /** Every line in the range that reaches a part, uncollapsed. */
  lines: readonly BackfillDemandLine[]
  /** Committed production per part. See {@link BackfillCoverage}. */
  coverage: readonly BackfillCoverage[]
  /** `partId` -> `part_quantity_on_hand`. Absent reads as `0`. */
  quantitiesOnHand: ReadonlyMap<string, number>
  /** `partId` -> raw `part_kind` option value, exactly as stored. `null` reads as `component`. */
  partKinds: ReadonlyMap<string, string | null>
  /** `partId` -> does the part have at least one direct subpart? Absent reads as `false`. */
  hasBom: ReadonlyMap<string, boolean>
  /** How much demand one build covers. */
  grouping: BackfillGrouping
  /**
   * The organization's book timezone (`accounting.bookTimeZone`), which decides
   * which bucket a line falls in.
   *
   * Not optional decoration: an order placed at 7pm on January 31 in
   * `America/New_York` is already February 1 in UTC, and bucketing it in UTC
   * puts its build in the wrong accounting month. Same rule as
   * `postings/periods.ts`.
   */
  timeZone: string
}

/** One build the backfill would create. */
export interface BackfillBucket {
  /** `EntityInstance.id` of the `part` to produce. */
  partId: string
  /**
   * The demand period this build claims, as stored on the build.
   *
   * Half-open: `periodStart` inclusive, `periodEnd` exclusive. Under
   * `grouping: 'order'` the two collapse onto the one order's date.
   */
  periodStart: Date
  periodEnd: Date
  /** Human key for the period, `'2026-01'` at monthly grouping. Display only. */
  periodKey: string
  /**
   * Stable identity for this bucket within the plan.
   *
   * 🛑 **`(partId, periodKey)` is NOT unique.** Under `grouping: 'order'` two
   * orders placed on the same local day share a period key, so anything that
   * keys a row, a summary entry or a React list off that pair collides and
   * silently loses one. Key off this instead.
   *
   * 🛑 **Never persist it onto a build as an identity.** It is not stable across
   * a grouping change, by construction: changing the grouping changes which
   * buckets exist at all. It is a within-plan key for React lists and run
   * summaries, nothing more.
   */
  bucketId: string
  /** Units ordered in this bucket, before any netting. */
  quantityOrdered: number
  /** Committed production consumed by this bucket. */
  quantityCovered: number
  /** On-hand stock consumed by this bucket. Section 7.1: earliest bucket first. */
  quantityFromStock: number
  /** What the build is created for. Never zero, or the bucket is dropped. */
  quantityToBuild: number
  /** The orders behind this bucket, for the read-only drill-down. */
  orderIds: readonly string[]
}

/** One part, and every build the backfill would create for it. */
export interface BackfillPartPlan {
  partId: string
  /** Units ordered across the whole range. */
  quantityOrdered: number
  /**
   * Committed production AVAILABLE across the whole range, which is not the
   * same as the amount consumed.
   *
   * ⚠️ A part whose coverage exceeds its demand reports more here than it
   * ordered. That is truthful but reads oddly in a "Built" column, so the
   * screen (section 7.2) sums `quantityCovered` over {@link buckets} for
   * display, which is the amount actually consumed.
   */
  quantityCovered: number
  /** `part_quantity_on_hand` at the moment the plan was computed. */
  quantityOnHand: number
  /** Sum of `quantityToBuild` over {@link buckets}. */
  quantityToBuild: number
  /** One per build to create, chronological. Empty when nothing is owed. */
  buckets: readonly BackfillBucket[]
}

/**
 * One part that is ordered but produces no build, and why.
 *
 * 🛑 Every quantity here exists so the REASON is self-evident on the row.
 * Section 7.2b's whole argument is that an omission a person cannot explain
 * makes the preview untrustworthy, so a row must carry the number that proves
 * its own reason: `quantityOnHand` for `covered-by-stock`, `quantityCovered`
 * for `already-covered`.
 */
export interface BackfillExclusion {
  partId: string
  /** Units ordered in the range. Shown so the exclusion can be judged. */
  quantityOrdered: number
  /** `part_quantity_on_hand`, which is what makes `covered-by-stock` self-evident. */
  quantityOnHand: number
  /** Committed production, which is what makes `already-covered` self-evident. */
  quantityCovered: number
  reason: BackfillExclusionReason
}

/**
 * What the backfill would do. The preview renders this; the writer executes it.
 *
 * Deterministic: parts ascending by id, buckets chronological within a part.
 * That is what lets a test assert on the whole structure.
 */
export interface BackfillPlan {
  /** Parts with at least one build to create. */
  parts: readonly BackfillPartPlan[]
  /** Parts that are ordered but not buildable. Section 7.2b. */
  excluded: readonly BackfillExclusion[]
  /** Total builds this plan would create, across every part. */
  buildCount: number
  /** Total units, across every build. */
  unitCount: number
}

/** The status a backfilled build lands in. Section 7.3. */
export type BackfillStatus = 'planned' | 'completed'

/** What one backfill run was asked to do. */
export interface BackfillRequest {
  /** Inclusive lower bound on `order_placed_at`. */
  from: Date
  /** Exclusive upper bound. Section 7.0 bounds this above by the build cutoff. */
  to: Date
  grouping: BackfillGrouping
  status: BackfillStatus
}

/** What one backfill run did. Never throws; a failure is a row in here. */
export interface BackfillRunSummary {
  /**
   * Builds created, in creation order.
   *
   * 🛑 **`created` and {@link leftInProgress} OVERLAP.** A build whose
   * completion was refused was still raised, so it appears in both: `created`
   * means "builds that now exist and did not before", never "builds that
   * finished". Adding the two array lengths double-counts, and a screen that
   * does will report more builds than the run made.
   */
  created: readonly { partId: string; buildId: string; quantity: number; periodKey: string }[]
  /**
   * Builds raised whose completion was refused, leaving them `in_progress`.
   *
   * Section 7.4: `buildNow` is not atomic and reports this as a RESULT rather
   * than an error, because the build exists and the person has to be able to
   * name it. A run must record these and continue, never abort the batch.
   */
  leftInProgress: readonly { partId: string; buildId: string; reason: string }[]
  /** Buckets that produced nothing at all, with the reason. Keyed by `bucketId`. */
  failed: readonly { partId: string; bucketId: string; periodKey: string; reason: string }[]
}
