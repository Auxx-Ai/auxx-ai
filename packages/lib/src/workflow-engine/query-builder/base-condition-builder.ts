// packages/lib/src/workflow-engine/query-builder/base-condition-builder.ts

import { and, or, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import type { Operator } from '../client'
import type { EnumValue } from '../../resources/registry/field-types'
import { BaseType } from '../core/types'

const logger = createScopedLogger('base-condition-builder')

/**
 * Generic condition structure used across all builders
 */
export interface GenericCondition {
  id: string
  fieldId: string
  operator: Operator
  value: string | number | boolean | string[] | any
  isConstant: boolean
  logicalOperator?: 'AND' | 'OR'
  key?: string
  subConditions?: GenericCondition[]
  metadata?: Record<string, any>
  numberVarType?: 'string' | 'number'
  variableId?: string
}

/**
 * Condition group with logical operator
 */
export interface ConditionGroup {
  id: string
  conditions: GenericCondition[]
  logicalOperator: 'AND' | 'OR'
  metadata?: Record<string, any>
  case_id?: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

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
      // Check if field is allowed
      if (allowedFieldIds && !allowedFieldIds.includes(condition.fieldId)) {
        errors.push(`Field '${condition.fieldId}' is not allowed`)
        continue
      }

      // Check if field exists
      const fieldType = this.getFieldType(condition.fieldId, context)
      if (!fieldType) {
        errors.push(`Unknown field: ${condition.fieldId}`)
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

      // Validate enum values if applicable
      const enumValues = this.getEnumValues(condition.fieldId, context)
      if (enumValues && condition.value) {
        const validLabels = enumValues.map((ev) => ev.label)
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        for (const val of values) {
          if (typeof val === 'string' && !validLabels.includes(val)) {
            errors.push(`Invalid value '${val}' for field '${condition.fieldId}'`)
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
   */
  protected isNullableOperator(operator: string): boolean {
    const nullableOperators = [
      'empty',
      'isEmpty',
      'not empty',
      'isNotEmpty',
      'exists',
      'not exists',
    ]
    return nullableOperators.includes(operator)
  }

  /**
   * Check if operator requires a value
   */
  protected isValueRequiredOperator(operator: string): boolean {
    const valueRequiredOperators = [
      '=',
      '!=',
      'equals',
      'not equals',
      'contains',
      'not contains',
      'starts with',
      'ends with',
      '>',
      '<',
      '>=',
      '<=',
      'greaterThan',
      'lessThan',
      'greaterThanOrEqual',
      'lessThanOrEqual',
      'in',
      'not in',
      'is',
      'is not',
    ]
    return valueRequiredOperators.includes(operator)
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
        return 'string'
      case BaseType.NUMBER:
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
        return 'array'
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
   * Convert enum label(s) to database value(s)
   */
  protected labelToDbValue(enumValues: EnumValue[], label: string | string[]): string | string[] {
    if (Array.isArray(label)) {
      return label.map((v) => this.labelToDbValue(enumValues, v) as string)
    }

    const enumValue = enumValues.find((ev) => ev.label === label)
    return enumValue?.dbValue ?? label
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
   * Get enum values for a field (for validation)
   */
  protected abstract getEnumValues(fieldId: string, context: TContext): EnumValue[] | undefined
}
