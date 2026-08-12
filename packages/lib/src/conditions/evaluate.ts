// packages/lib/src/conditions/evaluate.ts

import { evaluateOperator, isKnownOperator } from './evaluate-operator'
import type { Operator } from './operator-definitions'
import type { ConditionContext } from './resolve-context'
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
 * Why a condition could not be evaluated as written.
 *
 * - `unknown-operator` — the operator is not a key of `OPERATOR_DEFINITIONS`, so it
 *   evaluates `false` and can never match.
 * - `unresolved-value-source` — a `valueSource` placeholder (e.g. `currentUser`) had
 *   no value in the evaluation context, so the condition was dropped from its group.
 */
export interface ConditionDiagnostic {
  conditionId: string
  fieldId: string
  operator: string
  reason: 'unknown-operator' | 'unresolved-value-source'
}

/** Result of a diagnostics-carrying evaluation. */
export interface ConditionEvaluation {
  matched: boolean
  diagnostics: ConditionDiagnostic[]
}

/**
 * Evaluate if an entity matches all condition groups.
 * Groups are AND'd together at the top level.
 *
 * Operator semantics live in `conditions/evaluate-operator.ts` — one implementation
 * shared with the workflow if-else node and the list-filter node.
 *
 * 🔴 An unrecognised operator evaluates FALSE (it used to evaluate `true`, i.e. a
 * typo'd or retired operator matched every record). Anything that MUTATES on a match
 * must call {@link evaluateConditionsWithDiagnostics} instead and refuse to act when
 * `diagnostics` is non-empty — otherwise fail-closed just moves the silent failure.
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
  resolver: FieldResolver<T>,
  context?: ConditionContext
): boolean {
  return evaluateConditionsWithDiagnostics(entity, groups, resolver, context).matched
}

/**
 * `evaluateConditions` plus the list of conditions that could not be evaluated as
 * written.
 *
 * Read paths (rendering a filtered list) can ignore diagnostics. Write paths must
 * not: a condition set that does not fully compile no longer expresses what its
 * author wrote, and acting on the remainder is how "filter matched everything and we
 * mutated the whole mailbox" happens (mail-filters invariant 19).
 */
export function evaluateConditionsWithDiagnostics<T>(
  entity: T,
  groups: ConditionGroup[],
  resolver: FieldResolver<T>,
  context?: ConditionContext
): ConditionEvaluation {
  const diagnostics: ConditionDiagnostic[] = []

  // Empty groups = match all
  if (groups.length === 0) return { matched: true, diagnostics }

  // Groups are AND'd at top level. `every` short-circuits, so evaluate first and
  // reduce after — a diagnostic from a later group is worth reporting even when an
  // earlier one already decided the answer.
  const groupResults = groups.map((group) =>
    evaluateGroup(entity, group, resolver, context, diagnostics)
  )

  return { matched: groupResults.every(Boolean), diagnostics }
}

/**
 * Evaluate a single condition group.
 */
function evaluateGroup<T>(
  entity: T,
  group: ConditionGroup,
  resolver: FieldResolver<T>,
  context: ConditionContext | undefined,
  diagnostics: ConditionDiagnostic[]
): boolean {
  const { conditions, logicalOperator } = group

  if (conditions.length === 0) return true

  const results = conditions
    .map((c) => evaluateCondition(entity, c, resolver, context, diagnostics))
    .filter((r): r is boolean => r !== undefined)

  if (results.length === 0) return true

  return logicalOperator === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

/**
 * Evaluate a single condition against an entity.
 * Returns undefined when the condition is dropped (e.g. `currentUser` without a userId).
 */
function evaluateCondition<T>(
  entity: T,
  condition: Condition,
  resolver: FieldResolver<T>,
  context: ConditionContext | undefined,
  diagnostics: ConditionDiagnostic[]
): boolean | undefined {
  const { fieldId, operator, value, valueSource } = condition

  // Resolve valueSource placeholders (currently just `currentUser`).
  let effectiveValue: unknown = value
  if (valueSource === 'currentUser') {
    if (!context?.currentUserId) {
      diagnostics.push(describe(condition, 'unresolved-value-source'))
      return undefined
    }
    effectiveValue = context.currentUserId
  }

  // Extract simple field ID from ResourceFieldId format if needed
  const simpleFieldId = extractFieldId(fieldId)
  const fieldValue = resolver(entity, simpleFieldId)

  // Field can't be evaluated client-side — trust the server's filtering
  if (fieldValue === FIELD_NOT_RESOLVABLE) return true

  if (!isKnownOperator(operator as string)) {
    diagnostics.push(describe(condition, 'unknown-operator'))
    return false
  }

  return evaluateOperator(fieldValue, operator as Operator, effectiveValue)
}

/** Build a diagnostic entry for a condition that could not be evaluated as written. */
function describe(
  condition: Condition,
  reason: ConditionDiagnostic['reason']
): ConditionDiagnostic {
  return {
    conditionId: condition.id,
    fieldId: Array.isArray(condition.fieldId) ? condition.fieldId.join('::') : condition.fieldId,
    operator: String(condition.operator),
    reason,
  }
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
  ignored: { status: 'IGNORED' },
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
