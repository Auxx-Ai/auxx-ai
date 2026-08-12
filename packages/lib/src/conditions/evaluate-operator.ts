// packages/lib/src/conditions/evaluate-operator.ts

// Both imports below are leaf modules (no imports of their own beyond `@auxx/utils`),
// so reaching into `workflow-engine/` from here adds no cycle — the same direction
// `operator-definitions.ts` already takes for `BaseType`.
import {
  isOlderThanDays,
  isSameDay,
  isThisMonth,
  isThisWeek,
  isWithinDays,
  parseDate,
} from '../workflow-engine/nodes/utils/date-helpers'
import {
  analyzeFileName,
  isExtensionInCategory,
  isFileValid,
  isUploadedToday,
  isUploadedWithinDays,
  isWithinSizeLimit,
  type WorkflowFileData,
} from '../workflow-engine/types/file-variable'
import { getOperatorDefinition, type Operator } from './operator-definitions'

/**
 * THE operator evaluator.
 *
 * `OPERATOR_DEFINITIONS` is the single source of truth for what the condition editor
 * OFFERS; this module is the single source of truth for what those operators MEAN.
 * Every in-memory condition surface routes through it:
 *
 * - `conditions/evaluate.ts` — mail views/filters, record rules, procedures, sequences
 * - `workflow-engine/nodes/condition-nodes/if-else.ts` — workflow branching
 * - `workflow-engine/nodes/transform-nodes/list-processor.ts` — list filter operation
 *
 * They used to carry three divergent copies: `is` was case-sensitive in one and
 * case-insensitive in another, `key equals` was missing from a third, and an
 * unrecognised operator matched EVERYTHING in one and NOTHING in the others.
 *
 * Semantics, decided once:
 * - String comparison is CASE-INSENSITIVE everywhere (`is`, `contains`, `starts with`, …).
 * - Relationship/actor values reduce to their identity before comparing, so a
 *   RecordId (`"contact:inst-1"`) matches the bare instance id the builder stores.
 * - An array value (has_many, multi-select) fans out: ANY element may satisfy a
 *   positive operator, EVERY element must satisfy a negated one.
 * - An unrecognised operator is FALSE, never true. Callers that mutate on a match
 *   must additionally report it — see `evaluateConditionsWithDiagnostics`.
 */

/** Operators that assert the ABSENCE of a match — see the array fan-out below. */
const NEGATED_OPERATORS = new Set<string>(['is not', 'not contains', 'not in', 'not_on_date'])

/** Is this string a key the operator registry defines? */
export function isKnownOperator(operator: string): operator is Operator {
  return getOperatorDefinition(operator as Operator) !== undefined
}

/**
 * Evaluate one operator against a resolved field value.
 *
 * @param value - the item/entity's value for the condition's field
 * @param operator - a key of `OPERATOR_DEFINITIONS`
 * @param compareValue - the condition's comparison value (already resolved)
 * @returns whether the value satisfies the operator; `false` for unknown operators
 */
export function evaluateOperator(
  value: unknown,
  operator: string,
  compareValue?: unknown
): boolean {
  const definition = getOperatorDefinition(operator as Operator)
  if (!definition) return false

  // has_many relationships and multi-select fields resolve to arrays. The three
  // categories below describe the value AS A WHOLE (an empty array IS empty; `length >`
  // is about the array itself); every other operator is asked of the elements.
  if (
    Array.isArray(value) &&
    definition.category !== 'existence' &&
    definition.category !== 'array' &&
    definition.category !== 'object'
  ) {
    return NEGATED_OPERATORS.has(operator)
      ? value.every((element) => evaluateOperator(element, operator, compareValue))
      : value.some((element) => evaluateOperator(element, operator, compareValue))
  }

  switch (definition.category) {
    case 'equality':
      return evaluateEqualityOperator(value, operator, compareValue)
    case 'comparison':
      return evaluateComparisonOperator(value, operator, compareValue)
    case 'string':
      return evaluateStringOperator(value, operator, compareValue)
    case 'set':
      return evaluateSetOperator(value, operator, compareValue)
    case 'existence':
      return evaluateExistenceOperator(value, operator)
    case 'date':
      return evaluateDateOperator(value, operator, compareValue)
    case 'array':
      return evaluateArrayOperator(value, operator, compareValue)
    case 'object':
      return evaluateObjectOperator(value, operator, compareValue)
    case 'file':
      return evaluateFileOperator(value, operator, compareValue)
    default:
      return false
  }
}

/**
 * EQUALITY: is, is not.
 *
 * The scope operators (`this_mailbox`, `everywhere`) share this category but describe
 * a mail-search scope rather than a value, so nothing can make them true.
 */
function evaluateEqualityOperator(
  value: unknown,
  operator: string,
  compareValue: unknown
): boolean {
  switch (operator) {
    case 'is':
      return looseEquals(value, compareValue)
    case 'is not':
      return !looseEquals(value, compareValue)
    default:
      return false
  }
}

/** COMPARISON: >, <, >=, <= (numeric only) */
function evaluateComparisonOperator(
  value: unknown,
  operator: string,
  compareValue: unknown
): boolean {
  const left = Number(value)
  const right = Number(compareValue)

  switch (operator) {
    case '>':
      return left > right
    case '<':
      return left < right
    case '>=':
      return left >= right
    case '<=':
      return left <= right
    default:
      return false
  }
}

/** STRING: contains, not contains, starts with, ends with */
function evaluateStringOperator(value: unknown, operator: string, compareValue: unknown): boolean {
  const left = toComparableString(value)
  const right = toComparableString(compareValue)

  switch (operator) {
    case 'contains':
      return left.includes(right)
    case 'not contains':
      return !left.includes(right)
    case 'starts with':
      return left.startsWith(right)
    case 'ends with':
      return left.endsWith(right)
    default:
      return false
  }
}

/** SET: in, not in */
function evaluateSetOperator(value: unknown, operator: string, compareValue: unknown): boolean {
  const candidates = Array.isArray(compareValue) ? compareValue : [compareValue]
  const isMember = candidates.some((candidate) => looseEquals(value, candidate))

  switch (operator) {
    case 'in':
      return isMember
    case 'not in':
      return !isMember
    default:
      return false
  }
}

/** EXISTENCE: empty, not empty */
function evaluateExistenceOperator(value: unknown, operator: string): boolean {
  switch (operator) {
    case 'empty':
      return isEmptyValue(value)
    case 'not empty':
      return !isEmptyValue(value)
    default:
      return false
  }
}

/**
 * DATE: before, after, on_date, not_on_date, within_days, older_than_days,
 * today, yesterday, this_week, this_month
 */
function evaluateDateOperator(value: unknown, operator: string, compareValue: unknown): boolean {
  const date = parseDate(value)
  if (!date) return false

  switch (operator) {
    case 'before': {
      const target = parseDate(compareValue)
      return target ? date.getTime() < target.getTime() : false
    }
    case 'after': {
      const target = parseDate(compareValue)
      return target ? date.getTime() > target.getTime() : false
    }
    case 'on_date': {
      const target = parseDate(compareValue)
      return target ? isSameDay(date, target) : false
    }
    case 'not_on_date': {
      const target = parseDate(compareValue)
      return target ? !isSameDay(date, target) : true
    }
    case 'within_days':
      return isWithinDays(date, Number(compareValue))
    case 'older_than_days':
      return isOlderThanDays(date, Number(compareValue))
    case 'today':
      return isSameDay(date, new Date())
    case 'yesterday': {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      return isSameDay(date, yesterday)
    }
    case 'this_week':
      return isThisWeek(date)
    case 'this_month':
      return isThisMonth(date)
    default:
      return false
  }
}

/** ARRAY: length =, length >, length <, length >=, length <= */
function evaluateArrayOperator(value: unknown, operator: string, compareValue: unknown): boolean {
  if (!Array.isArray(value)) return false

  const length = value.length
  const target = Number(compareValue)

  switch (operator) {
    case 'length =':
      return length === target
    case 'length >':
      return length > target
    case 'length <':
      return length < target
    case 'length >=':
      return length >= target
    case 'length <=':
      return length <= target
    default:
      return false
  }
}

/** OBJECT: has key, key equals (comparison value formatted as "key:value") */
function evaluateObjectOperator(value: unknown, operator: string, compareValue: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>

  switch (operator) {
    case 'has key':
      return String(compareValue) in record
    case 'key equals': {
      const raw = String(compareValue)
      const separator = raw.indexOf(':')
      if (separator <= 0) return false
      return looseEquals(record[raw.slice(0, separator)], raw.slice(separator + 1))
    }
    default:
      return false
  }
}

/** FILE: validation, upload date, filename pattern, extension category and size */
function evaluateFileOperator(value: unknown, operator: string, compareValue: unknown): boolean {
  if (!isFileValue(value)) return false

  switch (operator) {
    case 'is_valid':
      return isFileValid(value)
    case 'is_invalid':
      return !isFileValid(value)
    case 'uploaded_today':
      return isUploadedToday(value)
    case 'uploaded_within_days':
      return isUploadedWithinDays(value, Number(compareValue))
    case 'matches_pattern':
      return matchesFilePattern(value, compareValue)
    case 'contains_numbers':
      return analyzeFileName(value.filename).hasNumbers
    case 'contains_date':
      return analyzeFileName(value.filename).hasDate
    case 'has_version':
      return analyzeFileName(value.filename).hasVersion
    case 'is_office_document':
      return isExtensionInCategory(value.filename, 'office_document')
    case 'is_image_format':
      return isExtensionInCategory(value.filename, 'image_format')
    case 'is_text_format':
      return isExtensionInCategory(value.filename, 'text_format')
    case 'is_compressed':
      return isExtensionInCategory(value.filename, 'compressed')
    case 'is_executable':
      return isExtensionInCategory(value.filename, 'executable')
    case 'within_size_limit':
      return isWithinSizeLimit(value, Number(compareValue))
    case 'exceeds_limit':
      return !isWithinSizeLimit(value, Number(compareValue))
    default:
      return false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared value helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Case-insensitive loose equality.
 *
 * Relationship and actor values arrive as RecordIds (`"entityDef:instanceId"`) or
 * `{ type, id }` objects while the builder stores the bare id, so both sides are
 * reduced to their identity before comparing.
 */
export function looseEquals(value: unknown, compareValue: unknown): boolean {
  if (value === compareValue) return true
  if (value == null || compareValue == null) return false

  const leftId = extractComparableId(value)
  const rightId = extractComparableId(compareValue)
  if (leftId !== undefined || rightId !== undefined) {
    return String(leftId ?? value).toLowerCase() === String(rightId ?? compareValue).toLowerCase()
  }

  return String(value).toLowerCase() === String(compareValue).toLowerCase()
}

/** RecordId (`"entityDef:instanceId"`) and ActorId (`{ type, id }`) both carry an identity. */
function extractComparableId(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null) {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string') return id
    return undefined
  }
  if (typeof value === 'string' && value.includes(':')) {
    return value.slice(value.indexOf(':') + 1)
  }
  return undefined
}

/** Normalise a value for case-insensitive substring comparisons. */
function toComparableString(value: unknown): string {
  return value == null ? '' : String(value).toLowerCase()
}

/**
 * Emptiness test behind `empty` / `not empty`.
 *
 * Wider than `@auxx/utils`' `isEmpty`: a whitespace-only string and an empty object
 * (an unfilled ADDRESS_STRUCT or JSON field) both count as empty, which is what the
 * registry's own operator descriptions promise.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (value instanceof Date) return false
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/** Does this value look like a workflow file variable? */
function isFileValue(value: unknown): value is WorkflowFileData {
  return (
    value !== null &&
    typeof value === 'object' &&
    'filename' in value &&
    'mimeType' in value &&
    'size' in value &&
    'url' in value
  )
}

/** Filename regex match for `matches_pattern`. */
function matchesFilePattern(fileData: WorkflowFileData, pattern: unknown): boolean {
  try {
    return new RegExp(String(pattern), 'i').test(fileData.filename)
  } catch {
    return false
  }
}
