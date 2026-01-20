// packages/lib/src/workflow-engine/query-builder/base-condition-builder.ts

import { and, or, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import type { Operator } from '../operators/definitions'
import { operatorRequiresValue } from '../operators/definitions'
import { type FieldOptionItem, labelToValue } from '../../resources/registry/option-helpers'
import { BaseType } from '../core/types'

// Import from shared conditions module
import type {
  Condition,
  ConditionGroup as BaseConditionGroup,
  ConditionValidationResult,
} from '../../conditions'
import type { ResourceFieldId } from '@auxx/types/field'
import { parseResourceFieldId } from '@auxx/types/field'

const logger = createScopedLogger('base-condition-builder')

/**
 * Backward-compat alias for Condition
 * @deprecated Use Condition from @auxx/lib/conditions instead
 */
export type GenericCondition = Condition

/**
 * Re-export ConditionGroup for backward compatibility
 */
export type { BaseConditionGroup as ConditionGroup }

/**
 * Backward-compat alias for ConditionValidationResult
 * @deprecated Use ConditionValidationResult from @auxx/lib/conditions instead
 */
export type ValidationResult = ConditionValidationResult

/**
 * Abstract base class for condition builders
 * Implements shared logic for SQL generation, validation, and description
 *
 * @template TContext - The context type needed by the specific builder
 *                      (e.g., TableId for system, EntityQueryContext for entities)
 */
export abstract class BaseConditionBuilder<TContext> {
  /**
   * Build WHERE SQL from flat conditions array
   */
  buildWhereSql(conditions: GenericCondition[], context: TContext): SQL<unknown> | undefined {
    if (conditions.length === 0) {
      return undefined
    }

    const sqlClauses = conditions
      .map((condition) => this.conditionToSql(condition, context))
      .filter((clause): clause is SQL<unknown> => Boolean(clause))

    if (sqlClauses.length === 0) {
      return undefined
    }

    if (sqlClauses.length === 1) {
      return sqlClauses[0]
    }

    return this.combineSqlClauses(sqlClauses, conditions)
  }

  /**
   * Build WHERE SQL from grouped conditions
   */
  buildGroupedQuery(groups: ConditionGroup[], context: TContext): SQL<unknown> | undefined {
    if (groups.length === 0) {
      return undefined
    }

    if (groups.length === 1) {
      return this.buildWhereSql(groups[0].conditions, context)
    }

    const groupClauses = groups
      .map((group) => this.buildWhereSql(group.conditions, context))
      .filter((clause): clause is SQL<unknown> => Boolean(clause))

    if (groupClauses.length === 0) {
      return undefined
    }

    return groupClauses.length === 1 ? groupClauses[0] : and(...groupClauses)
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
      // Check if field is allowed (handle both string and array formats)
      if (allowedFieldIds) {
        const fieldRef = condition.fieldId

        // For array paths, validate the first element (source field)
        const fieldToValidate = Array.isArray(fieldRef) ? fieldRef[0] : fieldRef

        if (!allowedFieldIds.includes(fieldToValidate)) {
          const displayRef = Array.isArray(fieldRef) ? fieldRef.join(' → ') : fieldRef
          errors.push(`Field '${displayRef}' is not allowed`)
          continue
        }
      }

      // Check if field exists (extract field key from either format)
      const fieldRef = condition.fieldId
      const fieldKey = Array.isArray(fieldRef)
        ? (fieldRef[0].includes(':')
            ? parseResourceFieldId(fieldRef[0] as ResourceFieldId).fieldId
            : fieldRef[0])
        : (fieldRef.includes(':')
            ? parseResourceFieldId(fieldRef as ResourceFieldId).fieldId
            : fieldRef)

      const fieldType = this.getFieldType(fieldKey, context)
      if (!fieldType) {
        const displayRef = Array.isArray(fieldRef) ? fieldRef.join(' → ') : fieldRef
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

      // Validate option values if applicable
      const fieldOptions = this.getFieldOptions(fieldKey, context)
      if (fieldOptions && fieldOptions.length > 0 && condition.value) {
        const validValues = fieldOptions.map((opt) => opt.value)
        const validLabels = fieldOptions.map((opt) => opt.label)
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        for (const val of values) {
          if (typeof val === 'string' && !validValues.includes(val) && !validLabels.includes(val)) {
            const displayRef = Array.isArray(fieldRef) ? fieldRef.join(' → ') : fieldRef
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
   * Combine SQL clauses with AND/OR based on condition metadata
   */
  protected combineSqlClauses(
    clauses: SQL<unknown>[],
    conditions: GenericCondition[]
  ): SQL<unknown> {
    let combined = clauses[0]

    for (let i = 1; i < clauses.length; i++) {
      const logicalOperator = conditions[i].logicalOperator || 'AND'
      const clause = clauses[i]

      combined = logicalOperator === 'OR' ? or(combined, clause)! : and(combined, clause)!
    }

    return combined
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
