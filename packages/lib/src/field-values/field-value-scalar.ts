// packages/lib/src/field-values/field-value-scalar.ts
// Pure, zero-dependency — safe to import from anywhere (no cache/db/realtime pull-in).

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
    fv.valueJson ??
    fv.optionId ??
    fv.relatedEntityId ??
    fv.actorId ??
    null
  )
}
