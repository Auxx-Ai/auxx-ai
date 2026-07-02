// packages/lib/src/field-values/write-key-map.ts
// Pure, zero-dependency — safe to import from anywhere (no cache/db pull-in).

/**
 * Build a `(writeKey → CustomField.id)` map. A writeSet keys a field by EITHER its
 * bare CustomField uuid OR its systemAttribute (system fields like contact's email);
 * `FieldValue.fieldId` is always the uuid, so writers must resolve both key forms back
 * to the uuid. Maps `id → id` AND `systemAttribute → id`; a key absent from the map has
 * no resolvable CustomField (deleted field / stale cache) and is unresolvable.
 *
 * NOTE the direction: this resolves write keys TO row ids. It is NOT the inverse of the
 * snapshot output key (`systemAttribute ?? id`, see record-rules `buildFieldKeyMap`) —
 * don't conflate the two spaces.
 */
export function buildWriteKeyToFieldIdMap(
  fields: Iterable<{ id: string; systemAttribute?: string | null }>
): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of fields) {
    map.set(f.id, f.id)
    if (f.systemAttribute) map.set(f.systemAttribute, f.id)
  }
  return map
}
