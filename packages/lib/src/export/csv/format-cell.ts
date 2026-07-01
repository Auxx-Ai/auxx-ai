// packages/lib/src/export/csv/format-cell.ts

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { formatToDisplayValue } from '../../field-values/formatter'
import type { TypedFieldValueResult } from '../../field-values/types'

/**
 * Extract the related RecordIds a relationship cell points at (single or array).
 * These are the ids the export must hydrate to display names — bare RecordIds
 * are what `batchGetValues` returns for relationships.
 */
export function extractRelationRecordIds(result: TypedFieldValueResult): RecordId[] {
  if (result.fieldType !== FieldType.RELATIONSHIP || result.value == null) return []
  const values = Array.isArray(result.value) ? result.value : [result.value]
  const ids: RecordId[] = []
  for (const value of values) {
    const recordId = (value as { recordId?: RecordId } | null)?.recordId
    if (recordId) ids.push(recordId)
  }
  return ids
}

/** Coerce a single formatted display value to a raw (unescaped) CSV cell string. */
function toRawString(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Format one field-value result into a raw (unescaped) CSV cell string.
 *
 * - `RELATIONSHIP` → display name(s) from `nameCache`, falling back to the raw
 *   RecordId when a name hasn't been resolved.
 * - `ACTOR` and everything else → `formatToDisplayValue` (the actor converter
 *   already returns `displayName`).
 * - Multi-value / array results are joined with `", "`.
 *
 * Escaping is applied later by the row serializer (`csvCell`), so this returns
 * the raw string.
 */
export function formatCell(
  result: TypedFieldValueResult | undefined,
  nameCache: Map<RecordId, string>
): string {
  if (!result || result.value == null) return ''

  if (result.fieldType === FieldType.RELATIONSHIP) {
    return extractRelationRecordIds(result)
      .map((id) => nameCache.get(id) ?? id)
      .join(', ')
  }

  const display = formatToDisplayValue(result.value, result.fieldType, result.fieldOptions)
  return Array.isArray(display) ? display.map(toRawString).join(', ') : toRawString(display)
}
