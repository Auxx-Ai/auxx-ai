// packages/lib/src/ai/agent-framework/context/path-walker.ts

/**
 * The one shared in-value path resolver (chat v9, hazard 3: "we do not write a
 * second path resolver"). Lifted from `ExecutionContextManager`'s navigation
 * branches so the kopilot store and the workflow ECM navigate materialized
 * values identically — divergence here would silently cause bugs.
 *
 * The split is deliberate: *resolving a ref to its root value* is source-
 * specific, async, and may lazy-load (stays in each store); *navigating within
 * an already-materialized value* is this pure, synchronous function.
 *
 * Supported path syntax (matches ECM `resolveNestedObject` + `resolveVariablePath`):
 *   - dotted descent           `cart.total`
 *   - `.first` / `.last`       array endpoints
 *   - numeric segment          `items.0`
 *   - bracket index            `items[0]`, `items[-1]`  (negative = from end)
 *   - bracket splat            `items[*]` (the array) / `orders[*].id` (map rest over each)
 *   - leading bracket          `[0].name` when the root itself is an array
 *   - `fieldValues` fallback   entity instances expose fields under `.fieldValues`
 */
export function walkPath(root: unknown, path: string): unknown {
  if (!path) return root
  return navigate(root, path.split('.'))
}

/** Read a property, falling back to an entity instance's `fieldValues` map. */
function getProp(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined
  const record = obj as Record<string, unknown>
  if (record[key] !== undefined) return record[key]
  const fieldValues = record.fieldValues as Record<string, unknown> | undefined
  if (fieldValues && fieldValues[key] !== undefined) return fieldValues[key]
  return undefined
}

function navigate(start: unknown, segments: string[]): unknown {
  let current = start

  for (let i = 0; i < segments.length; i++) {
    if (current === null || current === undefined) return undefined
    const segment = segments[i]!

    // `.first` / `.last` on arrays
    if (segment === 'first' && Array.isArray(current)) {
      current = current[0]
      continue
    }
    if (segment === 'last' && Array.isArray(current)) {
      current = current[current.length - 1]
      continue
    }

    // Bare numeric segment on an array (e.g. `items.0`)
    if (/^\d+$/.test(segment) && Array.isArray(current)) {
      current = current[Number.parseInt(segment, 10)]
      continue
    }

    // `key[idx]`, `[idx]`, `key[*]`, `[*]`
    const bracket = segment.match(/^([^[]*)\[(-?\d+|\*)\]$/)
    if (bracket) {
      const key = bracket[1] ?? ''
      const index = bracket[2]!
      const array = key ? getProp(current, key) : current
      if (!Array.isArray(array)) return undefined

      if (index === '*') {
        const rest = segments.slice(i + 1)
        return rest.length === 0 ? array : array.map((element) => navigate(element, rest))
      }

      const idx = Number.parseInt(index, 10)
      current = idx < 0 ? array[array.length + idx] : array[idx]
      continue
    }

    // Plain property access (with `fieldValues` fallback)
    current = getProp(current, segment)
  }

  return current
}
