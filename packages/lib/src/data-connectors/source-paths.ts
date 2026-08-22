// packages/lib/src/data-connectors/source-paths.ts
// Leaf path helpers shared by the owned-mapping partitioner (`mutations.ts`) and the
// contributing auto-binders (`app-catalog.ts`). Lives in its own dependency-free module
// because `mutations.ts` already imports `app-catalog.ts` — importing back would form a
// cycle and drag drizzle/bullmq into the deliberately dependency-light `app-catalog.ts`.

/**
 * Is `prefix` a path-boundary prefix of `path`? `''` prefixes everything; an exact
 * match counts; otherwise `path` must continue at a boundary (`.` or `[`) so
 * `line_items[]` matches `line_items[].sku` but NOT `line_items_extra[]`.
 */
export function isBoundaryPrefix(path: string, prefix: string): boolean {
  if (prefix === '') return true
  if (!path.startsWith(prefix)) return false
  if (path.length === prefix.length) return true
  const next = path[prefix.length]
  return next === '.' || next === '['
}

/**
 * Strip a `rootPath` prefix off a `path`, leaving it relative to that subtree —
 * `('line_items[].sku', 'line_items[]') → 'sku'`. Used both to relativize a field's
 * sourcePath against its owning mapping AND to relativize a nested child mapping's
 * own (payload-absolute, manifest) rootPath against its parent's rootPath before it
 * is stored (`absolutePrefix`/`subtreeUnder`/`mapRecord` all expect parent-relative).
 * `rootPath` must be a boundary-prefix of `path` (the caller resolves it that way).
 */
export function relativeSourcePath(sourcePath: string, rootPath: string): string {
  if (rootPath === '') return sourcePath
  return sourcePath.slice(rootPath.length).replace(/^\./, '')
}
