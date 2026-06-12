// packages/lib/src/agents/scaffold-from-json-schema.ts

/**
 * Best-effort empty-but-correctly-shaped seed from a JSON Schema, so the eval
 * mock editor offers a valid starting point off `outputsJsonSchema` without the
 * Zod schema (which never crosses the wire). Client-safe and additive — the
 * server-side suggester keeps the Zod-internals `scaffoldFromSchema`
 * (`evals/simulation/mock-tools.ts`); the real guard remains `eval.validateMock`
 * on edit. Returns `undefined` for an absent/empty schema (free-form mock).
 */
export function scaffoldFromJsonSchema(
  schema: Record<string, unknown> | null | undefined
): unknown {
  if (!schema || Object.keys(schema).length === 0) return undefined
  try {
    return walk(schema, 0)
  } catch {
    return null
  }
}

/** Recursion guard — a pathological/self-referencing schema collapses to null. */
const MAX_DEPTH = 16

function walk(node: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return null
  const s = node as Record<string, unknown>

  if (s.const !== undefined) return s.const
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]

  const variants = s.anyOf ?? s.oneOf
  if (Array.isArray(variants) && variants.length > 0) return walk(variants[0], depth + 1)

  // Nullable unions emit `type: ['string', 'null']` — seed the first concrete type.
  const type = Array.isArray(s.type) ? s.type[0] : s.type
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries((s.properties ?? {}) as Record<string, unknown>)) {
        out[key] = walk(child, depth + 1)
      }
      return out
    }
    case 'array':
      return s.items != null ? [walk(s.items, depth + 1)] : []
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    default:
      // Emitters may omit `type` on object nodes that carry `properties`.
      if (s.properties != null) return walk({ ...s, type: 'object' }, depth)
      return null
  }
}
