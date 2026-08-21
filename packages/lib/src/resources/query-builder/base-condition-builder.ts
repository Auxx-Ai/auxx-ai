// packages/lib/src/resources/query-builder/base-condition-builder.ts

import { createScopedLogger } from '@auxx/logger'
import type { ResourceFieldId } from '@auxx/types/field'
import { parseResourceFieldId } from '@auxx/types/field'
import { and, or, type SQL } from 'drizzle-orm'

// Import from shared conditions module
import type {
  Condition,
  ConditionGroup,
  ConditionValidationResult,
  Operator,
} from '../../conditions'
import { operatorRequiresValue } from '../../conditions'
import { buildOptionIndex, type FieldOptionItem, labelToValue } from '../registry/option-helpers'
import { BaseType } from '../types'

const logger = createScopedLogger('base-condition-builder')

/**
 * Backward-compat alias for Condition
 * @deprecated Use Condition
 */
export type GenericCondition = Condition

/**
 * Re-export ConditionGroup for backward compatibility
 */
export type { ConditionGroup }

/**
 * Backward-compat alias for ConditionValidationResult
 * @deprecated Use ConditionValidationResult
 */
export type ValidationResult = ConditionValidationResult

export type DroppedConditionReason =
  /** The builder had no way to turn this field/operator/value combination into SQL. */
  | 'unresolved-field-or-operator'
  /** `valueSource` was not substituted upstream by `resolveConditionContext`. */
  | 'unresolved-value-source'

/** A single condition the builder could not turn into SQL. */
export interface DroppedCondition {
  conditionId: string
  /** The condition's `fieldId` — an array for relationship paths. */
  fieldRef: string | string[]
  operator: string
  reason: DroppedConditionReason
  /** Which builder gave up, or which `valueSource` was left unresolved. */
  detail?: string
}

/**
 * Outcome of a condition build: the WHERE fragment plus enough information to
 * tell "the caller asked for no filter" apart from "every filter the caller
 * asked for was silently dropped".
 *
 * Both cases produce `sql: undefined` — an unfiltered query. That is correct
 * for the records list, saved views, dashboard widgets and the workflow Find
 * node (a stored view naming a retired field still renders), and *wrong* for an
 * AI tool, which must refuse rather than answer a different question. The
 * discriminant is {@link allConditionsDropped}; the builder itself never throws.
 */
export interface ConditionQueryResult {
  /** The WHERE fragment, or `undefined` when nothing survived. */
  sql: SQL<unknown> | undefined
  /** Total number of conditions across every input group, before building. */
  requestedConditions: number
  /** Every condition that produced no SQL, in input order. */
  droppedConditions: DroppedCondition[]
  /**
   * `true` only when at least one condition was requested and *none* of them
   * produced SQL. `false` for the genuine no-filter case.
   */
  allConditionsDropped: boolean
}

/**
 * Abstract base class for condition builders.
 * Implements shared logic for SQL generation, validation, and description.
 *
 * Stateless by design: every build call returns its own
 * {@link ConditionQueryResult}, so concurrent callers of the exported singletons
 * (`entityConditionBuilder`, `systemConditionBuilder`) can never read each
 * other's diagnostics.
 *
 * @template TContext - The context type needed by the specific builder
 *                      (e.g., TableId for system, EntityQueryContext for entities)
 */
export abstract class BaseConditionBuilder<TContext> {
  /**
   * Build WHERE SQL from a flat conditions array.
   *
   * Thin projection of {@link buildWhereSqlWithDiagnostics} — the clause only.
   * Dropped conditions widen the result set silently, which is the intended
   * behaviour for UI surfaces but not for AI tools.
   */
  buildWhereSql(conditions: GenericCondition[], context: TContext): SQL<unknown> | undefined {
    return this.buildWhereSqlWithDiagnostics(conditions, context).sql
  }

  /**
   * Build WHERE SQL from grouped conditions.
   *
   * Thin projection of {@link buildGroupedQueryWithDiagnostics} — the clause
   * only. Prefer the diagnostics variant anywhere a dropped filter must be a
   * visible failure rather than a wider result set.
   */
  buildGroupedQuery(groups: ConditionGroup[], context: TContext): SQL<unknown> | undefined {
    return this.buildGroupedQueryWithDiagnostics(groups, context).sql
  }

  /**
   * Build WHERE SQL from a flat conditions array, with drop diagnostics.
   *
   * A flat array carries no group, so the single combining operator is derived
   * from the conditions themselves: `OR` when any condition after the first
   * asks for it, `AND` otherwise. See {@link combineSqlClauses} for why the
   * operator is per-set rather than per-condition.
   */
  buildWhereSqlWithDiagnostics(
    conditions: GenericCondition[],
    context: TContext
  ): ConditionQueryResult {
    const droppedConditions: DroppedCondition[] = []
    const sql = this.buildClauseForConditions(
      conditions,
      this.deriveFlatOperator(conditions),
      context,
      droppedConditions
    )

    return this.toResult(sql, conditions.length, droppedConditions)
  }

  /**
   * Build WHERE SQL from grouped conditions, with drop diagnostics.
   *
   * Groups are combined with `AND` at the top level; conditions *inside* a group
   * are combined with that group's own `logicalOperator`.
   */
  buildGroupedQueryWithDiagnostics(
    groups: ConditionGroup[],
    context: TContext
  ): ConditionQueryResult {
    const droppedConditions: DroppedCondition[] = []
    const requestedConditions = groups.reduce((total, group) => total + group.conditions.length, 0)

    const groupClauses: SQL<unknown>[] = []
    for (const group of groups) {
      const clause = this.buildClauseForConditions(
        group.conditions,
        group.logicalOperator || 'AND',
        context,
        droppedConditions
      )
      if (clause) groupClauses.push(clause)
    }

    const sql =
      groupClauses.length === 0
        ? undefined
        : groupClauses.length === 1
          ? groupClauses[0]
          : and(...groupClauses)

    return this.toResult(sql, requestedConditions, droppedConditions)
  }

  /**
   * Turn one set of conditions into a single clause, appending anything that
   * could not be built to `dropped`.
   */
  private buildClauseForConditions(
    conditions: GenericCondition[],
    logicalOperator: 'AND' | 'OR',
    context: TContext,
    dropped: DroppedCondition[]
  ): SQL<unknown> | undefined {
    if (conditions.length === 0) return undefined

    const clauses: SQL<unknown>[] = []

    for (const condition of conditions) {
      const fieldRef = condition.fieldId

      // Belt-and-suspenders: valueSource placeholders must be resolved upstream
      // via resolveConditionContext before reaching query builders.
      if (condition.valueSource) {
        logger.warn(
          `Dropping condition with unresolved valueSource '${condition.valueSource}' — should have been substituted upstream`,
          { fieldRef }
        )
        dropped.push({
          conditionId: condition.id,
          fieldRef,
          operator: condition.operator,
          reason: 'unresolved-value-source',
          detail: condition.valueSource,
        })
        continue
      }

      const sqlResult = this.conditionToSql(condition, context)
      if (!sqlResult) {
        dropped.push({
          conditionId: condition.id,
          fieldRef,
          operator: condition.operator,
          reason: 'unresolved-field-or-operator',
          detail: this.constructor.name,
        })
        continue
      }

      clauses.push(sqlResult)
    }

    return this.combineSqlClauses(clauses, logicalOperator)
  }

  /** Assemble the public result shape, deriving {@link ConditionQueryResult.allConditionsDropped}. */
  private toResult(
    sql: SQL<unknown> | undefined,
    requestedConditions: number,
    droppedConditions: DroppedCondition[]
  ): ConditionQueryResult {
    return {
      sql,
      requestedConditions,
      droppedConditions,
      allConditionsDropped:
        requestedConditions > 0 && droppedConditions.length === requestedConditions,
    }
  }

  /**
   * Single combining operator for a flat (group-less) condition array.
   *
   * The first condition's own `logicalOperator` has never had a meaning — it
   * joins nothing — so only conditions after the first are consulted.
   */
  private deriveFlatOperator(conditions: GenericCondition[]): 'AND' | 'OR' {
    return conditions.some((condition, index) => index > 0 && condition.logicalOperator === 'OR')
      ? 'OR'
      : 'AND'
  }

  /**
   * Validate conditions against available fields
   */
  validateConditions(
    conditions: GenericCondition[],
    context: TContext,
    allowedFieldIds?: string[]
  ): ValidationResult {
    const errors: string[] = []

    for (const condition of conditions) {
      const fieldRef = condition.fieldId
      const displayRef = Array.isArray(fieldRef) ? fieldRef.join(' → ') : fieldRef

      // For array paths, the source field is the first element
      const rawSourceRef = Array.isArray(fieldRef) ? fieldRef[0] : fieldRef
      if (!rawSourceRef) {
        errors.push(`Condition ${condition.id} has an empty field path`)
        continue
      }

      // Legacy dot notation ('company.name') is a relationship path, exactly as
      // conditionToSql treats it — only the source hop lives in this context.
      const isRelationshipPath = Array.isArray(fieldRef)
        ? fieldRef.length > 1
        : rawSourceRef.includes('.')
      const sourceRef =
        isRelationshipPath && !Array.isArray(fieldRef)
          ? (rawSourceRef.split('.')[0] as string)
          : rawSourceRef

      // Check if field is allowed (handle both string and array formats)
      if (allowedFieldIds && !allowedFieldIds.includes(sourceRef)) {
        errors.push(`Field '${displayRef}' is not allowed`)
        continue
      }

      // Check if field exists (extract field key from either format)
      const fieldKey = sourceRef.includes(':')
        ? parseResourceFieldId(sourceRef as ResourceFieldId).fieldId
        : sourceRef

      const fieldType = this.getFieldType(fieldKey, context)
      if (!fieldType) {
        errors.push(`Unknown field: ${displayRef}`)
        continue
      }

      // Check operator
      if (!condition.operator) {
        errors.push(`Condition ${condition.id} is missing an operator`)
      }

      // Check value for operators that require it
      if (this.isValueRequiredOperator(condition.operator)) {
        if (condition.value === '' || condition.value === null || condition.value === undefined) {
          errors.push(
            `Condition ${condition.id} requires a value for operator '${condition.operator}'`
          )
        }
      }

      // Validate option values if applicable. Skipped for relationship paths:
      // the value belongs to the *terminal* field, whose options this context
      // doesn't hold — checking it against the source hop's options would
      // reject every valid multi-hop filter.
      const fieldOptions = isRelationshipPath ? undefined : this.getFieldOptions(fieldKey, context)
      if (fieldOptions && fieldOptions.length > 0 && condition.value) {
        // Both keyspaces: app- and connector-provisioned option sets carry an
        // explicit `id`, and that is what a stored filter holds — matching only
        // `value` rejects a perfectly valid filter on such a field. Labels stay
        // accepted because the UI writes them for value-as-label option sets.
        const validKeys = buildOptionIndex(fieldOptions)
        const validLabels = new Set(fieldOptions.map((opt) => opt.label))
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        for (const val of values) {
          if (typeof val === 'string' && !validKeys.has(val) && !validLabels.has(val)) {
            errors.push(`Invalid value '${val}' for field '${displayRef}'`)
          }
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Validate condition groups
   */
  validateConditionGroups(
    groups: ConditionGroup[],
    context: TContext,
    allowedFieldIds?: string[]
  ): ValidationResult {
    const errors: string[] = []

    for (const [groupIndex, group] of groups.entries()) {
      if (group.conditions.length === 0) {
        errors.push(`Group ${groupIndex + 1} is empty`)
        continue
      }

      const groupValidation = this.validateConditions(group.conditions, context, allowedFieldIds)
      if (!groupValidation.valid) {
        groupValidation.errors.forEach((error) => {
          errors.push(`Group ${groupIndex + 1}: ${error}`)
        })
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Generate human-readable description of conditions
   */
  describeConditions(conditions: GenericCondition[]): string {
    if (conditions.length === 0) {
      return 'No conditions'
    }

    const descriptions = conditions.map((condition, index) => {
      const prefix = index > 0 ? ` ${condition.logicalOperator || 'AND'} ` : ''
      const field = condition.fieldId
      const operator = condition.operator
      const value = Array.isArray(condition.value)
        ? condition.value.join(', ')
        : String(condition.value || '')

      if (this.isNullableOperator(operator)) {
        return `${prefix}${field} ${operator}`
      }

      return `${prefix}${field} ${operator} "${value}"`
    })

    return descriptions.join('')
  }

  /**
   * Generate human-readable description of grouped conditions
   */
  describeGroupedConditions(groups: ConditionGroup[]): string {
    if (groups.length === 0) return 'No condition groups'

    const groupDescriptions = groups.map((group, index) => {
      const groupDesc = this.describeConditions(group.conditions)
      return `Group ${index + 1} (${group.logicalOperator}): ${groupDesc}`
    })

    return groupDescriptions.join(' AND ')
  }

  // ─────────────────────────────────────────────────────────────────
  // PROTECTED SHARED HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Combine SQL clauses with a single operator for the whole set.
   *
   * This deliberately does **not** left-fold per-condition operators the way
   * this builder used to (`a AND b OR c` → `(a AND b) OR c`). Under a left fold
   * the meaning of a clause depends on which conditions before it survived, so
   * dropping one silently re-associates the rest — the same rule the mail
   * builder settled on in `mail-query/condition-query-builder.ts:201`.
   */
  protected combineSqlClauses(
    clauses: SQL<unknown>[],
    logicalOperator: 'AND' | 'OR'
  ): SQL<unknown> | undefined {
    if (clauses.length === 0) return undefined
    if (clauses.length === 1) return clauses[0]
    return logicalOperator === 'OR' ? or(...clauses)! : and(...clauses)!
  }

  /**
   * Convert value to appropriate type for SQL binding
   */
  protected convertValue(value: any, expectedType?: string): any {
    if (value === null || value === undefined) {
      return value
    }

    switch (expectedType) {
      case 'number': {
        const num = Number(value)
        return Number.isNaN(num) ? value : num
      }
      case 'date': {
        if (value instanceof Date) {
          return value
        }
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date
      }
      case 'boolean': {
        if (typeof value === 'boolean') {
          return value
        }
        const str = String(value).toLowerCase()
        return str === 'true' || str === '1'
      }
      case 'string':
      default:
        return String(value)
    }
  }

  /**
   * Normalize value to array of primitives
   */
  protected normalizeArray(
    value: any,
    expectedType?: string
  ): (string | number | boolean | Date)[] {
    const values = Array.isArray(value) ? value : [value]
    return values
      .map((item) => {
        // Extract ID from object format { referenceId: '...' }
        if (typeof item === 'object' && item !== null && 'referenceId' in item) {
          item = item.referenceId
        }
        return this.convertValue(item, expectedType)
      })
      .filter((item): item is string | number | boolean | Date => item !== undefined)
  }

  /**
   * Check if operator doesn't require a value
   * Uses centralized definition from OPERATOR_DEFINITIONS
   */
  protected isNullableOperator(operator: Operator): boolean {
    return !operatorRequiresValue(operator)
  }

  /**
   * Check if operator requires a value
   * Uses centralized definition from OPERATOR_DEFINITIONS
   */
  protected isValueRequiredOperator(operator: Operator): boolean {
    return operatorRequiresValue(operator)
  }

  /**
   * Convert BaseType to query type string
   */
  protected baseTypeToQueryType(baseType: BaseType): string {
    switch (baseType) {
      case BaseType.STRING:
      case BaseType.EMAIL:
      case BaseType.PHONE:
      case BaseType.URL:
      case BaseType.RELATION:
      case BaseType.SECRET:
        return 'string'
      case BaseType.NUMBER:
      case BaseType.CURRENCY:
        return 'number'
      case BaseType.BOOLEAN:
        return 'boolean'
      case BaseType.DATE:
      case BaseType.DATETIME:
      case BaseType.TIME:
        return 'date'
      case BaseType.ENUM:
        return 'enum'
      case BaseType.ARRAY:
      case BaseType.TAGS:
        return 'array'
      case BaseType.OBJECT:
      case BaseType.JSON:
      case BaseType.ADDRESS:
        return 'object'
      case BaseType.FILE:
        return 'file'
      default:
        return 'string'
    }
  }

  /**
   * Extract referenceId from object format { referenceId: '...' }
   * Used for RELATION field values
   */
  protected extractReferenceId(value: any): any {
    if (typeof value === 'object' && value !== null && 'referenceId' in value) {
      return value.referenceId
    }
    return value
  }

  /**
   * Convert option label(s) to stored value(s).
   */
  protected labelToStoredValue(
    options: FieldOptionItem[],
    label: string | string[]
  ): string | string[] {
    return labelToValue(options, label)
  }

  // ─────────────────────────────────────────────────────────────────
  // ABSTRACT METHODS - Must be implemented by subclasses
  // ─────────────────────────────────────────────────────────────────

  /**
   * Convert a single condition to SQL
   * This is where the strategy differs between system and entity queries
   */
  protected abstract conditionToSql(
    condition: GenericCondition,
    context: TContext
  ): SQL<unknown> | undefined

  /**
   * Build ORDER BY SQL clause
   */
  abstract buildOrderBySql(
    field: string,
    direction: 'asc' | 'desc',
    context: TContext
  ): SQL<unknown>[] | undefined

  /**
   * Get the type of a field (for validation and value conversion)
   */
  protected abstract getFieldType(fieldId: string, context: TContext): string | undefined

  /**
   * Get field options for a field (for validation)
   */
  protected abstract getFieldOptions(
    fieldId: string,
    context: TContext
  ): FieldOptionItem[] | undefined
}
