// packages/lib/src/data-connectors/async-export/restitch.ts
// Re-nest a flattened bulk-export JSONL stream back into parent→children records.
// Shopify Bulk Operations (and similar) emit a FLAT line-per-object file: a parent on
// one line, each child on its own line carrying `__parentId` → the parent's `id`. Order
// is NOT guaranteed (a child can precede its parent), so we buffer the whole set, index
// by id, and attach each child onto its parent under a provider-chosen key. Because we
// mutate the shared object references in the index, grandchildren nest correctly too
// (a child attached to its parent already carries the grandchildren attached to it).
//
// Provider-neutral by design (large-dataset-sync §5.2): the connector/driver supplies
// `childKey` to decide which array a given child nests under (e.g. line items vs.
// fulfillments); the engine never branches on provider.

/** How to read the id/parent links and group children. All optional with sane defaults. */
export interface RestitchOptions {
  /** Field carrying each record's own id. Default `'id'`. */
  idField?: string
  /** Field on a child pointing at its parent's id. Default `'__parentId'`. */
  parentField?: string
  /**
   * Which parent-side array a child nests under, derived from the child. Default groups
   * every child under `'__children'`. Shopify keys off the child's `id` gid type
   * (e.g. `gid://shopify/LineItem/…` → `lineItems`).
   */
  childKey?: (child: Record<string, unknown>) => string
}

type Rec = Record<string, unknown>

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Re-nest a flat array of bulk-export rows into top-level records with their children
 * grouped onto them. A row with no (or an unknown) `__parentId` is a top-level record;
 * a row whose `__parentId` matches a known id is appended to that parent under
 * `childKey(child)`. A child whose parent id is absent from the set is surfaced as a
 * top-level record (defensive — no data loss) rather than silently dropped.
 *
 * Input order is irrelevant: the function indexes all rows first, then links them, so a
 * child appearing before its parent (or grandchildren in any order) restitches correctly.
 */
export function restitchByParentId(rows: Iterable<unknown>, options: RestitchOptions = {}): Rec[] {
  const idField = options.idField ?? 'id'
  const parentField = options.parentField ?? '__parentId'
  const childKey = options.childKey ?? (() => '__children')

  const records = [...rows].filter(isRecord)

  // Index by id so a child can find its parent regardless of arrival order.
  const byId = new Map<string, Rec>()
  for (const r of records) {
    const id = r[idField]
    if (typeof id === 'string') byId.set(id, r)
  }

  const tops: Rec[] = []
  for (const r of records) {
    const parentId = r[parentField]
    const parent = typeof parentId === 'string' ? byId.get(parentId) : undefined
    if (!parent) {
      // No parent ref, or a dangling ref → treat as a top-level record.
      tops.push(r)
      continue
    }
    const key = childKey(r)
    const bucket = parent[key]
    if (Array.isArray(bucket)) bucket.push(r)
    else parent[key] = [r]
  }

  return tops
}
