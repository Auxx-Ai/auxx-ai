// packages/lib/src/builds/reconcile-queries.ts

/**
 * The ONE read of "every build the system raised against this order".
 *
 * plans/products/13-order-build-reconciliation.md §5, decision AB7 in
 * plans/products/12-order-triggered-build.md §6.
 *
 * 🛑 **This exists rather than a bare `listBuilds` call because the filter has
 * to be applied twice.** `listBuilds` builds its `source` and `orderId`
 * predicates as INNER JOINs that are only added when the org has materialised
 * the field (`build-queries.ts:318,340`) — a filter whose field is missing is
 * silently dropped, with no error and no marker on the result. A dropped
 * `source` filter turns "undo what the system raised" into "undo everything
 * anyone raised", and a dropped `orderId` filter widens that to every build in
 * the org. So the SQL filters here, and the answer is filtered AGAIN in memory
 * before any caller sees it.
 *
 * Two callers justify the extraction and no more: `auto-build-cancel.ts` (an
 * order was cancelled — undo its builds) and the phase-5 reconciler (an order
 * changed — converge its builds). Both act on the result by WRITING, which is
 * exactly why neither may accept a silently widened set.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { listBuilds } from './build-queries'
import type { BuildRecord } from './types'

const logger = createScopedLogger('builds:reconcile-queries')

/** One page of the build read. Orders raise a handful of builds, not thousands. */
const PAGE_SIZE = 100

/**
 * How many builds one order is allowed to have before the sweep stops walking.
 *
 * A cap rather than an unbounded loop: both callers run inline off a field
 * write, and a pathological order must degrade to "some builds were not
 * reconciled, and it is in the log" rather than to a write that never returns.
 */
const MAX_BUILDS_PER_ORDER = 1000

/**
 * Every `source: 'order'` build raised against one order, newest first.
 *
 * Paged, because `listBuilds` defaults to 50 and an order that raised 60 builds
 * must not have 10 of them silently survive its cancellation — or, under
 * plan 13's Model B, silently escape its reconcile.
 *
 * 🛑 A build with `build_source = 'manual'` is never returned, even when it
 * points at this order. A person raised it deliberately and no automatic path
 * may touch it (plan 13 §5) — see the module header for why that is enforced
 * twice rather than once.
 *
 * Throws rather than returning a `Result`: both callers already run inside
 * `guard(...)`, and a read that cannot be trusted must not be reported as an
 * empty build set.
 */
export async function readOrderRaisedBuilds(
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
    // 🛑 Re-assert both filters in memory. See the module header: `listBuilds`
    // drops a filter whose field the org has not materialised, and a dropped
    // `source` filter would hand a hand-raised build to a writer.
    builds.push(
      ...page.value.filter((build) => build.orderId === orderId && build.source === 'order')
    )
    if (page.value.length < PAGE_SIZE) return builds
  }

  logger.warn('Order has more system-raised builds than the reconcile sweep walks', {
    organizationId,
    orderId,
    cap: MAX_BUILDS_PER_ORDER,
  })
  return builds
}
