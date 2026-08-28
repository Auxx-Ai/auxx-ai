// packages/lib/src/builds/drift-reconciler.ts

/**
 * Keep `order_build_revision` current — and, since phase 5, keep the order's
 * builds current with it (plans/products/13, Model A+ then Model B).
 *
 * The third consumer of `reconcilers/dirty-parents.ts`, after the money totals
 * engine and the three-way match, and the only one that writes RECORDS:
 *
 * 🛑 **Two things happen here, in this order, and the split matters.** First the
 * order is STAMPED with its current demand fingerprint — one field, on the
 * order, exactly as Model A+ shipped it (#1958). Then, and only when the stamp
 * landed, the order's builds are CONVERGED onto that demand by
 * `reconcile-order-builds.ts`. The decision is entirely in `reconcile-policy.ts`
 * and the rails are plan 13 §5: never a `source: 'manual'` build, never an
 * `in_progress` amendment (material may already be cut, §1.0(a)), never a
 * `completed` edit or delete (B6/B8), never a delete at all (AB6).
 *
 * Two keys, for the same reason the other two reconcilers have several: the drain
 * has to know whether it was handed an order or one of its lines.
 *
 * ## Why this one uses `rebuildBatch`
 *
 * It is the only consumer with real per-BATCH setup — the settings read, the
 * order load, the field lookup and the stored-fingerprint read are all done once
 * for the whole batch and then walked. Routing it through the shared per-parent
 * callback would reintroduce exactly the N+1 this plan exists to remove, so
 * `parent-reconciler.ts` carries a batch escape hatch and this is its one caller.
 */

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import { defineParentReconciler, resolveParentsByRelation } from '../reconcilers/parent-reconciler'
import type { ReconcileOrderInput } from './reconcile-order-builds'

const logger = createScopedLogger('builds:drift-reconciler')

export const ORDER_DRIFT_ORDER = 'order-build-drift:order'
export const ORDER_DRIFT_LINE = 'order-build-drift:line_item'

/**
 * `order_build_revision` is declared `updatable: false`, so it has no interactive
 * writer and the reconciler is not acting for any particular person. The empty
 * actor matches what `system-record-rules.ts` passes for the same reason — the
 * wrapped writers never read it.
 *
 * 🛑 **Only the STAMP may use it.** The build mutations reach
 * `UnifiedCrudHandler`, which does read its actor, so the convergence half
 * resolves a real `SystemUserService.getSystemUserForActions(organizationId)` —
 * inside `reconcile-order-builds.ts`, once for the batch, exactly as
 * `auto-build.ts:176` does.
 */
const SYSTEM_STAMP_USER = ''

const orderReconciler = defineParentReconciler<string>({
  key: ORDER_DRIFT_ORDER,
  rebuildBatch: (organizationId, _userId, orderIds) => reconcileOrders(organizationId, orderIds),
})

const lineReconciler = defineParentReconciler<string>({
  key: ORDER_DRIFT_LINE,
  /** The order each line hangs off, in ONE query. */
  resolve: (organizationId, lineInstanceIds) =>
    resolveParentsByRelation(organizationId, 'line_item_order', lineInstanceIds),
  rebuildBatch: (organizationId, _userId, orderIds) => reconcileOrders(organizationId, orderIds),
})

/** Register both drains. Called from `registerAllHooks()`, idempotent per key. */
export function registerOrderDriftReconcilers(): void {
  orderReconciler.register()
  lineReconciler.register()
}

/**
 * Recompute and store each order's demand fingerprint, then converge its builds.
 *
 * ⚠️ **Both halves are gated on `inventory.autoBuildFromOrders`.** With the
 * feature off no order ever raises a build, so nothing can drift from anything
 * and a stamp is a field write bought for nothing — on every order edit, in
 * every org that does not manufacture. This also settles the seed lane by
 * construction (plan 13 §5): the setting is off by default, so a seeded demo
 * order stamps nothing and manufactures nothing.
 *
 * ## ✅ AB8's enablement window — plan 13 Q11, ANSWERED 2026-08-28
 *
 * **The window is split by what the pass DOES, not by which pass it is.**
 *
 * - **Stamping keeps ignoring it**, unchanged from #1958 and for the reason that
 *   PR gave: the window exists so that switching auto-build on does not RAISE
 *   builds for the entire historical backlog (12 AB8), and a stamp raises
 *   nothing — it writes one opaque token. Honouring it here would instead leave
 *   every pre-enablement order permanently unable to show drift, which is the
 *   exact defect 13 §0 is about.
 * - **Applying MUST honour it**, on the same
 *   `isWithinEnablementWindow(order.placedAt, settings.enabledAt)` test the raise
 *   uses (`auto-build-policy.ts:148`, applied at `auto-build.ts:150`). Under
 *   Model B **a reconcile is a raise door** — the whole interactive-path fix is
 *   "a late line raises the first build" — so an unwindowed apply means editing
 *   any back-filled order manufactures against years of Shopify history.
 *
 * The gate itself lives in `reconcile-order-builds.ts`, once, rather than being
 * asserted here and again there: an order outside the window is handed over and
 * comes back as a `before-enablement` skip.
 *
 * ## The no-op guard, and what it costs
 *
 * An order whose stored fingerprint already equals its computed one is skipped
 * **entirely** — no stamp, and no apply either. That is the events/08 R9 win and
 * it is what makes over-delivery from four hook seams harmless.
 *
 * ⚠️ **Its consequence is that a failed apply is not retried until the demand
 * moves again.** Nothing re-drives a drain, and the fingerprint the failing pass
 * stamped is now the stored one. The safety net is that this is precisely the
 * situation Model A+ was built for: the builds still carry their old
 * `build_order_revision`, so `readBuildDrift` reports them as drifted and the
 * divergence stays VISIBLE. B sits on top of A+; it does not replace it.
 *
 * Lazy imports throughout, matching `auto-build-rule.ts`: the query layer pulls
 * `@auxx/database` and the org cache, and this module is reached from
 * `registerAllHooks()`.
 */
async function reconcileOrders(organizationId: string, orderIds: string[]): Promise<void> {
  const ids = orderIds.filter(Boolean)
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

  const toConverge: ReconcileOrderInput[] = []

  for (const order of orders) {
    const fingerprint = orderDemandFingerprint({
      cancelledAt: order.cancelledAt,
      lines: order.lines,
    })
    // Compare before writing, the same guard #1953 and #1956 added to the other
    // two reconcilers: most order edits move no line, and a re-stamp of an
    // identical hash would re-enter the field-value layer, the realtime
    // publisher and the sync manifest for nothing. Since phase 5 it gates the
    // APPLY too — an order whose demand did not move needs no convergence, and
    // this is what stops a build write on every unrelated header edit.
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
      // 🛑 No stamp, no apply. Converging would re-stamp the BUILDS with the new
      // fingerprint while the ORDER still carries the old one, and `hasDrifted`
      // compares exactly those two — so the pass would report drift on the very
      // builds it had just brought into line. Leaving both stale is coherent and
      // self-correcting: the next demand change retries the pair.
      continue
    }

    toConverge.push({
      orderId: order.orderId,
      placedAt: order.placedAt,
      cancelledAt: order.cancelledAt,
      lines: order.lines,
      fingerprint,
    })
  }

  if (toConverge.length === 0) return

  // Model B (plan 13 Q1, events/08 phase 5). Best-effort by contract: it never
  // throws, it isolates per order and per action internally, and its `Result` is
  // consumed here rather than propagated — this runs post-commit and a failure
  // must not surface as a command failure (plan 04 T-6).
  const { reconcileOrderBuilds } = await import('./reconcile-order-builds')
  const converged = await reconcileOrderBuilds(database, organizationId, toConverge)
  if (converged.isErr()) {
    logger.error('Converging order builds failed', {
      organizationId,
      orders: toConverge.length,
      error: converged.error.message,
    })
  }
}

/**
 * Reconcile a batch of orders NOW, with no dirty-parent buffer in play.
 *
 * The **R6(c)** seam of `plans/events/08-derived-parent-reconciler-plan.md` §6.6:
 * sync finalize, off the plan-07 manifest. It exists because the other two
 * seams provably cannot see a connector write —
 * `derivePublishEvents` returns `false` for the `sync` lane, and
 * `field-value-mutations.ts`'s post-hook chain is gated on exactly that — so
 * {@link markOrStampOrderLine} never fires for a value the connector writes
 * (products/13 §1.6 traces the four steps).
 *
 * 🛑 **Takes the whole batch, deliberately.** The caller has already resolved
 * every order the run touched; handing them over one at a time would run the
 * settings read, the order load, the field lookup and the stored-fingerprint
 * read once per order, which is the N+1 this plan exists to remove. The
 * no-op guard inside means an order whose demand did not actually move costs
 * two reads and no writes, so over-delivery from a large manifest is cheap.
 *
 * Never throws — it is called from a finalize door that must not fail a run.
 */
export async function reconcileOrdersFromSync(
  organizationId: string,
  orderIds: string[]
): Promise<void> {
  await reconcileOrders(organizationId, [...new Set(orderIds.filter(Boolean))])
}

/**
 * Mark an order for reconciliation, or reconcile it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `ParentReconciler.mark`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this the order's
 * fingerprint would silently go stale, which is a drift signal that lies — and
 * since phase 5, its builds would silently stop tracking it as well.
 */
export async function markOrStampOrder(organizationId: string, orderId: string): Promise<void> {
  await orderReconciler.mark(organizationId, SYSTEM_STAMP_USER, orderId)
}

/** {@link markOrStampOrder}'s line-side twin. */
export async function markOrStampOrderLine(
  organizationId: string,
  lineInstanceId: string
): Promise<void> {
  await lineReconciler.mark(organizationId, SYSTEM_STAMP_USER, lineInstanceId)
}
