// packages/lib/src/import/planning/analyze-row.ts

import { createScopedLogger } from '@auxx/logger'
import { hashValue } from '../hashing/hash-value'
import type { ImportMappingProperty, ImportStrategyMode } from '../types/mapping'
import type { RowAnalysis, StrategyType } from '../types/plan'
import type { ValueResolution } from '../types/resolution'
import type { FindExistingRecord } from './find-existing-record'

const logger = createScopedLogger('analyze-row')

/** Context for analyzing a row */
export interface AnalyzeRowContext {
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  /**
   * Ordered identifier field keys. Empty/absent ⇒ create-only, whatever the
   * mode says. More than one key is a COMPOSITE key: every component must
   * carry a value or the row cannot match at all.
   */
  identifierFieldKeys?: string[]
  /** What to do with matched / unmatched rows. Defaults to `create-or-update`. */
  mode?: ImportStrategyMode
  /** Resolve a row's identifier tuple to an existing record */
  findExistingRecord?: FindExistingRecord
  /**
   * In-file duplicate guard: identifier tuple → the FIRST row index that
   * carried it. **Mutated by `analyzeRow`**, so one Map must be shared across
   * every row of one plan.
   *
   * This is currently the only protection against two rows of one file
   * claiming the same identifier: `execute-batch`'s degrade-to-update recovery
   * is gated on `ctx.identifierKeys` and has never engaged. Without it the
   * later row updates whatever the earlier row just created, or (once the
   * unique constraint lands) has its identifier STRIPPED and imports anyway.
   */
  seenIdentifiers?: Map<string, number>
}

/** Values of one identifier field on one row (a split cell yields several). */
type IdentifierValueSets = Map<string, string[]>

/**
 * Analyze a single row to determine its strategy and resolved data.
 *
 * Mode semantics:
 * - `create`, the identifier is never consulted; every row is `create`.
 * - `update`, matched ⇒ `update`; unmatched ⇒ `unmatched` (NOT an error).
 * - `create-or-update`, matched ⇒ `update`; unmatched ⇒ `create`.
 *
 * Row errors always win and produce `skip`, which is the one strategy that
 * always exists, so no analyzed row can ever be left without a bucket.
 *
 * Identifier semantics for a multi-value cell (split resolutions) on a SINGLE
 * identifier field: every element is matched independently (match-ANY). Exactly
 * one distinct record → `update`; elements matching two DIFFERENT records → row
 * error (ambiguous, do not guess); no match → per the mode.
 *
 * For a COMPOSITE key a split component uses its first element only, a
 * cartesian match-ANY across components has no defensible meaning.
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

  const mode: ImportStrategyMode = ctx.mode ?? 'create-or-update'
  const identifierKeys = ctx.identifierFieldKeys ?? []
  const identifierRawByKey = new Map<string, string>()

  // Process each mapped column
  for (const mapping of ctx.mappings) {
    // Skip unmapped columns
    if (!mapping.targetFieldKey || mapping.targetType === 'skip') {
      continue
    }

    const rawValue = rowData[mapping.sourceColumnIndex] ?? ''
    const hash = hashValue(rawValue)
    const columnLabel = mapping.sourceColumnName ?? `Column ${mapping.sourceColumnIndex}`

    // Check if this column carries (part of) the identifier
    if (identifierKeys.includes(mapping.targetFieldKey)) {
      identifierRawByKey.set(mapping.targetFieldKey, rawValue.trim())
    }

    // Look up resolution for this value
    const resolution = ctx.resolutions.get(hash)

    if (resolution) {
      // Use the resolved value if available
      if (resolution.isValid && resolution.resolvedValues.length > 0) {
        const resolved = resolution.resolvedValues[0]
        // `?? rawValue` would put the raw cell BACK for a deliberate null, a
        // relation resolved under `onNoMatch: 'blank'` carries `value: null`,
        // and the preview would then show the unmatched supplier name as if it
        // had linked. Execution reads `value` directly and was never affected,
        // so this was a preview-only lie, which is the worst kind here.
        resolvedData[mapping.targetFieldKey] =
          resolved && 'value' in resolved ? resolved.value : rawValue
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

  // Determine strategy.
  //
  // `update` mode must NEVER create, so its floor is `unmatched`, not
  // `create`. A job whose identifier keys are empty (a stale key whose column
  // was unmapped) would otherwise create a full duplicate set behind a wizard
  // that says "update existing".
  let strategy: StrategyType = mode === 'update' ? 'unmatched' : 'create'
  let existingRecordId: string | undefined

  // `create` mode never consults the identifier, not the lookup, not the
  // in-file duplicate guard. Duplicate rows are what the user asked for.
  const consultIdentifier = mode !== 'create' && identifierKeys.length > 0

  if (consultIdentifier) {
    const valueSets = collectIdentifierValues(identifierKeys, identifierRawByKey, resolvedData)
    const complete = identifierKeys.every((key) => (valueSets.get(key)?.length ?? 0) > 0)

    // In-file duplicates are a row error on the LATER row, regardless of
    // whether the field is enforced-unique, this is the only place that check
    // happens at all.
    if (complete && ctx.seenIdentifiers) {
      const tupleKey = buildTupleKey(identifierKeys, valueSets)
      const previous = ctx.seenIdentifiers.get(tupleKey)
      if (previous === undefined) {
        ctx.seenIdentifiers.set(tupleKey, rowIndex)
      } else {
        errors.push(
          `Duplicate identifier ${describeTuple(identifierKeys, valueSets)}: row ${rowIndex + 1} repeats row ${previous + 1}, only row ${previous + 1} can be matched`
        )
      }
    }

    // A missing component can never partially match, `strategy` already holds
    // the mode's floor (`unmatched` for update-only, `create` otherwise).
    if (complete && ctx.findExistingRecord) {
      const findExistingRecord = ctx.findExistingRecord
      try {
        const matchedIds = new Set<string>()
        let ambiguousCount = 0

        if (identifierKeys.length === 1) {
          // Single identifier: match-ANY across a split cell's elements.
          const key = identifierKeys[0]!
          for (const value of valueSets.get(key) ?? []) {
            const result = await findExistingRecord({ [key]: value })
            if (result.kind === 'ambiguous') {
              ambiguousCount = Math.max(ambiguousCount, result.count)
              break
            }
            if (result.kind === 'one') matchedIds.add(result.recordId)
            if (matchedIds.size > 1) break
          }
        } else {
          // Composite key: one tuple, one lookup.
          const values: Record<string, string> = {}
          for (const key of identifierKeys) values[key] = valueSets.get(key)![0]!
          const result = await findExistingRecord(values)
          if (result.kind === 'ambiguous') ambiguousCount = result.count
          else if (result.kind === 'one') matchedIds.add(result.recordId)
        }

        if (ambiguousCount > 0) {
          errors.push(
            `Ambiguous match for ${describeTuple(identifierKeys, valueSets)}: ${ambiguousCount} records share this value, cannot determine which record to update`
          )
        } else if (matchedIds.size > 1) {
          errors.push(
            'Identifier values match multiple different records, cannot determine which record to update'
          )
        } else if (matchedIds.size === 1) {
          existingRecordId = [...matchedIds][0]
          strategy = 'update'
        } else {
          strategy = mode === 'update' ? 'unmatched' : 'create'
        }
      } catch (error) {
        // NOT a silent fall-through to `create`. A transient DB error during
        // identifier resolution used to be swallowed here ("If lookup fails,
        // default to create"), which produces a DUPLICATE record with no error,
        // no warning and no log line, the plan looks normal and the data is
        // wrong. Make it a row error, so the row lands in `skip`.
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn('Identifier lookup failed, row errored rather than duplicated', {
          rowIndex,
          identifier: describeTuple(identifierKeys, valueSets),
          reason,
        })
        errors.push(`Identifier lookup failed: ${reason}`)
      }
    }
  }

  // If there are errors, skip the row
  if (errors.length > 0) {
    strategy = 'skip'
    existingRecordId = undefined
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

/**
 * Identifier values to match, per identifier field: a split resolution yields
 * an array (match-ANY); a scalar identifier keeps the raw trimmed cell.
 */
function collectIdentifierValues(
  identifierKeys: string[],
  rawByKey: Map<string, string>,
  resolvedData: Record<string, unknown>
): IdentifierValueSets {
  const sets: IdentifierValueSets = new Map()
  for (const key of identifierKeys) {
    const resolved = resolvedData[key]
    if (Array.isArray(resolved)) {
      sets.set(
        key,
        resolved.filter((v): v is string => typeof v === 'string' && v.length > 0)
      )
    } else {
      const raw = rawByKey.get(key)
      sets.set(key, raw ? [raw] : [])
    }
  }
  return sets
}

/**
 * Stable key for the in-file duplicate guard. Lower-cased because identifier
 * matching is case-insensitive for TEXT, `M400L` and `m400l` in one file are
 * the same row twice, and the guard has to say so.
 */
function buildTupleKey(identifierKeys: string[], sets: IdentifierValueSets): string {
  return identifierKeys
    .map((key) => `${key}=${(sets.get(key) ?? []).map((v) => v.toLowerCase()).join('|')}`)
    .join('&')
}

/** Human-readable identifier tuple for a row error. */
function describeTuple(identifierKeys: string[], sets: IdentifierValueSets): string {
  if (identifierKeys.length === 1) {
    return `"${(sets.get(identifierKeys[0]!) ?? []).join(', ')}"`
  }
  return identifierKeys.map((key) => `${key}="${(sets.get(key) ?? []).join(', ')}"`).join(' + ')
}
