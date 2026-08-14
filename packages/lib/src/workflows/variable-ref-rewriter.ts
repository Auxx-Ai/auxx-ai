// packages/lib/src/workflows/variable-ref-rewriter.ts

/**
 * Generic graph-walking variable-reference rewriter.
 *
 * Extracted from `template-resolution.ts` (originally `rewriteVariablePath` /
 * `mapStringVariablePaths` / `mapVariablePaths`, the machinery behind
 * `@entity:`/`@field:` placeholder resolution at template install). Shared by:
 *
 * - Template install (`template-resolution.ts`'s `resolveEntityRefsInGraph`)
 * - The findMany plural→id `{{…}}` ref DataMigration
 *   (`plans/kopilot/workflow/10-variable-resolution-deep-dive.md` §10b step 5)
 * - (future) paste-node ref rewriting — §4/§10b #5 of the same doc
 *
 * See that doc for the full identity-model background.
 */

/** A `{{ … }}` variable span. Mirrors the engine's own pattern (`execution-context.ts`). */
const VARIABLE_SPAN = /\{\{([^}]+)\}\}/g

/** The first path segment of a variable reference (`find-1.orders[0].x` → `find-1`). */
export function firstPathSegment(path: string): string {
  return path.trim().split(/[.[]/)[0] ?? ''
}

/**
 * Apply `mapPath` to every variable path inside a single string, and only there —
 * the text between `{{` and `}}`, or the whole string when it is a bare variable
 * reference starting with a node id in `nodeIds` (the shape a Tiptap `variable-node`
 * `attrs.variableId`, or a bare config field like `itemsSource`/`variableId`, stores).
 * Ordinary prose is returned untouched, so text that merely contains a `.` or a node
 * id as a substring can never be corrupted.
 */
function mapStringVariablePaths(
  value: string,
  nodeIds: Set<string>,
  mapPath: (path: string) => string
): string {
  if (value.includes('{{')) {
    return value.replace(VARIABLE_SPAN, (_full, inner: string) => `{{${mapPath(inner)}}}`)
  }

  if (nodeIds.has(firstPathSegment(value))) {
    return mapPath(value)
  }

  return value
}

/**
 * Walk every value under `nodeData` and run `mapPath` over the variable paths found
 * in each string, substituting whatever it returns.
 *
 * Object *keys* are deliberately left alone — callers that also need to rewrite
 * keys (e.g. `@field:` placeholder keys) do that in a separate pass before calling
 * this one. `$comment` is template-authoring prose and is never touched.
 */
function mapVariablePaths(
  value: unknown,
  nodeIds: Set<string>,
  mapPath: (path: string) => string
): unknown {
  if (typeof value === 'string') {
    return mapStringVariablePaths(value, nodeIds, mapPath)
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = mapVariablePaths(value[i], nodeIds, mapPath)
    }
    return value
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (key === '$comment') continue
      record[key] = mapVariablePaths(record[key], nodeIds, mapPath)
    }
    return record
  }

  return value
}

/**
 * Rewrite every `{{…}}` variable span and bare variable-id reference inside
 * `nodeData`, applying `mapPath` to each path string found. Object keys are left
 * untouched. Mutates `nodeData` in place (arrays/objects) and returns it — callers
 * that need immutability should clone first, matching the original
 * `resolveEntityRefsInGraph` contract ("caller should clone first").
 *
 * `nodeIds` scopes which bare (non-`{{…}}`) strings are treated as variable
 * references — a bare string is only rewritten when its first path segment names a
 * node in `nodeIds`, so ordinary text fields are never touched.
 *
 * `mapPath` should be a no-op (return the input unchanged) for any path it doesn't
 * recognize — it runs over every `{{…}}` span and every node-id-prefixed bare
 * string in the data, whether or not that specific path is the one the caller
 * cares about.
 */
export function rewriteVariableRefs<T>(
  nodeData: T,
  nodeIds: Set<string>,
  mapPath: (path: string) => string
): T {
  return mapVariablePaths(nodeData, nodeIds, mapPath) as T
}
