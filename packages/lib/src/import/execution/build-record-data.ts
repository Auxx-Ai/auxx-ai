// packages/lib/src/import/execution/build-record-data.ts

import { resolutionKey } from '../hashing/resolution-key'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'

/**
 * Raw source row keyed either by CSV column index (`Record<number, string>`)
 * or by source-field key (`Record<string, unknown>`, used by data connectors).
 * Accepting both lets one coercion path serve CSV and connector sources.
 */
export type SourceRow = Record<number, string> | Record<string, unknown>

/**
 * Read the source value for a mapping, honoring `sourceFieldKey` when present
 * (connector sources) and falling back to `sourceColumnIndex` (CSV). Coerced to
 * a string so the downstream hash/resolution path is unchanged for CSV.
 */
export function getSourceValue(row: SourceRow, mapping: ImportMappingProperty): string {
  const raw =
    mapping.sourceFieldKey !== undefined
      ? (row as Record<string, unknown>)[mapping.sourceFieldKey]
      : (row as Record<number, unknown>)[mapping.sourceColumnIndex]
  if (raw === null || raw === undefined) return ''
  // Array-shaped source values (connector arrays, re-imported multi-value
  // exports) join with ', ' — the same separator the CSV export uses — so a
  // split resolution round-trips them instead of `String(raw)` mangling them.
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ')
  return typeof raw === 'string' ? raw : String(raw)
}

/**
 * Build record data from raw row values using mappings and resolutions.
 *
 * @param rowData - Source row keyed by column index (CSV) or source-field key (connectors)
 * @param mappings - Column mappings
 * @param resolutions - Map of {@link resolutionKey} → resolution
 * @returns Object with standard fields and custom fields separated
 */
export function buildRecordData(
  rowData: SourceRow,
  mappings: ImportMappingProperty[],
  resolutions: Map<string, ValueResolution>
): {
  standardFields: Record<string, unknown>
  customFields: Record<string, unknown>
  /** Values dropped from the payload that the row should report (failed image downloads) */
  warnings: string[]
} {
  const standardFields: Record<string, unknown> = {}
  const customFields: Record<string, unknown> = {}
  const warnings: string[] = []

  for (const mapping of mappings) {
    // Skip unmapped columns
    if (!mapping.targetFieldKey || mapping.targetType === 'skip') {
      continue
    }

    const rawValue = getSourceValue(rowData, mapping)
    const resolution = resolutions.get(resolutionKey(mapping.id, rawValue))
    let value: unknown = rawValue

    if (mapping.resolutionType?.startsWith('file:')) {
      const file = readFileValue(rawValue, resolution)
      if (file.omit) {
        if (file.warning) {
          const column = mapping.sourceColumnName ?? `Column ${mapping.sourceColumnIndex}`
          warnings.push(`Column "${column}": Image not imported: ${file.warning}`)
        }
        continue
      }
      value = file.value
    } else if (resolution && resolution.resolvedValues.length > 0) {
      const resolvedValue = resolution.resolvedValues[0]!
      if (resolvedValue.type === 'value' || resolvedValue.type === 'warning') {
        // 'warning' carries the valid subset of a split cell — use it; the
        // dropped elements were already recorded as a row warning at planning.
        value = resolvedValue.value
      } else if (resolvedValue.type === 'create') {
        // For 'create' type, use the value as-is (will be created)
        value = resolvedValue.value
      }
      // For 'error' type, value remains as raw string (will be skipped or handled)
    }

    // Assign to appropriate object
    if (mapping.customFieldId) {
      customFields[mapping.customFieldId] = value
    } else {
      standardFields[mapping.targetFieldKey] = value
    }
  }

  return { standardFields, customFields, warnings }
}

/**
 * The FILE payload for a `file:url` cell. Anything but a downloaded `{ ref }` is omitted: the
 * raw URL would reach the FILE normalizer as `null` and clear the stored image on update.
 */
function readFileValue(
  rawValue: string,
  resolution: ValueResolution | undefined
): { omit: false; value: unknown } | { omit: true; warning?: string } {
  const first = resolution?.resolvedValues[0]
  if (!resolution) {
    return rawValue.trim()
      ? { omit: true, warning: 'the URL was not resolved' }
      : { omit: false, value: null }
  }
  // A skip override empties the list: nothing to import, nothing to report.
  if (!first) return { omit: true }
  if (first.type === 'error') {
    return { omit: true, warning: first.error ?? resolution.errorMessage ?? 'download failed' }
  }
  // An unusable URL: omit rather than write null (`overwrite` would clear); planning already warned.
  if (first.type === 'warning' && first.value == null) return { omit: true }
  const stored = first.value as { ref?: unknown } | null | undefined
  if (stored === null || stored === undefined) return { omit: false, value: null }
  // One-element array: a bare object lands on the scalar path and cannot be read back.
  if (typeof stored === 'object' && typeof stored.ref === 'string') {
    return { omit: false, value: [stored] }
  }
  return { omit: true, warning: 'it was not downloaded' }
}

/**
 * Build multiple records from raw data.
 *
 * @param rowsData - Map of rowIndex → { columnIndex: value }
 * @param mappings - Column mappings
 * @param resolutions - Map of {@link resolutionKey} → resolution
 * @returns Array of { rowIndex, standardFields, customFields }
 */
export function buildMultipleRecordData(
  rowsData: Map<number, SourceRow>,
  mappings: ImportMappingProperty[],
  resolutions: Map<string, ValueResolution>
): Array<{
  rowIndex: number
  standardFields: Record<string, unknown>
  customFields: Record<string, unknown>
}> {
  const results: Array<{
    rowIndex: number
    standardFields: Record<string, unknown>
    customFields: Record<string, unknown>
  }> = []

  for (const [rowIndex, rowData] of rowsData) {
    const { standardFields, customFields } = buildRecordData(rowData, mappings, resolutions)
    results.push({ rowIndex, standardFields, customFields })
  }

  return results
}
