// packages/lib/src/builds/drift-queries.ts

/**
 * "Has this build drifted from the order that raised it?" — the read side of
 * Model A+ (plans/products/13).
 *
 * 🛑 **No UI ships with this.** Plan 13 Q4 leaves the surface open — a badge, a
 * field, or a signal — and that is a product call this does not make. What it
 * provides is the answer, batched, so the surface is a rendering decision rather
 * than another round of query design.
 */

import type { Database } from '@auxx/database'
import { getOrgCache } from '../cache'
import { readFieldScalars } from '../field-values/read-field-scalars'
import { hasDrifted } from './order-fingerprint'
import type { BuildRecord } from './types'

/** One build's drift verdict. */
export interface BuildDrift {
  buildId: string
  /** The order this build was raised from, or `null` for a hand-raised build. */
  orderId: string | null
  /**
   * `true` only when BOTH stamps exist and differ. A missing stamp on either
   * side is *unknown*, never *drifted* — see {@link hasDrifted}.
   */
  drifted: boolean
}

/**
 * Which of these builds no longer match their order.
 *
 * Two queries regardless of batch size: the field lookup is cached, and every
 * order's current fingerprint comes back in one read. A build with no order, or
 * with no stamp, is reported `drifted: false` without costing anything.
 *
 * ⚠️ Deliberately takes {@link BuildRecord}s rather than ids. Every caller that
 * wants drift is already listing builds, and re-reading them here would be the
 * composed-read problem: a second query answering something the first already
 * had in hand.
 */
export async function readBuildDrift(
  db: Database,
  organizationId: string,
  builds: readonly BuildRecord[]
): Promise<Map<string, BuildDrift>> {
  const out = new Map<string, BuildDrift>()
  for (const build of builds) {
    out.set(build.buildId, {
      buildId: build.buildId,
      orderId: build.orderId,
      drifted: false,
    })
  }
  if (builds.length === 0) return out

  // Only builds that carry BOTH an order and a stamp can drift; everything else
  // is already answered above and must not widen the query.
  const comparable = builds.filter((build) => build.orderId && build.orderRevision)
  if (comparable.length === 0) return out

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['order_build_revision'] as const)
  const revisionField = fields.order_build_revision
  if (!revisionField) return out

  const orderRevisions = await readFieldScalars(
    db,
    organizationId,
    comparable.map((build) => build.orderId as string),
    [revisionField.id]
  )

  for (const build of comparable) {
    const current = orderRevisions.get(build.orderId as string)?.get(revisionField.id)
    out.set(build.buildId, {
      buildId: build.buildId,
      orderId: build.orderId,
      drifted: hasDrifted(build.orderRevision, typeof current === 'string' ? current : null),
    })
  }
  return out
}
