// packages/lib/src/json-schema/infer.ts

/**
 * Single-sample JSON Schema inference.
 *
 * Given one concrete runtime value (an MCP tool result, a webhook body sample,
 * …) produce a permissive JSON Schema describing its shape. Because one sample
 * is not a contract, the output is deliberately loose:
 *
 * - **No `required`** — every property is optional, so a second sample with a
 *   missing key never produces a false validation error.
 * - **No `additionalProperties: false`** — extra keys are allowed.
 * - Arrays infer `items` from a shallow union of the first few elements.
 * - `null` collapses into a `['<seen>', 'null']` type union when mixed with a
 *   concrete type, or a bare `{ type: 'null' }` when that is all we saw.
 * - ISO date-time strings are detected as `format: 'date-time'`; no other
 *   format guessing.
 *
 * Pure and dependency-free — safe to call from both server and client code via
 * the `@auxx/lib/json-schema/client` export.
 */

/** JSON Schema is structurally just a keyword bag; we only ever read a few keys. */
export type JsonSchema = Record<string, unknown>

/** How many array elements to sample when inferring `items`. */
const ARRAY_SAMPLE = 5

/** Strict ISO-8601 date-time matcher (the only format we auto-detect). */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

/**
 * Infer a JSON Schema from a single runtime value.
 *
 * The result describes `value` directly — a string value yields
 * `{ type: 'string' }`, not an object envelope. Callers that need a guaranteed
 * object root (e.g. structured-output editors) should wrap non-object results
 * themselves.
 */
export function inferJsonSchema(value: unknown): JsonSchema {
  return inferNode(value)
}

function inferNode(value: unknown): JsonSchema {
  if (value === null || value === undefined) return { type: 'null' }
  if (Array.isArray(value)) return inferArray(value)

  switch (typeof value) {
    case 'string':
      return inferString(value)
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object':
      return inferObject(value as Record<string, unknown>)
    default:
      // bigint / symbol / function — not JSON-representable; fall back to string.
      return { type: 'string' }
  }
}

function inferString(value: string): JsonSchema {
  if (ISO_DATE_TIME.test(value)) return { type: 'string', format: 'date-time' }
  return { type: 'string' }
}

function inferObject(value: Record<string, unknown>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const [key, val] of Object.entries(value)) {
    properties[key] = inferNode(val)
  }
  return { type: 'object', properties }
}

function inferArray(arr: unknown[]): JsonSchema {
  if (arr.length === 0) return { type: 'array', items: {} }
  const sampled = arr.slice(0, ARRAY_SAMPLE).map(inferNode)
  return { type: 'array', items: mergeNodes(sampled) }
}

/**
 * Merge several inferred nodes (the sampled elements of an array) into one.
 * Same-shaped objects union their properties; differing scalars collapse to a
 * `type` array; `null` becomes a `'null'` member of that union.
 */
function mergeNodes(nodes: JsonSchema[]): JsonSchema {
  const hasNull = nodes.some((n) => nodeIncludesType(n, 'null'))
  const nonNull = nodes.filter((n) => !isOnlyNull(n))

  if (nonNull.length === 0) return { type: 'null' }

  // All objects → union of properties (each recursively merged, all optional).
  if (nonNull.every((n) => n.type === 'object')) {
    return maybeNullable(mergeObjects(nonNull), hasNull)
  }

  // All arrays → merge their item schemas.
  if (nonNull.every((n) => n.type === 'array')) {
    const itemNodes = nonNull
      .map((n) => n.items)
      .filter((i): i is JsonSchema => !!i && typeof i === 'object')
    const items = itemNodes.length > 0 ? mergeNodes(itemNodes) : {}
    return maybeNullable({ type: 'array', items }, hasNull)
  }

  // Scalars / mixed → collapse to a `type` union (dropping per-node formats,
  // which can't survive a union cleanly).
  const types = unique(
    nonNull.flatMap((n) => (Array.isArray(n.type) ? (n.type as string[]) : [n.type as string]))
  )
  const allTypes = hasNull ? unique([...types, 'null']) : types
  return { type: allTypes.length === 1 ? allTypes[0] : allTypes }
}

function mergeObjects(nodes: JsonSchema[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const node of nodes) {
    const props = (node.properties ?? {}) as Record<string, JsonSchema>
    for (const [key, schema] of Object.entries(props)) {
      properties[key] = properties[key] ? mergeNodes([properties[key], schema]) : schema
    }
  }
  return { type: 'object', properties }
}

/** Add `'null'` to a node's `type` (string → array, array → deduped array). */
function maybeNullable(node: JsonSchema, hasNull: boolean): JsonSchema {
  if (!hasNull) return node
  const t = node.type
  if (typeof t === 'string') return { ...node, type: [t, 'null'] }
  if (Array.isArray(t)) return { ...node, type: unique([...(t as string[]), 'null']) }
  return node
}

function nodeIncludesType(node: JsonSchema, type: string): boolean {
  if (node.type === type) return true
  return Array.isArray(node.type) && (node.type as string[]).includes(type)
}

function isOnlyNull(node: JsonSchema): boolean {
  return node.type === 'null'
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
