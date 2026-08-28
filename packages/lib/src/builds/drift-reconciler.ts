// packages/lib/src/builds/drift-reconciler.ts

/**
 * Keep `order_build_revision` current, so a build raised from this order can be
 * seen to have drifted from it (plans/products/13 Model A+).
 *
 * The third consumer of `reconcilers/dirty-parents.ts`, after the money totals
 * engine and the three-way match, and by far the least ambitious:
 *
 * 🛑 **It writes exactly one field, on the ORDER, and never touches a build.**
 * Not `createBuild`, not `cancelBuild`, not `quantityPlanned`. Plan 13 §1.5
 * forbids automation from amending an `in_progress` build (material may already
 * be cut) and B6/B8 forbid it absolutely for a `completed` one — but the reason
 * this reconciler touches none of them is simpler than either rule: Model A+ was
 * chosen precisely so that plan 13 Q1 stays open. Turning that into real
 * reconciliation is phase 5, and it needs a product decision first.
 *
 * Two keys, for the same reason the other two reconcilers have several: the drain
 * has to know whether it was handed an order or one of its lines.
 */

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import { readFieldRelations } from '../field-values/read-field-scalars'
import { markParentDirty, registerReconciler } from '../reconcilers/dirty-parents'

const logger = createScopedLogger('builds:drift-reconciler')

export const ORDER_DRIFT_ORDER = 'order-build-drift:order'
export const ORDER_DRIFT_LINE = 'order-build-drift:line_item'

let registered = false

/** Register both drains. Called from `registerAllHooks()`, idempotent. */
export function registerOrderDriftReconcilers(): void {
  if (registered) return
  registered = true

  registerReconciler(ORDER_DRIFT_ORDER, async ({ organizationId, parentInstanceIds }) => {
    await stampOrders(organizationId, parentInstanceIds)
  })

  registerReconciler(ORDER_DRIFT_LINE, async ({ organizationId, parentInstanceIds }) => {
    const orderIds = await resolveOrdersForLines(organizationId, parentInstanceIds)
    await stampOrders(organizationId, orderIds)
  })
}

/**
 * Recompute and store each order's demand fingerprint.
 *
 * ⚠️ **Gated on `inventory.autoBuildFromOrders`.** With the feature off no order
 * ever raises a build, so nothing can drift from anything and a stamp is a field
 * write bought for nothing — on every order edit, in every org that does not
 * manufacture. This also settles the seed lane by construction: the setting is
 * off by default, so a seeded demo org stamps nothing.
 *
 * 🛑 **AB8's enablement window is deliberately NOT applied here, and that is a
 * position on plan 13 Q11 rather than an oversight.** The window exists so that
 * switching auto-build on does not RAISE builds for the entire historical
 * backlog (12 AB8). This raises nothing — it writes one opaque token — and
 * honouring the window here would instead leave every pre-enablement order
 * permanently unable to show drift, which is the exact defect 13 §0 is about.
 * The reasoning holds only while this reconciler mutates nothing; **phase 5 must
 * revisit it before `apply` is turned on.** Q11 stays open.
 *
 * Lazy imports throughout, matching `auto-build-rule.ts`: the query layer pulls
 * `@auxx/database` and the org cache, and this module is reached from
 * `registerAllHooks()`.
 */
async function stampOrders(organizationId: string, orderIds: string[]): Promise<void> {
  const ids = [...new Set(orderIds)].filter(Boolean)
  if (ids.length === 0) return

  const [{ loadAutoBuildSettings }, { database }] = await Promise.all([
    import('./auto-build-settings'),
    import('@auxx/database'),
  ])
  const settings = await loadAutoBuildSettings(organizationId)
  if (!settings.enabled) return

  const [{ loadAutoBuildOrders }, { orderDemandFingerprint }] = await Promise.all([
    import('./auto-build-queries'),
    import('./order-fingerprint'),
  ])

  const [orders, fields, orderDefId] = await Promise.all([
    loadAutoBuildOrders(database, organizationId, ids),
    getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['order_build_revision'] as const),
    getCachedEntityDefId(organizationId, 'order'),
  ])

  const revisionField = fields.order_build_revision
  // An org short of migration 111 has no field to stamp. Silent rather than
  // loud: the migration closes it, and a logged failure per order edit until
  // then would be noise about a state that fixes itself.
  if (!revisionField || !orderDefId) return

  const { readFieldScalars } = await import('../field-values/read-field-scalars')
  const stored = await readFieldScalars(
    database,
    organizationId,
    orders.map((order) => order.orderId),
    [revisionField.id]
  )

  for (const order of orders) {
    const fingerprint = orderDemandFingerprint({
      cancelledAt: order.cancelledAt,
      lines: order.lines,
    })
    // Compare before writing, the same guard #1953 and #1956 added to the other
    // two reconcilers: most order edits move no line, and a re-stamp of an
    // identical hash would re-enter the field-value layer, the realtime
    // publisher and the sync manifest for nothing.
    if (stored.get(order.orderId)?.get(revisionField.id) === fingerprint) continue

    // One order failing must not lose the rest of the batch.
    try {
      const service = new FieldValueService(organizationId, SYSTEM_STAMP_USER, database)
      await service.setValuesForEntity({
        recordId: toRecordId(orderDefId, order.orderId),
        values: [{ fieldId: revisionField.id, value: fingerprint }],
      })
    } catch (error) {
      logger.error('Failed to stamp order demand fingerprint', {
        organizationId,
        orderId: order.orderId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * `order_build_revision` is declared `updatable: false`, so it has no interactive
 * writer and the reconciler is not acting for any particular person. The empty
 * actor matches what `system-record-rules.ts` passes for the same reason — the
 * wrapped writers never read it.
 */
const SYSTEM_STAMP_USER = ''

/**
 * The order each line hangs off, in ONE query — the pattern
 * `purchasing/match-reconciler.ts` established.
 */
async function resolveOrdersForLines(
  organizationId: string,
  lineInstanceIds: string[]
): Promise<string[]> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_order'] as const)
  const relField = fields.line_item_order
  if (!relField) return []

  const rels = await readFieldRelations(undefined, organizationId, lineInstanceIds, [relField.id])

  const orderIds: string[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const orderId = rels.get(lineInstanceId)?.get(relField.id)
    if (orderId) orderIds.push(orderId)
  }
  return orderIds
}

/**
 * Mark an order for re-stamping, or re-stamp it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `markParentDirty`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this the order's
 * fingerprint would silently go stale, which is a drift signal that lies.
 */
export async function markOrStampOrder(organizationId: string, orderId: string): Promise<void> {
  if (markParentDirty(ORDER_DRIFT_ORDER, orderId)) return
  await stampOrders(organizationId, [orderId])
}

/** {@link markOrStampOrder}'s line-side twin. */
export async function markOrStampOrderLine(
  organizationId: string,
  lineInstanceId: string
): Promise<void> {
  if (markParentDirty(ORDER_DRIFT_LINE, lineInstanceId)) return
  const orderIds = await resolveOrdersForLines(organizationId, [lineInstanceId])
  await stampOrders(organizationId, orderIds)
}
