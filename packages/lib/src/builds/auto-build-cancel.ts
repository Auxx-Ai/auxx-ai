// packages/lib/src/builds/auto-build-cancel.ts

/**
 * Phase 3b — an order is cancelled, and the builds it caused are undone.
 *
 * plans/products/12-order-triggered-build.md section 6, decision AB6.
 *
 * 🛑 **Nothing is ever deleted.** The competitor setting this copies says to
 * *delete* the auto-raised manufactures — and deleting a completed manufacture
 * deletes ledger history and silently restates a closed period. Take the
 * trigger, refuse the verb:
 *
 * | status | action |
 * | --- | --- |
 * | `planned` / `in_progress` | `cancelBuild` — no movements exist yet |
 * | `completed` | `reverseBuild` — a second, opposite build carrying the ORIGINAL's frozen costs |
 * | `canceled` | skip, already terminal |
 *
 * 🛑 **A build with `build_source = 'manual'` is never touched**, even when it
 * points at the cancelled order. A person raised it deliberately, against this
 * order, on purpose — that is the entire reason AB7 added `build_source`
 * alongside `build_order`. The read filters on it in SQL AND this file
 * re-checks it in memory, because `listBuilds` silently drops a filter whose
 * field the org has not materialised, and a dropped `source` filter would turn
 * "undo what the system raised" into "undo everything anyone raised".
 *
 * 🛑 **Never throws.** Same contract as `auto-build.ts`: one build that will not
 * cancel must not strand the others.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { SystemUserService } from '../users/system-user-service'
import { loadAutoBuildOrders } from './auto-build-queries'
import { cancelBuild } from './build-mutations'
import { listBuilds } from './build-queries'
import { canCancelBuild, canReverseBuild } from './client'
import { guard } from './guard'
import { reverseBuild } from './reverse-build'
import type { BuildRecord } from './types'

const logger = createScopedLogger('builds:auto-build-cancel')

/** One page of the build read. Orders raise a handful of builds, not thousands. */
const PAGE_SIZE = 100

/**
 * How many builds one order is allowed to have before the sweep stops walking.
 *
 * A cap rather than an unbounded loop: this runs inline on a field write, and a
 * pathological order must degrade to "some builds were not undone, and it is in
 * the log" rather than to a write that never returns.
 */
const MAX_BUILDS_PER_ORDER = 1000

const CANCEL_REASON = 'Order cancelled'

/** What happened to one build. */
export type AutoBuildCancellationAction =
  /** Was `planned` or `in_progress`; now `canceled`. */
  | 'cancelled'
  /** Was `completed`; a reversing build now negates it. */
  | 'reversed'
  /** Already `canceled`, already reversed, or itself a reversal. */
  | 'skipped'

export interface AutoBuildCancellationOutcome {
  orderId: string
  buildId: string
  action: AutoBuildCancellationAction
  /** The NEW build a reversal wrote. `null` for every other action. */
  reversalBuildId: string | null
}

export interface AutoBuildCancellationFailure {
  orderId: string
  buildId: string
  message: string
}

/** What one dispatch of the cancellation rule did. */
export interface AutoBuildCancellationSummary {
  /** Orders that were actually found carrying `order_cancelled_at`. */
  ordersCancelled: number
  outcomes: AutoBuildCancellationOutcome[]
  failed: AutoBuildCancellationFailure[]
  /**
   * 🛑 Always `0`, asserted by a test.  and the
   * counter exists so "nothing is ever deleted" is a property this module
   * reports rather than a claim its comments make.
   */
  deleted: 0
}

function emptySummary(): AutoBuildCancellationSummary {
  return { ordersCancelled: 0, outcomes: [], failed: [], deleted: 0 }
}

/**
 * Undo the auto-raised builds behind a batch of cancelled orders.
 *
 * ⚠️ **The cancellation stamp is re-read, not trusted from the transition.** The
 * interactive native-rule door dispatches with a sentinel new value rather than
 * the real one (`field-hooks/field-hook-job.ts`), so `on: 'set'` there means
 * "this field was written", not "this field went from empty to non-empty". Any
 * order in the batch whose `order_cancelled_at` is actually empty is dropped
 * here — which is also what makes a future un-cancel harmless rather than
 * destructive.
 *
 * Deliberately NOT gated on `inventory.autoBuildFromOrders`. The builds already
 * exist; switching the trigger off afterwards must not leave them stranded
 * against an order that is gone. An org that never switched it on has no
 * `source: 'order'` builds, so this is a no-op there by construction.
 */
export async function cancelAutoBuildsForOrders(
  db: Database,
  organizationId: string,
  orderIds: string[]
): Promise<Result<AutoBuildCancellationSummary, Error>> {
  return guard(
    async () => {
      const summary = emptySummary()
      if (orderIds.length === 0) return summary

      const orders = await loadAutoBuildOrders(db, organizationId, orderIds)
      const cancelled = orders.filter((order) => order.cancelledAt != null)
      summary.ordersCancelled = cancelled.length
      if (cancelled.length === 0) return summary

      const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

      for (const order of cancelled) {
        const builds = await readAutoBuilds(db, organizationId, order.orderId)
        // A build that already carries a reversal must not be reversed twice —
        // `reverseBuild` refuses it, but refusing is a logged failure and this
        // rule can legitimately fire more than once on the same order.
        const alreadyReversed = new Set(
          builds
            .map((build) => build.reversalOfBuildId)
            .filter((id): id is string => id !== null && id !== undefined)
        )

        for (const build of builds) {
          try {
            const outcome = await undoBuild(db, organizationId, systemUserId, build, {
              alreadyReversed,
            })
            summary.outcomes.push({ orderId: order.orderId, ...outcome })
          } catch (error) {
            summary.failed.push({
              orderId: order.orderId,
              buildId: build.buildId,
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      if (summary.outcomes.length > 0 || summary.failed.length > 0) {
        logger.info('Cancelled order — undid its auto-raised builds', {
          organizationId,
          orders: summary.ordersCancelled,
          cancelled: summary.outcomes.filter((o) => o.action === 'cancelled').length,
          reversed: summary.outcomes.filter((o) => o.action === 'reversed').length,
          skipped: summary.outcomes.filter((o) => o.action === 'skipped').length,
          failed: summary.failed.length,
        })
      }
      return summary
    },
    'Cancelling the builds for a cancelled order failed',
    { organizationId, orders: orderIds.length }
  )
}

/** Decide and perform the one correction this build's status allows. */
async function undoBuild(
  db: Database,
  organizationId: string,
  systemUserId: string,
  build: BuildRecord,
  ctx: { alreadyReversed: Set<string> }
): Promise<Omit<AutoBuildCancellationOutcome, 'orderId'>> {
  const skipped = { buildId: build.buildId, action: 'skipped' as const, reversalBuildId: null }

  // A reversing build is a correction, not a run. Undoing it would re-apply the
  // very movements the cancellation is trying to remove.
  if (build.reversalOfBuildId) return skipped
  if (ctx.alreadyReversed.has(build.buildId)) return skipped

  if (canCancelBuild(build.status)) {
    const result = await cancelBuild(db, organizationId, systemUserId, {
      buildId: build.buildId,
      reason: CANCEL_REASON,
    })
    if (result.isErr()) throw result.error
    return { buildId: build.buildId, action: 'cancelled', reversalBuildId: null }
  }

  if (canReverseBuild(build.status)) {
    const result = await reverseBuild(db, organizationId, systemUserId, {
      buildId: build.buildId,
      reason: CANCEL_REASON,
    })
    if (result.isErr()) throw result.error
    return { buildId: build.buildId, action: 'reversed', reversalBuildId: result.value.buildId }
  }

  // `canceled`, or a row whose status is missing entirely. Terminal either way.
  return skipped
}

/**
 * Every `source: 'order'` build raised against one order.
 *
 * Paged, because `listBuilds` defaults to 50 and an order that raised 60 builds
 * must not have 10 of them silently survive its cancellation.
 */
async function readAutoBuilds(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<BuildRecord[]> {
  const builds: BuildRecord[] = []
  for (let offset = 0; offset < MAX_BUILDS_PER_ORDER; offset += PAGE_SIZE) {
    const page = await listBuilds(db, organizationId, {
      orderId,
      source: 'order',
      limit: PAGE_SIZE,
      offset,
    })
    if (page.isErr()) throw page.error
    // 🛑 Re-assert both filters in memory. `listBuilds` drops a filter whose
    // field the org has not materialised, and a dropped `source` filter would
    // hand a hand-raised build to the cancellation path.
    builds.push(
      ...page.value.filter((build) => build.orderId === orderId && build.source === 'order')
    )
    if (page.value.length < PAGE_SIZE) return builds
  }

  logger.warn('Order has more auto-raised builds than the cancellation sweep walks', {
    organizationId,
    orderId,
    cap: MAX_BUILDS_PER_ORDER,
  })
  return builds
}
