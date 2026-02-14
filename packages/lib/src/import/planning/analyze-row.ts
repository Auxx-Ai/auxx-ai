// packages/lib/src/import/planning/analyze-row.ts

import { hashValue } from '../hashing/hash-value'
import type { ImportMappingProperty } from '../types/mapping'
import type { RowAnalysis, StrategyType } from '../types/plan'
import type { ValueResolution } from '../types/resolution'

/** Context for analyzing a row */
export interface AnalyzeRowContext {
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  identifierFieldKey?: string
  /** Function to check if a record exists with the given identifier value */
  findExistingRecord?: (identifierValue: string) => Promise<string | null>
}

/**
 * Analyze a single row to determine its strategy and resolved data.
 *
 * @param rowIndex - Row index
 * @param rowData - Map of columnIndex → rawValue
 * @param ctx - Analysis context
 * @returns Row analysis result
 */
export async function analyzeRow(
  rowIndex: number,
  rowData: Record<number, string>,
  ctx: AnalyzeRowContext
): Promise<RowAnalysis> {
  const errors: string[] = []
  const resolvedData: Record<string, unknown> = {}

  let identifierValue: string | undefined

  // Process each mapped column
  for (const mapping of ctx.mappings) {
    // Skip unmapped columns
    if (!mapping.targetFieldKey || mapping.targetType === 'skip') {
      continue
    }

    const rawValue = rowData[mapping.sourceColumnIndex] ?? ''
    const hash = hashValue(rawValue)

    // Check if this is the identifier field
    if (mapping.targetFieldKey === ctx.identifierFieldKey) {
      identifierValue = rawValue.trim()
    }

    // Look up resolution for this value
    const resolution = ctx.resolutions.get(hash)

    if (resolution) {
      // Use the resolved value if available
      if (resolution.isValid && resolution.resolvedValues.length > 0) {
        const resolved = resolution.resolvedValues[0]
        resolvedData[mapping.targetFieldKey] = resolved?.value ?? rawValue
      } else if (!resolution.isValid) {
        // Check if this is a user-initiated skip (no error message, empty resolved values)
        // vs an actual validation error (has error message)
        const isUserSkip = !resolution.errorMessage && resolution.resolvedValues.length === 0

        if (isUserSkip) {
          // User deliberately skipped this value - omit from row data, not an error
          // Don't add to resolvedData, don't add to errors
        } else {
          // Actual validation error - track it
          errors.push(
            `Column "${mapping.sourceColumnName ?? `Column ${mapping.sourceColumnIndex}`}": ${resolution.errorMessage ?? 'Resolution failed'}`
          )
          resolvedData[mapping.targetFieldKey] = rawValue
        }
      } else {
        resolvedData[mapping.targetFieldKey] = rawValue
      }
    } else {
      // No resolution found, use raw value
      resolvedData[mapping.targetFieldKey] = rawValue
    }
  }

  // Determine strategy
  let strategy: StrategyType = 'create'
  let existingRecordId: string | undefined

  // If we have an identifier value and a lookup function, check for existing records
  if (identifierValue && ctx.findExistingRecord) {
    try {
      existingRecordId = (await ctx.findExistingRecord(identifierValue)) ?? undefined
      if (existingRecordId) {
        strategy = 'update'
      }
    } catch {
      // If lookup fails, default to create
    }
  }

  // If there are errors, skip the row
  if (errors.length > 0) {
    strategy = 'skip'
  }

  return {
    rowIndex,
    strategy,
    existingRecordId,
    resolvedData,
    errors,
  }
}
