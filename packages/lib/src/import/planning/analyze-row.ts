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
 * Identifier semantics for a multi-value cell (split resolutions): every
 * element is matched independently (match-ANY). Exactly one distinct record →
 * `update`; elements matching two DIFFERENT records → row error (ambiguous —
 * do not guess); no match → `create` with the full array.
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
  const warnings: string[] = []
  const resolvedData: Record<string, unknown> = {}

  let identifierRawValue: string | undefined

  // Process each mapped column
  for (const mapping of ctx.mappings) {
    // Skip unmapped columns
    if (!mapping.targetFieldKey || mapping.targetType === 'skip') {
      continue
    }

    const rawValue = rowData[mapping.sourceColumnIndex] ?? ''
    const hash = hashValue(rawValue)
    const columnLabel = mapping.sourceColumnName ?? `Column ${mapping.sourceColumnIndex}`

    // Check if this is the identifier field
    if (mapping.targetFieldKey === ctx.identifierFieldKey) {
      identifierRawValue = rawValue.trim()
    }

    // Look up resolution for this value
    const resolution = ctx.resolutions.get(hash)

    if (resolution) {
      // Use the resolved value if available
      if (resolution.isValid && resolution.resolvedValues.length > 0) {
        const resolved = resolution.resolvedValues[0]
        resolvedData[mapping.targetFieldKey] = resolved?.value ?? rawValue
        // Split resolutions surface dropped elements as a non-fatal warning —
        // the valid subset still imports.
        if (resolved?.type === 'warning' && resolved.warning) {
          warnings.push(`Column "${columnLabel}": ${resolved.warning}`)
        }
      } else if (!resolution.isValid) {
        // Check if this is a user-initiated skip (no error message, empty resolved values)
        // vs an actual validation error (has error message)
        const isUserSkip = !resolution.errorMessage && resolution.resolvedValues.length === 0

        if (isUserSkip) {
          // User deliberately skipped this value - omit from row data, not an error
          // Don't add to resolvedData, don't add to errors
        } else {
          // Actual validation error - track it
          errors.push(`Column "${columnLabel}": ${resolution.errorMessage ?? 'Resolution failed'}`)
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

  // Identifier values to match: a split resolution yields an array — match
  // ANY element; a scalar identifier keeps the raw trimmed cell.
  const identifierResolved = ctx.identifierFieldKey
    ? resolvedData[ctx.identifierFieldKey]
    : undefined
  const identifierValues = Array.isArray(identifierResolved)
    ? identifierResolved.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : identifierRawValue
      ? [identifierRawValue]
      : []

  if (identifierValues.length > 0 && ctx.findExistingRecord) {
    try {
      const matchedIds = new Set<string>()
      for (const value of identifierValues) {
        const matched = await ctx.findExistingRecord(value)
        if (matched) matchedIds.add(matched)
        if (matchedIds.size > 1) break
      }

      if (matchedIds.size > 1) {
        errors.push(
          'Identifier values match multiple different records — cannot determine which record to update'
        )
      } else if (matchedIds.size === 1) {
        existingRecordId = [...matchedIds][0]
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
    warnings,
  }
}
