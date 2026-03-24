// packages/lib/src/conditions/evaluate.ts

import type { Operator } from './operator-definitions'
import type { Condition, ConditionGroup } from './types'

/**
 * Sentinel value returned by a FieldResolver when a field cannot be evaluated
 * client-side (e.g. freeText search requires server-side SQL joins).
 * The evaluator treats this as "pass" — the server already filtered for it.
 */
export const FIELD_NOT_RESOLVABLE = Symbol.for('FIELD_NOT_RESOLVABLE')

/**
 * Field value resolver function.
 * Given an entity and fieldId, returns the value for that field.
 * Return `FIELD_NOT_RESOLVABLE` for fields that can't be evaluated client-side.
 */
export type FieldResolver<T> = (entity: T, fieldId: string) => unknown

/**
 * Evaluate if an entity matches all condition groups.
 * Groups are AND'd together at the top level.
 *
 * @param entity - The entity to evaluate
 * @param groups - Condition groups to evaluate against
 * @param resolver - Function to get field values from the entity
 * @returns true if entity matches all conditions
 *
 * @example
 * ```typescript
 * // Thread filtering
 * const matches = evaluateConditions(thread, conditionGroups, (t, fieldId) => {
 *   switch (fieldId) {
 *     case 'status': return t.status
 *     case 'inbox': return t.inboxId
 *     case 'assignee': return t.assigneeId
 *     default: return undefined
 *   }
 * })
 * ```
 */
export function evaluateConditions<T>(
  entity: T,
  groups: ConditionGroup[],
  resolver: FieldResolver<T>
): boolean {
  // Empty groups = match all
  if (groups.length === 0) return true

  // Groups are AND'd at top level
  return groups.every((group) => evaluateGroup(entity, group, resolver))
}

/**
 * Evaluate a single condition group.
 */
function evaluateGroup<T>(entity: T, group: ConditionGroup, resolver: FieldResolver<T>): boolean {
  const { conditions, logicalOperator } = group

  if (conditions.length === 0) return true

  const results = conditions.map((c) => evaluateCondition(entity, c, resolver))

  return logicalOperator === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

/**
 * Evaluate a single condition against an entity.
 */
function evaluateCondition<T>(
  entity: T,
  condition: Condition,
  resolver: FieldResolver<T>
): boolean {
  const { fieldId, operator, value } = condition

  // Extract simple field ID from ResourceFieldId format if needed
  const simpleFieldId = extractFieldId(fieldId)
  const fieldValue = resolver(entity, simpleFieldId)

  // Field can't be evaluated client-side — trust the server's filtering
  if (fieldValue === FIELD_NOT_RESOLVABLE) return true

  return evaluateOperator(fieldValue, operator as Operator, value)
}

/**
 * Extract simple field ID from various formats.
 * Handles: 'status', 'thread:status', ['thread:status', 'status:name']
 */
function extractFieldId(fieldId: string | string[]): string {
  // If it's an array (relationship path), use the LAST field's simple name (the target field)
  if (Array.isArray(fieldId)) {
    return extractSimpleField(fieldId[fieldId.length - 1] ?? '')
  }
  return extractSimpleField(fieldId)
}

/**
 * Extract simple field name from ResourceFieldId format (entityDef:fieldName).
 */
function extractSimpleField(fieldId: string): string {
  const colonIndex = fieldId.indexOf(':')
  return colonIndex === -1 ? fieldId : fieldId.slice(colonIndex + 1)
}

/**
 * Evaluate an operator against field value and condition value.
 * Supports all common operators from OPERATOR_DEFINITIONS.
 */
function evaluateOperator(
  fieldValue: unknown,
  operator: Operator,
  conditionValue: unknown
): boolean {
  switch (operator) {
    // ═══════════════════════════════════════════════════════════════
    // EQUALITY OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'is':
      return isEqual(fieldValue, conditionValue)

    case 'is not':
      return !isEqual(fieldValue, conditionValue)

    // ═══════════════════════════════════════════════════════════════
    // SET OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'in': {
      const values = Array.isArray(conditionValue) ? conditionValue : [conditionValue]
      // If fieldValue is array, check if ANY element is in the set
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => values.some((cv) => isEqual(v, cv)))
      }
      return values.some((v) => isEqual(fieldValue, v))
    }

    case 'not in': {
      const values = Array.isArray(conditionValue) ? conditionValue : [conditionValue]
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => values.some((cv) => isEqual(v, cv)))
      }
      return !values.some((v) => isEqual(fieldValue, v))
    }

    // ═══════════════════════════════════════════════════════════════
    // EXISTENCE OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'empty':
      return isEmpty(fieldValue)

    case 'not empty':
      return !isEmpty(fieldValue)

    // ═══════════════════════════════════════════════════════════════
    // STRING OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'contains': {
      const str = String(fieldValue ?? '').toLowerCase()
      const search = String(conditionValue ?? '').toLowerCase()
      return str.includes(search)
    }

    case 'not contains': {
      const str = String(fieldValue ?? '').toLowerCase()
      const search = String(conditionValue ?? '').toLowerCase()
      return !str.includes(search)
    }

    case 'starts with': {
      const str = String(fieldValue ?? '').toLowerCase()
      const prefix = String(conditionValue ?? '').toLowerCase()
      return str.startsWith(prefix)
    }

    case 'ends with': {
      const str = String(fieldValue ?? '').toLowerCase()
      const suffix = String(conditionValue ?? '').toLowerCase()
      return str.endsWith(suffix)
    }

    // ═══════════════════════════════════════════════════════════════
    // COMPARISON OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case '>':
      return toNumber(fieldValue) > toNumber(conditionValue)

    case '<':
      return toNumber(fieldValue) < toNumber(conditionValue)

    case '>=':
      return toNumber(fieldValue) >= toNumber(conditionValue)

    case '<=':
      return toNumber(fieldValue) <= toNumber(conditionValue)

    // ═══════════════════════════════════════════════════════════════
    // DATE OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'before': {
      const fieldDate = toDate(fieldValue)
      const compareDate = toDate(conditionValue)
      return fieldDate !== null && compareDate !== null && fieldDate < compareDate
    }

    case 'after': {
      const fieldDate = toDate(fieldValue)
      const compareDate = toDate(conditionValue)
      return fieldDate !== null && compareDate !== null && fieldDate > compareDate
    }

    case 'today': {
      const fieldDate = toDate(fieldValue)
      if (!fieldDate) return false
      const today = new Date()
      return isSameDay(fieldDate, today)
    }

    case 'yesterday': {
      const fieldDate = toDate(fieldValue)
      if (!fieldDate) return false
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      return isSameDay(fieldDate, yesterday)
    }

    case 'this_week': {
      const fieldDate = toDate(fieldValue)
      if (!fieldDate) return false
      return isThisWeek(fieldDate)
    }

    case 'this_month': {
      const fieldDate = toDate(fieldValue)
      if (!fieldDate) return false
      return isThisMonth(fieldDate)
    }

    case 'within_days': {
      const fieldDate = toDate(fieldValue)
      const days = toNumber(conditionValue)
      if (!fieldDate || Number.isNaN(days)) return false
      const now = new Date()
      const diffDays = (now.getTime() - fieldDate.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays >= 0 && diffDays <= days
    }

    case 'older_than_days': {
      const fieldDate = toDate(fieldValue)
      const days = toNumber(conditionValue)
      if (!fieldDate || Number.isNaN(days)) return false
      const now = new Date()
      const diffDays = (now.getTime() - fieldDate.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays > days
    }

    case 'on_date': {
      const fieldDate = toDate(fieldValue)
      const condDate = toDate(conditionValue)
      return fieldDate !== null && condDate !== null && isSameDay(fieldDate, condDate)
    }

    case 'not_on_date': {
      const fieldDate = toDate(fieldValue)
      const condDate = toDate(conditionValue)
      return fieldDate !== null && condDate !== null && !isSameDay(fieldDate, condDate)
    }

    // ═══════════════════════════════════════════════════════════════
    // ARRAY LENGTH OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'length =':
      return Array.isArray(fieldValue) && fieldValue.length === toNumber(conditionValue)

    case 'length >':
      return Array.isArray(fieldValue) && fieldValue.length > toNumber(conditionValue)

    case 'length <':
      return Array.isArray(fieldValue) && fieldValue.length < toNumber(conditionValue)

    case 'length >=':
      return Array.isArray(fieldValue) && fieldValue.length >= toNumber(conditionValue)

    case 'length <=':
      return Array.isArray(fieldValue) && fieldValue.length <= toNumber(conditionValue)

    // ═══════════════════════════════════════════════════════════════
    // OBJECT OPERATORS
    // ═══════════════════════════════════════════════════════════════
    case 'has key':
      return (
        typeof fieldValue === 'object' &&
        fieldValue !== null &&
        String(conditionValue) in fieldValue
      )

    // ═══════════════════════════════════════════════════════════════
    // DEFAULT: Unknown operator - don't filter (return true)
    // ═══════════════════════════════════════════════════════════════
    default:
      console.warn(`Unknown operator for client-side evaluation: ${operator}`)
      return true
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deep equality check for primitive values, arrays, and objects.
 * Handles RecordId comparison (extracts instance ID if needed).
 */
function isEqual(a: unknown, b: unknown): boolean {
  // Handle null/undefined
  if (a === b) return true
  if (a == null || b == null) return false

  // Handle RecordId format ("entityDef:instanceId")
  const aStr = String(a)
  const bStr = String(b)

  // If either looks like a RecordId, compare instance IDs
  if (aStr.includes(':') || bStr.includes(':')) {
    const aId = aStr.includes(':') ? aStr.split(':')[1] : aStr
    const bId = bStr.includes(':') ? bStr.split(':')[1] : bStr
    if (aId === bId) return true
  }

  // Handle ActorId objects ({ type, id })
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    if ('type' in aObj && 'id' in aObj && 'type' in bObj && 'id' in bObj) {
      return aObj.type === bObj.type && aObj.id === bObj.id
    }
  }

  // String comparison (case-insensitive for flexibility)
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase()
  }

  return aStr === bStr
}

/**
 * Check if value is empty (null, undefined, empty string, empty array).
 */
function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

/**
 * Convert value to number.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value) || 0
  return 0
}

/**
 * Convert value to Date.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

/**
 * Check if two dates are the same day.
 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Check if date is in the current week.
 */
function isThisWeek(date: Date): boolean {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  return date >= startOfWeek && date < endOfWeek
}

/**
 * Check if date is in the current month.
 */
function isThisMonth(date: Date): boolean {
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/** Virtual status value → DB status + optional assignee condition */
const VIRTUAL_STATUS_MAP: Record<string, { status: string; assignee?: 'empty' | 'not empty' }> = {
  assigned: { status: 'OPEN', assignee: 'not empty' },
  unassigned: { status: 'OPEN', assignee: 'empty' },
  done: { status: 'ARCHIVED' },
  archived: { status: 'ARCHIVED' },
  trash: { status: 'TRASH' },
  trashed: { status: 'TRASH' },
  spam: { status: 'SPAM' },
}

/**
 * Normalize condition groups to expand virtual status values (assigned, unassigned, done, etc.)
 * into DB-level status + assignee conditions. This bridges the gap between
 * searchbar/view conditions (virtual values) and the client-side evaluator (DB values).
 */
export function normalizeStatusConditions(groups: ConditionGroup[]): ConditionGroup[] {
  return groups.map((group) => {
    const expandedConditions: Condition[] = []

    for (const condition of group.conditions) {
      if (condition.fieldId !== 'status') {
        expandedConditions.push(condition)
        continue
      }

      // Unwrap single-element arrays
      const rawValue =
        Array.isArray(condition.value) && condition.value.length === 1
          ? condition.value[0]
          : condition.value

      // For array operators (in, not in) with DB values, no normalization needed
      if (Array.isArray(rawValue)) {
        expandedConditions.push(condition)
        continue
      }

      const mapping =
        typeof rawValue === 'string' ? VIRTUAL_STATUS_MAP[rawValue.toLowerCase()] : undefined

      if (!mapping) {
        // Already a DB value (OPEN, ARCHIVED, etc.) — pass through
        expandedConditions.push(condition)
        continue
      }

      // Expand: status → DB status condition
      expandedConditions.push({
        ...condition,
        value: mapping.status,
      })

      // Expand: add assignee condition if needed
      if (mapping.assignee) {
        expandedConditions.push({
          id: `${condition.id}_assignee`,
          fieldId: 'assignee',
          operator: mapping.assignee as Operator,
          value: undefined,
        })
      }
    }

    return { ...group, conditions: expandedConditions }
  })
}
