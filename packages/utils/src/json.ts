// packages/utils/src/json.ts

/**
 * Deterministic, key-order-independent JSON serialization. Recursively sorts
 * object keys (bytewise) and drops `undefined` object values, so two
 * structurally-equal values serialize to the identical string regardless of key
 * insertion order. Array order is preserved.
 *
 * This is the canonical fix for Postgres `jsonb` round-trips: `jsonb` does NOT
 * preserve object key insertion order, so a plain `JSON.stringify` of an
 * in-memory value won't match the same value read back from a `jsonb` column.
 * Serialize both sides with this and they match. Single-pass — no intermediate
 * object is allocated (use {@link canonicalize} when you need the object form).
 *
 * PURE. Top-level `undefined` serializes to `'null'`; mirrors `JSON.stringify`
 * for every other primitive. Does not handle circular references, `Map`/`Set`,
 * or class instances.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${stableStringify(obj[key])}`)
  }
  return `{${parts.join(',')}}`
}

/**
 * Recursively produce a canonical clone with object keys sorted (bytewise) and
 * `undefined` object values dropped, so structurally-equal values become
 * deep-equal regardless of key insertion order. Array order is preserved. The
 * input is not mutated.
 *
 * Use this when you need the canonical *object* (to store, diff, or redact); use
 * {@link stableStringify} when you only need a canonical string. PURE.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key]
    if (v === undefined) continue
    out[key] = canonicalize(v)
  }
  return out
}
