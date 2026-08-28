// packages/lib/src/reconcilers/dirty-parents.ts

/**
 * Phase 2 of `plans/events/08-derived-parent-reconciler-plan.md`: collect the
 * parents a write dirtied, drain them ONCE after the write, instead of doing the
 * parent-level work again on every field.
 *
 * The problem this exists for (§1): the post-write hook chain is dispatched per
 * `(record, field)` — `field-value-mutations.ts:3032` on the single path, `:4086`
 * on the bulk path — so a hook that recomputes a whole document runs once per
 * changed ATTRIBUTE. Pasting 20 lines into a quote fires it 40 times, and each
 * fire re-derives the same document. #1953 made one fire cheap; this makes 40
 * fires into one.
 *
 * ## The contract
 *
 * A hook does exactly one thing: {@link markParentDirty}. It performs no reads
 * and no writes of its own. The registered {@link ReconcilerDrain} then receives
 * the whole batch, once, and is expected to read current database truth — never
 * to reconstruct state from what the hooks saw.
 *
 * ## Why an ALS of its own, and not a field on `WriteSession`
 *
 * A `UnifiedCrudHandler` constructed once and used for two sequential writes
 * carries ONE `WriteSession` object across both (`unified-handler.ts:198`), so a
 * buffer hung off the session would leak the first write's parents into the
 * second write's drain. The scope has to track the async activation, not the
 * session object.
 *
 * ## Where it drains (plan 08 §8 Q1)
 *
 * Two exits, because the two write shapes conflict:
 *
 * - **Not in a transaction** — drain on the way out of the outermost write
 *   method. This is the interactive path, which does not always open one.
 * - **Inside `runInTxWrite`** — hand the buffer to the ambient `TxWriteScope` and
 *   let `flushTxWriteScope` drain it after COMMIT. Draining in place would run a
 *   reconciler against uncommitted state on a different connection, which is the
 *   silent failure plan 04's T-4 exists to prevent.
 *
 * Nesting JOINS, exactly as `runInTxWrite` does it: an inner write that finds an
 * ambient scope contributes to it and does not drain, so the outermost owner
 * drains once for everyone.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('reconcilers:dirty-parents')

/**
 * Cap on distinct parents buffered per reconciler, per scope.
 *
 * Beyond it the scope is {@link DirtyParentScope.truncated} and further parents
 * are DROPPED — which for a derived value means it stays stale until something
 * recomputes it. That is tolerable only because every consumer has a second
 * door: money's is `money.recomputeTotals` (the documented manual drift escape)
 * plus `events/handlers/finalize-integrity-passes.ts`, which recomputes a
 * synced/imported run's parents off the manifest. A consumer WITHOUT such a door
 * must not rely on this buffer alone.
 *
 * One interactive write touches one document, so this is a guard against a
 * runaway bulk operation, not a working limit.
 */
export const MAX_DIRTY_PARENTS_PER_KEY = 500

/** Drains one reconciler's whole batch. Reads current truth; never throws. */
export type ReconcilerDrain = (params: {
  organizationId: string
  userId: string
  /** Distinct, in first-marked order. Never empty. */
  parentInstanceIds: string[]
}) => Promise<void>

/** The buffer for ONE write scope. Plain values only — see {@link DirtyParentScope}. */
export interface DirtyParentScope {
  organizationId: string
  userId: string
  /** reconciler key -> parent entity-instance ids. Insertion-ordered. */
  readonly dirty: Map<string, Set<string>>
  /** One pass, ever. See {@link drainDirtyParents}. */
  drained: boolean
  /** Some parent was dropped at {@link MAX_DIRTY_PARENTS_PER_KEY}. */
  truncated: boolean
}

const als = new AsyncLocalStorage<DirtyParentScope>()

const reconcilers = new Map<string, ReconcilerDrain>()

/**
 * Register the drain for a reconciler key. Called from `registerAllHooks()`.
 * Idempotent per key — a second registration of the same key is ignored, so a
 * double bootstrap cannot install two drains that both write.
 */
export function registerReconciler(key: string, drain: ReconcilerDrain): void {
  if (reconcilers.has(key)) return
  reconcilers.set(key, drain)
}

/** Test seam. Never call from production code. */
export function __resetReconcilersForTest(): void {
  reconcilers.clear()
}

/**
 * Note that `parentInstanceId` needs `key`'s reconciler to run.
 *
 * @returns `false` ONLY when there is no ambient scope — meaning nothing will
 * drain this and **the caller must do the work inline**. That fallback is not
 * defensive tidiness: `field-value-mutations`' functions are exported and called
 * directly (`field-hooks/post/purchase-order-line-rollups.ts` calls
 * `setValueWithType(ctx, …)`), so a write can fire hooks without ever passing a
 * public service method. Without the fallback those writes would silently stop
 * updating derived values — a regression with no error anywhere.
 *
 * `true` means "handled, do nothing", which covers both the buffered case and
 * the two deliberate drops below.
 *
 * ⚠️ Takes an entity INSTANCE id, never a `RecordId`. RecordIds reach this layer
 * in two keyspaces — `handler.create` builds them from the canonical
 * `EntityDefinition.id`, money's own writers from the type slug — and the two
 * never compare equal for the same record, so a Set of them would not dedupe.
 * Same argument `tx-write-flush.ts`'s `instanceIdOf` records.
 */
export function markParentDirty(key: string, parentInstanceId: string): boolean {
  if (!parentInstanceId) return true
  const scope = als.getStore()
  if (!scope) return false
  if (scope.drained) {
    // A write issued BY a drain. Dropping is deliberate: re-marking would make
    // the pass re-entrant, and a reconciler that dirties its own parent is a
    // loop, not a missed update. Reported as handled so the caller does NOT
    // fall back to doing it inline, which is the same loop by another route.
    logger.debug('markParentDirty after drain, ignored', { key, parentInstanceId })
    return true
  }

  let ids = scope.dirty.get(key)
  if (!ids) {
    ids = new Set()
    scope.dirty.set(key, ids)
  }
  if (ids.size >= MAX_DIRTY_PARENTS_PER_KEY && !ids.has(parentInstanceId)) {
    if (!scope.truncated) {
      scope.truncated = true
      logger.error('dirty-parent buffer truncated; some derived values will stay stale', {
        key,
        cap: MAX_DIRTY_PARENTS_PER_KEY,
        organizationId: scope.organizationId,
      })
    }
    // Handled, not unscoped: falling back inline here would do the very work the
    // cap exists to bound, one synchronous recompute at a time.
    return true
  }
  ids.add(parentInstanceId)
  return true
}

/**
 * Run `fn` with a dirty-parent scope, draining on the way out when this call
 * OWNS the scope.
 *
 * Joined calls (an ambient scope already exists) simply run `fn` — they
 * contribute to the outer buffer and the outer owner drains for everyone. This
 * is what makes it safe to wrap every public write method: a
 * `UnifiedCrudHandler.create` whose hooks construct their own handler nests
 * freely and still produces one drain.
 */
export async function runWithDirtyParents<T>(
  organizationId: string,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (als.getStore()) return fn()

  const scope: DirtyParentScope = {
    organizationId,
    userId,
    dirty: new Map(),
    drained: false,
    truncated: false,
  }

  const result = await als.run(scope, fn)

  // Resolving path only. A throw takes the scope with it: the write failed, so
  // there is nothing to reconcile, and draining a rolled-back attempt is exactly
  // the failure `runInTxWrite`'s per-attempt contract (T-5) exists to prevent.
  const deferred = await handOffToTransaction(scope)
  if (!deferred) await drainDirtyParents(scope)
  return result
}

/**
 * Give a buffered composition's parents to its `TxWriteScope` so
 * `flushTxWriteScope` drains them after COMMIT. Returns whether it took them.
 *
 * Lazy-imported for the reason `tx-write-flush.ts` records about its own
 * imports: the crud barrel's module evaluation order is load-bearing for the
 * cycle that runs through `@auxx/lib/cache`, and this module is reached FROM
 * that barrel.
 */
async function handOffToTransaction(scope: DirtyParentScope): Promise<boolean> {
  if (scope.dirty.size === 0) return true // nothing to drain, either way
  try {
    const { getAmbientTxWriteScope } = await import('../resources/crud/tx-write-scope')
    const tx = getAmbientTxWriteScope()
    if (!tx) return false
    for (const [key, ids] of scope.dirty) {
      let target = tx.dirtyParents.get(key)
      if (!target) {
        target = new Set()
        tx.dirtyParents.set(key, target)
      }
      for (const id of ids) target.add(id)
    }
    scope.dirty.clear()
    return true
  } catch (error) {
    // Never let the handoff itself lose the work — drain in place instead.
    logger.error('dirty-parent handoff to transaction failed; draining in place', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Run every registered reconciler over what the scope collected, once.
 *
 * BEST-EFFORT, per key. The write has already happened and a caller has nothing
 * useful to do with a reconciler failure, so a throw here must never surface as
 * a command failure — and one reconciler failing must not lose another's batch.
 * Same rule as `flushTxWriteScope` (plan 04 T-6).
 */
export async function drainDirtyParents(scope: DirtyParentScope): Promise<void> {
  if (scope.drained) return
  scope.drained = true
  if (scope.dirty.size === 0) return

  for (const [key, ids] of scope.dirty) {
    if (ids.size === 0) continue
    const drain = reconcilers.get(key)
    if (!drain) {
      logger.error('no reconciler registered for a dirtied key', { key, count: ids.size })
      continue
    }
    try {
      await drain({
        organizationId: scope.organizationId,
        userId: scope.userId,
        parentInstanceIds: [...ids],
      })
    } catch (error) {
      logger.error('reconciler drain failed', {
        key,
        count: ids.size,
        organizationId: scope.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  scope.dirty.clear()
}

/**
 * Drain a set collected inside a transaction, after it committed. The
 * `TxWriteScope` carries plain `Map<string, Set<string>>`, not a scope, so this
 * rebuilds the shape {@link drainDirtyParents} takes.
 */
export async function drainDeferredDirtyParents(params: {
  organizationId: string
  userId: string
  dirty: Map<string, Set<string>>
}): Promise<void> {
  if (params.dirty.size === 0) return
  await drainDirtyParents({
    organizationId: params.organizationId,
    userId: params.userId,
    dirty: params.dirty,
    drained: false,
    truncated: false,
  })
}
