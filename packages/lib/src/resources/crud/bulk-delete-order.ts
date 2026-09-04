// packages/lib/src/resources/crud/bulk-delete-order.ts
//
// The definition ORDER a bulk delete runs in, and which lane each definition
// takes. Pure — no db, no registry read — so the ordering can be asserted
// against the live hook registry by a test without booting anything.
// See plans/records/bulk-delete-at-scale.md §5.4.

/**
 * Hooked definitions that a DIFFERENT hooked definition's pre-delete hook
 * cascades away, listed by `apiSlug`.
 *
 * 🛑 **These must be deleted BEFORE their parents, and the reason is not
 * performance.** `cascadeOrderLinesOnDelete` deletes an order's line items as
 * part of deleting the order. If a batch holds an order and its lines and the
 * order goes first, the lines are already gone by the time the loop reaches
 * them — `deleteEntity` throws `Entity not found`, and `bulkDeleteEntities`
 * files that under `errors[]`, so the user is told records "failed to delete"
 * that were in fact deleted correctly. Same shape for a vendor bill and its
 * lines.
 *
 * Ordering the other way is always safe: a parent whose children are already
 * gone simply cascades nothing.
 */
export const HOOKED_CHILD_DEF_SLUGS = ['line-items', 'vendor-bill-lines'] as const

/**
 * Hooked definitions that own a cascade, a refusal, or both. Deleted after
 * {@link HOOKED_CHILD_DEF_SLUGS}.
 *
 * Membership here is not a claim about parenthood — `tags` and `tariff-codes`
 * cascade nothing downward — only that these run in the second wave. What
 * matters is that nothing in {@link HOOKED_CHILD_DEF_SLUGS} runs after them.
 */
export const HOOKED_PARENT_DEF_SLUGS = [
  'orders',
  'invoices',
  'quotes',
  'work-orders',
  'parts',
  'builds',
  'purchase-orders',
  'vendor-bills',
  'tariff-codes',
  // A refusal only: a posted or reversed entry is never deletable, and a draft
  // cascades nothing (plans/accounting/tasks/09 §3.3). It is here rather than in
  // the child tier because nothing it owns needs to run before it.
  'journal-entries',
  'tags',
] as const

/**
 * Every definition slug this module knows carries pre/post-delete hooks.
 *
 * A test asserts this equals the live registry's key set exactly, so registering
 * a hook for a new entity is one atomic change: add the registration, place the
 * slug in one of the two tiers above. Falling off the list would silently put a
 * guarded entity on the batched lane, which skips guards entirely.
 */
export const KNOWN_HOOKED_DEF_SLUGS: readonly string[] = [
  ...HOOKED_CHILD_DEF_SLUGS,
  ...HOOKED_PARENT_DEF_SLUGS,
]

/** Which lane a definition's records take in a bulk delete. */
export type BulkDeleteLane =
  /** Per record, through `deleteEntity`, so its guards and cascades run. */
  | 'guarded'
  /** Set-based. Only for definitions the hook registry says are empty. */
  | 'batched'

/** A definition's slice of a bulk delete. */
export interface BulkDeleteGroup<T> {
  /** The `RecordId` definition part as the caller wrote it. */
  entityDefinitionId: string
  /** Resolved `apiSlug`, or `null` when the definition has none. */
  apiSlug: string | null
  lane: BulkDeleteLane
  items: T[]
}

/**
 * Rank a definition for the delete order. Lower runs first.
 *
 * A hooked slug not named in either tier gets a rank BETWEEN them: it is not
 * known to be a cascaded child, so it must not run in the first wave, and it is
 * not known to be safe after the parents either. The registry-parity test makes
 * this branch unreachable in practice; it exists so a newly registered hook
 * degrades to "runs in the middle, guarded" rather than to a crash or to the
 * batched lane.
 */
function rank(lane: BulkDeleteLane, apiSlug: string | null): number {
  if (lane === 'batched') return 3
  if (apiSlug && (HOOKED_CHILD_DEF_SLUGS as readonly string[]).includes(apiSlug)) return 0
  if (apiSlug && (HOOKED_PARENT_DEF_SLUGS as readonly string[]).includes(apiSlug)) return 2
  return 1
}

/**
 * Order a bulk delete's definition groups: cascaded children, then unknown
 * hooked definitions, then hooked parents, then everything batchable.
 *
 * Batched definitions run LAST on purpose. A guarded parent may cascade records
 * of a batchable definition (`guardPartDelete` removes `subpart`, `vendor_part`
 * and `stock_movement` rows), and the set-based delete simply removes fewer
 * rows than it named — no error, and the returned count stays honest because it
 * reports what the `DELETE` actually removed. The reverse order would work too;
 * this one just does less work.
 *
 * Stable within a rank, so a caller's own ordering survives.
 */
export function orderBulkDeleteGroups<T>(
  groups: readonly BulkDeleteGroup<T>[]
): BulkDeleteGroup<T>[] {
  return [...groups]
    .map((group, index) => ({ group, index, rank: rank(group.lane, group.apiSlug) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.group)
}
