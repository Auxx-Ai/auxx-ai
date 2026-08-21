// packages/lib/src/field-values/field-value-scalar.ts
// Pure, zero-dependency — safe to import from anywhere (no cache/db/realtime pull-in).

/**
 * The value half of a `valueJson` envelope (`{ v, meta }`). Inlined rather than
 * imported so this module stays dependency-free.
 *
 * A CURRENCY row carries `{ meta: { currency } }` and NO `v` — it must coalesce
 * to nothing here, so the row falls through to `valueNumber` above, which is
 * where its amount actually lives.
 */
function unwrapEnvelopeValue(json: unknown): unknown {
  if (json === null || json === undefined || typeof json !== 'object' || Array.isArray(json)) {
    return json ?? null
  }
  const obj = json as Record<string, unknown>
  if ('v' in obj) return obj.v
  if ('meta' in obj) return null
  return obj // legacy pre-envelope row: the object IS the value
}

/**
 * Coalesce a raw FieldValue row's typed columns to its flat scalar: the first
 * non-nullish of text/number/boolean/date/json values, then option/relationship/actor
 * refs, else null. `??` keeps falsy-but-set values (`false`, `0`, `''`) intact.
 * Shared by `resource-fetcher` and the record-rules `snapshot-fetcher` so both produce
 * the SAME value space for condition evaluation (a snapshot key is `systemAttribute ??
 * id`; the value comes from here).
 */
export function extractFieldValueScalar(fv: Record<string, unknown>): unknown {
  return (
    fv.valueText ??
    fv.valueNumber ??
    fv.valueBoolean ??
    fv.valueDate ??
    unwrapEnvelopeValue(fv.valueJson) ??
    fv.optionId ??
    fv.relatedEntityId ??
    fv.actorId ??
    null
  )
}
