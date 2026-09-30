// packages/lib/src/inventory/builds/reconcile-queries.ts

/**
 * The one read of "every build the system raised against this order", shared by
 * `auto-build-cancel.ts` and the reconciler (plans/products/13-order-build-reconciliation.md §5).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { toBuildRecord } from './build-row'
import type { BuildRecord } from './types'

const logger = createScopedLogger('builds:reconcile-queries')

/** Both callers run inline off an order write, so a pathological order degrades to a logged cap. */
const MAX_BUILDS_PER_ORDER = 1000

/**
 * Every `source: 'order'` build raised against one order, newest first. A `manual` build that
 * names the order is never returned: no automatic path may touch it (plan 13 §5).
 */
export async function readOrderRaisedBuilds(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<BuildRecord[]> {
  const b = schema.Build
  const rows = await db
    .select()
    .from(b)
    .where(and(eq(b.organizationId, organizationId), eq(b.orderId, orderId), eq(b.source, 'order')))
    .orderBy(desc(b.createdAt), desc(b.id))
    .limit(MAX_BUILDS_PER_ORDER + 1)

  if (rows.length > MAX_BUILDS_PER_ORDER) {
    logger.warn('Order has more system-raised builds than the reconcile sweep walks', {
      organizationId,
      orderId,
      cap: MAX_BUILDS_PER_ORDER,
    })
  }
  return rows.slice(0, MAX_BUILDS_PER_ORDER).map(toBuildRecord)
}
