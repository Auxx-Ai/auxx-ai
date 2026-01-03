// packages/lib/src/workflow-engine/query-builder/entity-condition-builder.ts

import { sql, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { schema } from '@auxx/database'
import type { ResourceField, EnumValue } from '../../resources/registry/field-types'
import { BaseType } from '../core/types'
import { BaseConditionBuilder, type GenericCondition } from './base-condition-builder'
import { getValueType } from '@auxx/types'

const logger = createScopedLogger('entity-condition-builder')

/**
 * Context for entity instance queries
 */
export interface EntityQueryContext {
  /** Fields for this entity (from ResourceRegistryService) */
  fields: ResourceField[]
  /** The outer table schema (EntityInstance) for proper column references in subqueries */
  outerTable: typeof schema.EntityInstance
}

/**
 * Condition builder for custom entity instances
 * Queries against FieldValue table using EXISTS subqueries with typed columns
 * (EntityInstance has no fieldValues column - values are in separate FieldValue table)
 */
export class EntityConditionBuilder extends BaseConditionBuilder<EntityQueryContext> {
  // ─────────────────────────────────────────────────────────────────
  // ABSTRACT IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────

  protected conditionToSql(
    condition: GenericCondition,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    // Find field by key (condition.fieldId stores the human-readable field name)
    const field = context.fields.find((f) => f.key === condition.fieldId)
    if (!field) {
      logger.warn(`Field '${condition.fieldId}' not found in entity fields`)
      return undefined
    }

    // Resolve to database field ID for SQL queries
    // field.id is the actual CustomField database ID, field.key is the human-readable name
    const fieldIdForSql = field.id || condition.fieldId

    // Extract ID from object format and transform enum labels
    let rawValue = this.extractReferenceId(condition.value)
    if (field.type === BaseType.ENUM && field.enumValues) {
      rawValue = this.labelToDbValue(field.enumValues, rawValue)
    }

    const fieldType = this.baseTypeToQueryType(field.type)
    // Get the database field type to determine which typed column to use
    const dbFieldType = field.dbFieldType || 'TEXT'
    return this.buildTypedConditionSql(condition.operator, fieldIdForSql, rawValue, fieldType, dbFieldType, context)
  }

  buildOrderBySql(
    field: string,
    direction: 'asc' | 'desc',
    context: EntityQueryContext
  ): SQL<unknown>[] | undefined {
    // field parameter is the human-readable field name (field.key)
    const fieldDef = context.fields.find((f) => f.key === field)
    if (!fieldDef?.capabilities.sortable) {
      return undefined
    }

    // Resolve to database field ID for SQL queries
    const fieldIdForSql = fieldDef.id || field

    // Keep outer table as Drizzle column reference for correct alias resolution
    const outerTableId = context.outerTable.id

    // Determine which typed column to use based on field type
    const dbFieldType = fieldDef.dbFieldType || 'TEXT'
    const valueColumn = this.getTypedColumnName(dbFieldType)

    // Build subquery using FieldValue typed column
    const valueSubquery = sql`(
      SELECT "FieldValue".${sql.raw(`"${valueColumn}"`)}
      FROM "FieldValue"
      WHERE "FieldValue"."entityId" = ${outerTableId}
        AND "FieldValue"."fieldId" = ${fieldIdForSql}
      ORDER BY "FieldValue"."sortKey" ASC
      LIMIT 1
    )`

    const orderSql =
      direction === 'asc'
        ? sql`${valueSubquery} ASC NULLS LAST`
        : sql`${valueSubquery} DESC NULLS LAST`

    return [orderSql]
  }

  protected getFieldType(fieldId: string, context: EntityQueryContext): string | undefined {
    const field = context.fields.find((f) => f.key === fieldId)
    if (!field) return undefined
    return this.baseTypeToQueryType(field.type)
  }

  protected getEnumValues(fieldId: string, context: EntityQueryContext): EnumValue[] | undefined {
    const field = context.fields.find((f) => f.key === fieldId)
    return field?.enumValues
  }

  // ─────────────────────────────────────────────────────────────────
  // ENTITY-SPECIFIC HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the FieldValue column name for a database field type.
   */
  private getTypedColumnName(dbFieldType: string): string {
    const valueType = getValueType(dbFieldType)
    switch (valueType) {
      case 'text':
        return 'valueText'
      case 'number':
        return 'valueNumber'
      case 'boolean':
        return 'valueBoolean'
      case 'date':
        return 'valueDate'
      case 'json':
        return 'valueJson'
      case 'option':
        return 'optionId'
      case 'relationship':
        return 'relatedEntityId'
      default:
        return 'valueText'
    }
  }

  /**
   * Build SQL for entity field conditions using EXISTS subquery against FieldValue table
   * EntityInstance has no fieldValues column - values are stored in separate FieldValue table
   *
   * @param operator - The condition operator (e.g., 'is', 'contains')
   * @param fieldId - The database field ID (already resolved from field.key to field.id)
   * @param rawValue - The value to compare against
   * @param fieldType - The field type for type-specific handling
   * @param dbFieldType - The database field type (e.g., 'TEXT', 'NUMBER')
   * @param context - Query context with outer table reference
   */
  private buildTypedConditionSql(
    operator: string,
    fieldId: string,
    rawValue: unknown,
    fieldType: string,
    dbFieldType: string,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    // Keep outer table as Drizzle column reference for correct alias resolution
    const outerTableId = context.outerTable.id

    // Handle 'not exists' specially - check that NO row exists for this field
    if (operator === 'not exists') {
      return sql`NOT EXISTS (
        SELECT 1 FROM "FieldValue"
        WHERE "FieldValue"."entityId" = ${outerTableId}
          AND "FieldValue"."fieldId" = ${fieldId}
      )`
    }

    // Build value condition for other operators
    const valueCondition = this.buildTypedValueCondition(operator, rawValue, dbFieldType)
    if (!valueCondition) return undefined

    // Build EXISTS subquery
    return sql`EXISTS (
      SELECT 1 FROM "FieldValue"
      WHERE "FieldValue"."entityId" = ${outerTableId}
        AND "FieldValue"."fieldId" = ${fieldId}
        AND ${valueCondition}
    )`
  }

  /**
   * Build value condition for FieldValue typed columns.
   */
  private buildTypedValueCondition(
    operator: string,
    rawValue: unknown,
    dbFieldType: string
  ): SQL<unknown> | undefined {
    const columnName = this.getTypedColumnName(dbFieldType)
    const valueCol = sql.raw(`"FieldValue"."${columnName}"`)

    switch (operator) {
      // ===== EQUALITY =====
      case 'is': {
        if (rawValue === null || rawValue === undefined) {
          return sql`${valueCol} IS NULL`
        }
        return this.buildTypedEquality(valueCol, rawValue, dbFieldType)
      }

      case 'is not': {
        if (rawValue === null || rawValue === undefined) {
          return sql`${valueCol} IS NOT NULL`
        }
        return this.buildTypedInequality(valueCol, rawValue, dbFieldType)
      }

      // ===== STRING (text columns only) =====
      case 'contains': {
        return sql`${valueCol}::text ILIKE ${'%' + String(rawValue ?? '') + '%'}`
      }

      case 'not contains': {
        return sql`${valueCol}::text NOT ILIKE ${'%' + String(rawValue ?? '') + '%'}`
      }

      case 'starts with': {
        return sql`${valueCol}::text ILIKE ${String(rawValue ?? '') + '%'}`
      }

      case 'ends with': {
        return sql`${valueCol}::text ILIKE ${'%' + String(rawValue ?? '')}`
      }

      // ===== COMPARISON (numeric columns) =====
      case '>': {
        const numCol = sql.raw(`"FieldValue"."valueNumber"`)
        return sql`${numCol} > ${Number(rawValue)}`
      }

      case '<': {
        const numCol = sql.raw(`"FieldValue"."valueNumber"`)
        return sql`${numCol} < ${Number(rawValue)}`
      }

      case '>=': {
        const numCol = sql.raw(`"FieldValue"."valueNumber"`)
        return sql`${numCol} >= ${Number(rawValue)}`
      }

      case '<=': {
        const numCol = sql.raw(`"FieldValue"."valueNumber"`)
        return sql`${numCol} <= ${Number(rawValue)}`
      }

      // ===== SET =====
      case 'in': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        if (!values.length) return undefined
        const conditions = values.map((v) => this.buildTypedEquality(valueCol, v, dbFieldType))
        return conditions.length === 1
          ? conditions[0]
          : sql`(${sql.join(conditions.filter(Boolean) as SQL[], sql` OR `)})`
      }

      case 'not in': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        if (!values.length) return undefined
        const conditions = values.map((v) => this.buildTypedInequality(valueCol, v, dbFieldType))
        return conditions.length === 1
          ? conditions[0]
          : sql`(${sql.join(conditions.filter(Boolean) as SQL[], sql` AND `)})`
      }

      // ===== EXISTENCE =====
      case 'exists': {
        return sql`true`
      }

      case 'not exists': {
        return undefined
      }

      case 'empty': {
        return sql`(${valueCol} IS NULL OR ${valueCol}::text = '')`
      }

      case 'not empty': {
        return sql`(${valueCol} IS NOT NULL AND ${valueCol}::text != '')`
      }

      default: {
        logger.warn(`Unknown operator '${operator}' for entity field value condition`)
        if (rawValue === null || rawValue === undefined) return undefined
        return this.buildTypedEquality(valueCol, rawValue, dbFieldType)
      }
    }
  }

  /**
   * Build typed equality condition based on value type.
   */
  private buildTypedEquality(
    valueCol: ReturnType<typeof sql.raw>,
    rawValue: unknown,
    dbFieldType: string
  ): SQL<unknown> {
    const valueType = getValueType(dbFieldType)

    switch (valueType) {
      case 'number':
        return sql`${valueCol} = ${Number(rawValue)}`
      case 'boolean':
        return sql`${valueCol} = ${Boolean(rawValue)}`
      case 'date':
        return sql`${valueCol} = ${String(rawValue)}`
      default:
        return sql`${valueCol} = ${String(rawValue)}`
    }
  }

  /**
   * Build typed inequality condition based on value type.
   */
  private buildTypedInequality(
    valueCol: ReturnType<typeof sql.raw>,
    rawValue: unknown,
    dbFieldType: string
  ): SQL<unknown> {
    const valueType = getValueType(dbFieldType)

    switch (valueType) {
      case 'number':
        return sql`${valueCol} != ${Number(rawValue)}`
      case 'boolean':
        return sql`${valueCol} != ${Boolean(rawValue)}`
      case 'date':
        return sql`${valueCol} != ${String(rawValue)}`
      default:
        return sql`${valueCol} != ${String(rawValue)}`
    }
  }
}

// Export singleton instance
export const entityConditionBuilder = new EntityConditionBuilder()
