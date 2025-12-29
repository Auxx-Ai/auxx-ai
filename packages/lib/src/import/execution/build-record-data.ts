// packages/lib/src/import/execution/build-record-data.ts

import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'
import { hashValue } from '../hashing/hash-value'

/**
 * Build record data from raw row values using mappings and resolutions.
 *
 * @param rowData - Map of columnIndex → rawValue
 * @param mappings - Column mappings
 * @param resolutions - Map of hash → resolution
 * @returns Object with standard fields and custom fields separated
 */
export function buildRecordData(
  rowData: Record<number, string>,
  mappings: ImportMappingProperty[],
  resolutions: Map<string, ValueResolution>
): { standardFields: Record<string, unknown>; customFields: Record<string, unknown> } {
  const standardFields: Record<string, unknown> = {}
  const customFields: Record<string, unknown> = {}

  for (const mapping of mappings) {
    // Skip unmapped columns
    if (!mapping.targetFieldKey || mapping.targetType === 'skip') {
      continue
    }

    const rawValue = rowData[mapping.sourceColumnIndex] ?? ''
    const hash = hashValue(rawValue)

    // Get resolved value
    const resolution = resolutions.get(hash)
    let value: unknown = rawValue

    if (resolution && resolution.resolvedValues.length > 0) {
      const resolvedValue = resolution.resolvedValues[0]!
      if (resolvedValue.type === 'value') {
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

  return { standardFields, customFields }
}

/**
 * Build multiple records from raw data.
 *
 * @param rowsData - Map of rowIndex → { columnIndex: value }
 * @param mappings - Column mappings
 * @param resolutions - Map of hash → resolution
 * @returns Array of { rowIndex, standardFields, customFields }
 */
export function buildMultipleRecordData(
  rowsData: Map<number, Record<number, string>>,
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
