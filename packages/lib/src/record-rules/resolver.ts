// packages/lib/src/record-rules/resolver.ts
// Field-ref resolution for the rule engine. A condition's fieldId (or an action's
// fieldRef) may arrive as a field row id, a systemAttribute, or a field key —
// the snapshot from fetchResourceById keys fieldValues by `systemAttribute ?? id`
// (getFieldOutputKey). This maps every known ref form to that output key.

import type { FieldResolver } from '../conditions/evaluate'
import { getFieldOutputKey, type ResourceField } from '../resources/registry/field-types'

/** Record snapshot shape produced by fetchResourceById for entity instances. */
export interface RecordSnapshot {
  id?: string
  entityDefinitionId?: string
  createdAt?: unknown
  updatedAt?: unknown
  fieldValues?: Record<string, unknown>
  [key: string]: unknown
}

/** Map every ref form (id, key, systemAttribute) of every field to its output key. */
export function buildFieldKeyMap(fields: ResourceField[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const field of fields) {
    const outputKey = getFieldOutputKey(field)
    map.set(String(field.id), outputKey)
    map.set(field.key, outputKey)
    if (field.systemAttribute) map.set(field.systemAttribute, outputKey)
  }
  return map
}

/**
 * Build a conditions FieldResolver over a record snapshot. Unknown refs resolve to
 * `undefined` (so `empty` behaves sensibly); top-level instance columns
 * (createdAt/updatedAt/id) resolve directly.
 */
export function makeSnapshotResolver(fields: ResourceField[]): FieldResolver<RecordSnapshot> {
  const keyMap = buildFieldKeyMap(fields)
  return (record, fieldId) => {
    const key = keyMap.get(fieldId) ?? fieldId
    if (record.fieldValues && key in record.fieldValues) return record.fieldValues[key]
    if (key in record) return record[key]
    return undefined
  }
}
