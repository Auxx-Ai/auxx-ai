// packages/lib/src/reconcilers/parent-reconciler.ts

/**
 * Phase 3 of `plans/events/08-derived-parent-reconciler-plan.md`: the machinery
 * every dirty-parent consumer was hand-rolling, factored out once.
 *
 * `dirty-parents.ts` is the buffer — it answers *when* work runs. This is the
 * layer above it, and it answers the three questions every consumer of that
 * buffer had to answer identically:
 *
 * 1. how do I register a drain, idempotently;
 * 2. how do I mark, and what do I do when there is no scope to mark into;
 * 3. how do I turn a batch of marked ids into a deduped set of parents and
 *    rebuild each one.
 *
 * Four consumers answered all three the same way, in about sixty lines apiece.
 *
 * ## What this deliberately does NOT contain
 *
 * No `apply`, no `project`, no `revisionAttr`. Plan 08 §4's original contract
 * imagined all three; §4.2 records that when the drift consumer finally shipped
 * it supplied the first two and **did not need the third at all**. So the rule
 * applied here is: a member earns its place when TWO consumers share it. The
 * drift revision stamp, money's document-type ladder and billing's
 * three-projector switch each live in exactly one consumer and each stays there.
 */

import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache } from '../cache'
import { readFieldRelations } from '../field-values/read-field-scalars'
import { markParentDirty, registerReconciler } from './dirty-parents'

/**
 * Turn the ids a drain was handed into the parents that need rebuilding.
 *
 * Batched by contract: it receives the WHOLE batch and is expected to answer in
 * one query, which is the entire reason the drain exists. Returning duplicates is
 * fine — the spec dedupes before rebuilding.
 */
type ResolveParents<P> = (organizationId: string, childInstanceIds: string[]) => Promise<P[]>

interface BaseSpec<P> {
  /** The `dirty-parents` key. One per shape of thing that can be marked. */
  key: string
  /**
   * Present when the marked record is a CHILD of the parent; omitted when the
   * marked record IS the parent.
   */
  resolve?: ResolveParents<P>
  /**
   * Two parents are the same parent when this matches. Defaults to `String(p)`,
   * which is right for the common case where a parent is a bare instance id and
   * wrong for money's, whose parent is `(documentType, instanceId)`.
   */
  dedupeKey?: (parent: P) => string
}

/** Rebuild one parent. The common case. */
interface PerParentSpec<P> extends BaseSpec<P> {
  rebuild: (organizationId: string, userId: string, parent: P) => Promise<void>
  rebuildBatch?: never
}

/**
 * Rebuild a whole deduped batch at once.
 *
 * The escape hatch for a consumer whose rebuild has real per-BATCH setup —
 * `builds/drift-reconciler.ts` loads settings, orders, fields and stored
 * fingerprints once for the batch and then walks it, so forcing it through a
 * per-parent callback would reintroduce exactly the N+1 this whole plan removed.
 */
interface BatchSpec<P> extends BaseSpec<P> {
  rebuildBatch: (organizationId: string, userId: string, parents: P[]) => Promise<void>
  rebuild?: never
}

export type ParentReconcilerSpec<P> = PerParentSpec<P> | BatchSpec<P>

/** What {@link defineParentReconciler} hands back. */
export interface ParentReconciler {
  /**
   * Register the drain. Idempotent per key, so the module-level `let registered`
   * latch every consumer used to carry is no longer needed — `registerReconciler`
   * already ignores a second registration of the same key.
   */
  register: () => void
  /**
   * Mark, or do the work now when nothing will drain.
   *
   * The inline branch is load-bearing, not defensive tidiness.
   * `field-value-mutations`' functions are exported and called directly
   * (`field-hooks/post/purchase-order-line-rollups.ts` calls
   * `setValueWithType(ctx, ...)`), so a write can fire the hook chain without ever
   * passing a public service method. `markParentDirty` returns `false` in exactly
   * that case, and without this branch those writes would silently stop updating
   * derived values, with no error anywhere.
   */
  mark: (organizationId: string, userId: string, markedInstanceId: string) => Promise<void>
}

/**
 * Build one reconciler: a registrable drain plus its mark-or-do-it-inline entry.
 *
 * Call at module scope and keep the handle; call `register()` from the module's
 * `registerXReconcilers()` so registration still happens inside
 * `registerAllHooks()` and not as an import side effect. `mark` works either way
 * — the inline path never consults the registry.
 */
export function defineParentReconciler<P>(spec: ParentReconcilerSpec<P>): ParentReconciler {
  return {
    register: () => {
      registerReconciler(spec.key, async ({ organizationId, userId, parentInstanceIds }) => {
        const parents = await toParents(spec, organizationId, parentInstanceIds)
        await rebuildAll(spec, organizationId, userId, parents)
      })
    },
    mark: async (organizationId, userId, markedInstanceId) => {
      if (markParentDirty(spec.key, markedInstanceId)) return
      const parents = await toParents(spec, organizationId, [markedInstanceId])
      await rebuildAll(spec, organizationId, userId, parents)
    },
  }
}

/**
 * Marked ids to parents. Without a `resolve` the marked record IS the parent, so
 * the ids pass through — the cast is safe because a spec with no `resolve` can
 * only have been written with `P = string`.
 */
function toParents<P>(
  spec: ParentReconcilerSpec<P>,
  organizationId: string,
  markedInstanceIds: string[]
): Promise<P[]> {
  if (!spec.resolve) return Promise.resolve(markedInstanceIds as unknown as P[])
  return spec.resolve(organizationId, markedInstanceIds)
}

/**
 * Dedupe, then rebuild.
 *
 * No per-parent `try`/`catch`, deliberately: this preserves the shipped behaviour
 * exactly. Isolation today is per-KEY, in `drainDirtyParents`, so one parent
 * throwing mid-batch loses the parents after it. Three of the four consumers
 * carry a doc comment claiming otherwise. Fixing that is a behaviour change and
 * is not this refactor's to make.
 */
async function rebuildAll<P>(
  spec: ParentReconcilerSpec<P>,
  organizationId: string,
  userId: string,
  parents: P[]
): Promise<void> {
  if (parents.length === 0) return

  const seen = new Set<string>()
  const deduped: P[] = []
  for (const parent of parents) {
    const key = spec.dedupeKey ? spec.dedupeKey(parent) : String(parent)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(parent)
  }

  if (spec.rebuildBatch) {
    await spec.rebuildBatch(organizationId, userId, deduped)
    return
  }
  for (const parent of deduped) {
    await spec.rebuild(organizationId, userId, parent)
  }
}

/**
 * The parent of each child, through ONE relationship field, in ONE query.
 *
 * Four of the five parent resolutions across the shipped consumers were this
 * function copied verbatim with a different systemAttribute: the vendor bill of a
 * bill line, the work order of a source line, the order of an order line, the
 * purchase order of a PO line. The fifth (money's quote -> invoice-without-work-order
 * -> order ladder) is genuinely different and stays where it is.
 *
 * Returns one entry per child that HAS a parent, in the order the children were
 * given; an orphaned child simply contributes nothing. An org missing the field
 * yields an empty list rather than an error — there is nothing to reconcile, and
 * failing loudly would turn every write in an unmigrated org into a logged error.
 */
export async function resolveParentsByRelation(
  organizationId: string,
  systemAttribute: SystemAttribute,
  childInstanceIds: string[]
): Promise<string[]> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([systemAttribute])
  const relField = fields[systemAttribute]
  if (!relField) return []

  const rels = await readFieldRelations(undefined, organizationId, childInstanceIds, [relField.id])

  const parents: string[] = []
  for (const childInstanceId of childInstanceIds) {
    const parent = rels.get(childInstanceId)?.get(relField.id)
    if (parent) parents.push(parent)
  }
  return parents
}
