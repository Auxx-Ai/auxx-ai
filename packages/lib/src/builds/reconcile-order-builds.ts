// packages/lib/src/builds/reconcile-order-builds.ts

/**
 * Phase 5 — an order changed, and the builds it raised are converged onto it.
 *
 * `plans/products/13-order-build-reconciliation.md` **Model B**, decided
 * 2026-08-28 (*an order-raised build tracks its order*), which is
 * `plans/events/08-derived-parent-reconciler-plan.md` phase 5: the `apply` that
 * plan deliberately left unbuilt through phases 1-4.
 *
 * This REPLACED `auto-build.ts`, which products/13 Q13 deleted in the same change
 * that turned `apply` on. It is written to match what that file did —
 * same batching, same never-throw discipline, same summary shape — because the
 * two are the same pass seen at two moments. The deleted `runAutoBuildForOrders` answered
 * *"an order arrived, what should exist?"*; this answers *"the order moved, what
 * should exist NOW?"*, and under Model B the second question subsumes the first:
 * 13 §1.2 shows every interactive order creates its header before any line
 * exists, so the `created` trigger fires against an empty order and raises
 * nothing at all. **A late line raising the first build is not a bonus here, it
 * is the main win** — which is also exactly why this pass is a raise door and
 * must be windowed (see {@link reconcileOrderBuilds} and 13 Q11).
 *
 * ## The split with the pure layer
 *
 * Nothing here decides anything. `reconcile-policy.ts` is handed the collapsed
 * demand and the builds already raised and returns a list of discrete actions;
 * this file reads what that decision needs, executes the actions, and records
 * what happened. 13 §6 phase 5's risk note is the reason for the hard split:
 * *"Every reconciler shipped so far writes a **number**; this one writes
 * **records**."*
 *
 * ## 🛑 Never throws
 *
 * Three layers, all load-bearing, per events/08 §7 (plan 04 T-6) — this runs
 * **post-commit**, so the write it reconciles has already landed and a failure
 * here must never surface as a command failure:
 *
 * 1. every ACTION inside its own `try`, so one build that will not amend does
 *    not lose the rest of the order;
 * 2. every ORDER inside its own `try`, so one bad order does not lose the batch;
 * 3. the whole body inside the module {@link guard}.
 *
 * A caller that ignores the returned `Result` is behaving correctly.
 *
 * No permission checks. There is no human in the call stack, and the rule engine
 * is not an authorization surface (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { loadDirectSubparts } from '../bom/subpart-graph'
import { SystemUserService } from '../users/system-user-service'
import {
  type AutoBuildLine,
  isWithinEnablementWindow,
  sumQuantityByPart,
} from './auto-build-policy'
import { readPartQuantitiesOnHand } from './auto-build-queries'
import { loadAutoBuildSettings } from './auto-build-settings'
import { amendPlannedBuildQuantity, cancelBuild, createBuild } from './build-mutations'
import { readPartKinds } from './build-queries'
import { resolvePartKind } from './client'
import { guard } from './guard'
import {
  type BuildConvergenceAction,
  type ConvergenceSkipReason,
  planOrderBuildConvergence,
} from './reconcile-policy'
import { readOrderRaisedBuilds } from './reconcile-queries'
import type { BuildRecord } from './types'

const logger = createScopedLogger('builds:reconcile-order-builds')

/**
 * The note a converged cancellation leaves on the build.
 *
 * Deliberately NOT `auto-build-cancel.ts`'s *"Order cancelled"*. The two sweeps
 * write the same field for different reasons and somebody reading the build has
 * to be able to tell "the order went away" from "the order no longer asks for
 * this part", which are different things to go and check.
 */
const CANCEL_REASON = 'Order changed'

/**
 * One order, as the reconciler needs to see it.
 *
 * Exactly what `loadAutoBuildOrders` returns plus the fingerprint the caller has
 * already computed — the caller computes it to decide whether to run at all
 * (events/08 R9), so re-deriving it here would be a second reading of the same
 * order and a chance for the two to disagree.
 */
export interface ReconcileOrderInput {
  /** `EntityInstance.id` of the `order`. */
  orderId: string
  /** `order_placed_at`, falling back to the row's `createdAt`. The AB8 window is tested on it. */
  placedAt: Date
  /** `order_cancelled_at`. Non-null means this pass does nothing — see {@link reconcileOrderBuilds}. */
  cancelledAt: Date | null
  /** The order's live lines that reach a part, uncollapsed. */
  lines: readonly AutoBuildLine[]
  /**
   * `orderDemandFingerprint(order)`, as it is about to be stored on the order.
   *
   * Stamped onto every build this pass raises or amends, so that a build the
   * reconciler has just converged reports **no** drift rather than the drift it
   * has this moment resolved.
   */
  fingerprint: string
}

/**
 * Why a `(order, part)` pair — or a whole order — produced no write.
 *
 * The pure layer's reasons, plus the three order-level gates that live here
 * because they need a clock, a settings read, or both.
 */
export type OrderBuildReconcileSkipReason =
  | ConvergenceSkipReason
  /** `inventory.autoBuildFromOrders` is off. One row for the whole batch. */
  | 'disabled'
  /** AB8 / 13 Q11 — the order was placed before the switch was turned on. */
  | 'before-enablement'
  /** The order is cancelled, and its builds belong to `cancelAutoBuildsForOrders`. */
  | 'order-cancelled'

/** One build this pass raised. */
export interface OrderBuildRaise {
  orderId: string
  partId: string
  buildId: string
  quantityPlanned: number
}

/** One `planned` build whose quantity this pass rewrote (13 Q3 — the order wins). */
export interface OrderBuildAmendment {
  orderId: string
  partId: string
  buildId: string
  /** What the build planned before. `null` on a row carrying no quantity at all. */
  from: number | null
  to: number
}

/** One `planned` build this pass cancelled. Never a delete (AB6). */
export interface OrderBuildCancellation {
  orderId: string
  partId: string
  buildId: string
}

/** One decision that wrote nothing, with the reason a person can act on. */
export interface OrderBuildReconcileSkip {
  /** `null` on a batch-level skip — today, only `disabled`. */
  orderId: string | null
  /** `null` on an order-level skip. */
  partId: string | null
  /** `null` when the skip is about a part rather than a particular build. */
  buildId: string | null
  reason: OrderBuildReconcileSkipReason
}

/** One action that failed. Recorded and stepped over, never thrown. */
export interface OrderBuildReconcileFailure {
  orderId: string
  partId: string | null
  buildId: string | null
  message: string
}

/** What one convergence pass did. Mirrors the shape `AutoBuildSummary` had before Q13. */
export interface OrderBuildReconcileSummary {
  /**
   * Orders that passed every order-level gate and actually reached the pure
   * decision — never simply how many were handed in.
   */
  ordersConsidered: number
  raised: OrderBuildRaise[]
  amended: OrderBuildAmendment[]
  cancelled: OrderBuildCancellation[]
  skipped: OrderBuildReconcileSkip[]
  failed: OrderBuildReconcileFailure[]
}

function emptySummary(): OrderBuildReconcileSummary {
  return { ordersConsidered: 0, raised: [], amended: [], cancelled: [], skipped: [], failed: [] }
}

/** An order that cleared the gates, with everything the decision needs. */
interface Candidate {
  order: ReconcileOrderInput
  desired: Map<string, number>
  existing: BuildRecord[]
}

/**
 * Converge a batch of orders' builds onto what those orders now ask for.
 *
 * ## 🛑 A CANCELLED order is skipped, and this is a decision rather than an omission
 *
 * A cancelled order's demand collapses to empty, so naive convergence would
 * cancel every `planned` build it raised — which is precisely what
 * `cancelAutoBuildsForOrders` already does, **and it does more**: it also
 * *reverses* a `completed` build (AB6, the whole of 13 §5's "we took the trigger
 * and refused the verb"), and it is deliberately NOT gated on
 * `inventory.autoBuildFromOrders` so that switching the feature off afterwards
 * cannot strand builds against an order that is gone.
 *
 * Two paths writing the same builds is strictly worse than one. If this pass
 * also converged a cancelled order the two would race on every cancellation,
 * each seeing a set the other had just moved, and the weaker of the two —
 * this one, which cannot reverse — would sometimes get there first and report a
 * cancellation where a reversal was owed. So cancellation belongs to exactly one
 * sweep, and it is not this one.
 *
 * ## 🛑 AB8's enablement window IS honoured here (13 Q11, answered 2026-08-28)
 *
 * The split is by what the pass *does*, not by which pass it is. **Stamping**
 * (`drift-reconciler.ts`) ignores the window — it raises nothing, and honouring
 * it there would leave every pre-enablement order permanently unable to show
 * drift. **Applying honours it**, on the same `isWithinEnablementWindow` test
 * the raise uses (`auto-build.ts:150`), because under Model B *a reconcile is a
 * raise door*: an unwindowed apply means editing any back-filled order
 * manufactures against years of Shopify history, which is the exact thing AB8
 * exists to prevent.
 *
 * ## Batching
 *
 * Matches the batching `runAutoBuildForOrders` used before Q13 deleted it — across
 * the WHOLE batch and not per
 * order: one `readPartKinds`, one `readPartQuantitiesOnHand`, one
 * `getSystemUserForActions`, and one `loadDirectSubparts` per DISTINCT part with
 * `component` parts skipped before the BOM read (step 3 before step 2 — a
 * purchased part never needs its bill of materials read).
 *
 * ⚠️ **{@link readOrderRaisedBuilds} is the one read that is per-order**, because
 * `listBuilds` has no multi-order filter — `build-queries.ts` builds `orderId`
 * as a single-valued INNER JOIN. That is one read per order and it is accepted
 * rather than worked around: inventing a batched variant would mean a second
 * build-read path, and the filter-dropping hazard its header documents is
 * exactly the kind of thing that must not exist twice.
 *
 * Only the parts the orders WANT are read. A part that appears solely on an
 * existing build can never reach the admission tests — the pure layer consults
 * `partKinds` / `hasBom` / `quantitiesOnHand` only when the part is wanted and
 * has no build to converge — so widening the read to build parts would buy
 * nothing.
 */
export async function reconcileOrderBuilds(
  db: Database,
  organizationId: string,
  orders: readonly ReconcileOrderInput[]
): Promise<Result<OrderBuildReconcileSummary, Error>> {
  return guard(
    async () => {
      const summary = emptySummary()
      if (orders.length === 0) return summary

      const settings = await loadAutoBuildSettings(organizationId)
      if (!settings.enabled) {
        summary.skipped.push({ orderId: null, partId: null, buildId: null, reason: 'disabled' })
        return summary
      }

      const candidates = await collectCandidates(db, organizationId, orders, settings, summary)
      summary.ordersConsidered = candidates.length
      if (candidates.length === 0) return summary

      const partIds = [...new Set(candidates.flatMap(({ desired }) => [...desired.keys()]))]
      const [kinds, quantitiesOnHand, systemUserId] = await Promise.all([
        readPartKinds(db, organizationId, partIds),
        readPartQuantitiesOnHand(db, organizationId, partIds),
        // The reconcile runs unattended, so it writes as the org's system user.
        // 🛑 NOT `drift-reconciler.ts`'s empty `SYSTEM_STAMP_USER`: that actor is
        // only ever handed to a `FieldValueService` writing an `updatable: false`
        // field, and the build mutations reach `UnifiedCrudHandler`, which does
        // read its actor.
        SystemUserService.getSystemUserForActions(organizationId),
      ])

      // One BOM read per DISTINCT part across the whole batch, not per order.
      const hasBom = new Map<string, boolean>()
      for (const partId of partIds) {
        if (resolvePartKind(kinds.get(partId)) === 'component') continue
        const subparts = await loadDirectSubparts(db, organizationId, partId)
        hasBom.set(partId, subparts.length > 0)
      }

      for (const candidate of candidates) {
        try {
          const plan = planOrderBuildConvergence({
            desired: candidate.desired,
            existing: candidate.existing,
            partKinds: kinds,
            hasBom,
            quantitiesOnHand,
            stockRule: settings.stockRule,
          })

          for (const action of plan.actions) {
            // 🛑 One failing ACTION must not lose the rest of the order.
            try {
              await applyAction(db, organizationId, systemUserId, candidate.order, action, summary)
            } catch (error) {
              recordFailure(summary, candidate.order.orderId, action, error)
            }
          }
        } catch (error) {
          // 🛑 One failing ORDER must not lose the rest of the batch.
          const message = error instanceof Error ? error.message : String(error)
          summary.failed.push({
            orderId: candidate.order.orderId,
            partId: null,
            buildId: null,
            message,
          })
          logger.error('Converging one order failed; continuing with the batch', {
            organizationId,
            orderId: candidate.order.orderId,
            message,
          })
        }
      }

      logSummary(organizationId, summary)
      return summary
    },
    "Reconciling an order's builds failed",
    { organizationId, orders: orders.length }
  )
}

/**
 * Apply the order-level gates and read each surviving order's existing builds.
 *
 * ⚠️ **An order whose lines collapse to NOTHING is still a candidate**, which is
 * the one place this deliberately parted company with the deleted `runAutoBuildForOrders`:
 * that pass skips `no-parts-on-order` because there is nothing to raise, while
 * here "the order wants nothing" is a real instruction — every line was deleted,
 * and the builds it raised must be cancelled (13 §0, the defect this exists to
 * remove). Dropping it would leave a live build for an empty order forever.
 */
async function collectCandidates(
  db: Database,
  organizationId: string,
  orders: readonly ReconcileOrderInput[],
  settings: { enabledAt: Date | null },
  summary: OrderBuildReconcileSummary
): Promise<Candidate[]> {
  const candidates: Candidate[] = []

  for (const order of orders) {
    // 🛑 See the function header: a cancelled order's builds belong to
    // `cancelAutoBuildsForOrders`, which reverses as well as cancels.
    if (order.cancelledAt) {
      summary.skipped.push({
        orderId: order.orderId,
        partId: null,
        buildId: null,
        reason: 'order-cancelled',
      })
      continue
    }
    if (!isWithinEnablementWindow(order.placedAt, settings.enabledAt)) {
      summary.skipped.push({
        orderId: order.orderId,
        partId: null,
        buildId: null,
        reason: 'before-enablement',
      })
      continue
    }

    try {
      const existing = await readOrderRaisedBuilds(db, organizationId, order.orderId)
      candidates.push({ order, desired: sumQuantityByPart(order.lines), existing })
    } catch (error) {
      // A build read that cannot be trusted must not be reconciled against: an
      // empty result would read as "this order raised nothing" and cancel
      // nothing while raising everything a second time.
      const message = error instanceof Error ? error.message : String(error)
      summary.failed.push({ orderId: order.orderId, partId: null, buildId: null, message })
      logger.error('Could not read the builds of an order; leaving it unreconciled', {
        organizationId,
        orderId: order.orderId,
        message,
      })
    }
  }

  return candidates
}

/**
 * Perform one decision.
 *
 * Every writer here is one of the three sanctioned build mutations, and each
 * already refuses what it must not do — `amendPlannedBuildQuantity` accepts
 * `planned` only, `cancelBuild` refuses a `completed` build. The pure layer has
 * already excluded those cases; the mutations refusing them again is the second
 * of the two checks 13 §5 asks for, on the writing side.
 *
 * A mutation returning `err` is recorded as a failure rather than thrown, the
 * same way the deleted `runAutoBuildForOrders` handled a refused `createBuild`.
 */
async function applyAction(
  db: Database,
  organizationId: string,
  systemUserId: string,
  order: ReconcileOrderInput,
  action: BuildConvergenceAction,
  summary: OrderBuildReconcileSummary
): Promise<void> {
  switch (action.kind) {
    case 'raise': {
      const created = await createBuild(db, organizationId, systemUserId, {
        partId: action.partId,
        quantityPlanned: action.quantity,
        orderId: order.orderId,
        source: 'order',
        // The fingerprint is already in hand, so `createBuild` does not have to
        // re-read the order to derive it (`build-mutations.ts:356`).
        orderRevision: order.fingerprint,
      })
      if (created.isErr()) {
        recordFailure(summary, order.orderId, action, created.error)
        return
      }
      summary.raised.push({
        orderId: order.orderId,
        partId: action.partId,
        buildId: created.value.buildId,
        quantityPlanned: action.quantity,
      })
      return
    }

    case 'amend': {
      const amended = await amendPlannedBuildQuantity(db, organizationId, systemUserId, {
        buildId: action.buildId,
        quantityPlanned: action.to,
        // Re-stamped in the SAME update as the quantity: this is the moment the
        // build stops differing from its order, and leaving the old stamp would
        // report drift that has just been resolved.
        orderRevision: order.fingerprint,
      })
      if (amended.isErr()) {
        recordFailure(summary, order.orderId, action, amended.error)
        return
      }
      summary.amended.push({
        orderId: order.orderId,
        partId: action.partId,
        buildId: action.buildId,
        from: action.from,
        to: action.to,
      })
      return
    }

    case 'cancel': {
      const cancelled = await cancelBuild(db, organizationId, systemUserId, {
        buildId: action.buildId,
        reason: CANCEL_REASON,
      })
      if (cancelled.isErr()) {
        recordFailure(summary, order.orderId, action, cancelled.error)
        return
      }
      summary.cancelled.push({
        orderId: order.orderId,
        partId: action.partId,
        buildId: action.buildId,
      })
      return
    }

    case 'skip':
      summary.skipped.push({
        orderId: order.orderId,
        partId: action.partId,
        buildId: action.buildId,
        reason: action.reason,
      })
      return
  }
}

/** Record one failed action against the ids it names. */
function recordFailure(
  summary: OrderBuildReconcileSummary,
  orderId: string,
  action: BuildConvergenceAction,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error)
  summary.failed.push({
    orderId,
    partId: action.partId,
    buildId: action.kind === 'raise' ? null : action.buildId,
    message,
  })
  logger.error('An order-build convergence action failed; continuing with the order', {
    orderId,
    kind: action.kind,
    partId: action.partId,
    message,
  })
}

/**
 * One info line, and only when something happened.
 *
 * Matching `auto-build.ts:251`: this pass runs on every demand-moving order
 * edit in every manufacturing org, and the overwhelmingly common outcome is a
 * handful of `already-current` skips. Logging those would bury the writes.
 */
function logSummary(organizationId: string, summary: OrderBuildReconcileSummary): void {
  const wrote = summary.raised.length + summary.amended.length + summary.cancelled.length
  if (wrote === 0 && summary.failed.length === 0) return

  logger.info('Converged order builds', {
    organizationId,
    orders: summary.ordersConsidered,
    raised: summary.raised.length,
    amended: summary.amended.length,
    cancelled: summary.cancelled.length,
    skipped: summary.skipped.length,
    failed: summary.failed.length,
  })
}
