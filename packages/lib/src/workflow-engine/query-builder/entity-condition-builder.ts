// packages/lib/src/workflow-engine/query-builder/entity-condition-builder.ts

import { sql, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { schema } from '@auxx/database'
import type { ResourceField, EnumValue } from '../../resources/registry/field-types'
import { BaseType } from '../core/types'
import { BaseConditionBuilder, type GenericCondition } from './base-condition-builder'

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
 * Queries against CustomFieldValue table using EXISTS subqueries
 * (EntityInstance has no fieldValues column - values are in separate CustomFieldValue table)
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
    return this.buildJsonOperatorSql(condition.operator, fieldIdForSql, rawValue, fieldType, context)
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

    // Build subquery using raw SQL strings for CustomFieldValue references
    const valueSubquery = sql`(
      SELECT "CustomFieldValue"."value"->>'data'
      FROM "CustomFieldValue"
      WHERE "CustomFieldValue"."entityId" = ${outerTableId}
        AND "CustomFieldValue"."fieldId" = ${fieldIdForSql}
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
   * Build SQL for entity field conditions using EXISTS subquery against CustomFieldValue table
   * EntityInstance has no fieldValues column - values are stored in separate CustomFieldValue table
   *
   * IMPORTANT: We use raw SQL strings for CustomFieldValue references to prevent Drizzle
   * from applying the outer query's table alias to them. Only the outer table ID uses
   * a Drizzle column reference so it gets the correct alias ("EntityInstance").
   *
   * @param operator - The condition operator (e.g., 'is', 'contains')
   * @param fieldId - The database field ID (already resolved from field.key to field.id)
   * @param rawValue - The value to compare against
   * @param fieldType - The field type for type-specific handling
   * @param context - Query context with outer table reference
   */
  private buildJsonOperatorSql(
    operator: string,
    fieldId: string,
    rawValue: any,
    fieldType: string,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    // Keep outer table as Drizzle column reference for correct alias resolution
    const outerTableId = context.outerTable.id

    // Handle 'not exists' specially - check that NO row exists for this field
    if (operator === 'not exists') {
      return sql`NOT EXISTS (
        SELECT 1 FROM "CustomFieldValue"
        WHERE "CustomFieldValue"."entityId" = ${outerTableId}
          AND "CustomFieldValue"."fieldId" = ${fieldId}
      )`
    }

    // Build value condition for other operators (uses raw SQL for CustomFieldValue)
    const valueCondition = this.buildValueCondition(operator, rawValue)
    if (!valueCondition) return undefined

    // Build EXISTS subquery - use raw SQL strings for CustomFieldValue table/columns
    return sql`EXISTS (
      SELECT 1 FROM "CustomFieldValue"
      WHERE "CustomFieldValue"."entityId" = ${outerTableId}
        AND "CustomFieldValue"."fieldId" = ${fieldId}
        AND ${valueCondition}
    )`
  }

  /**
   * Build value condition for CustomFieldValue.value JSONB column
   * Values are stored as {"data": "actual_value"}
   *
   * IMPORTANT: Uses raw SQL strings for CustomFieldValue.value to prevent Drizzle
   * from applying the outer query's table alias.
   */
  private buildValueCondition(operator: string, rawValue: any): SQL<unknown> | undefined {
    // Use raw SQL for value column to prevent Drizzle alias resolution
    const valueData = sql.raw(`"CustomFieldValue"."value"->>'data'`)
    const valueCol = sql.raw(`"CustomFieldValue"."value"`)

    switch (operator) {
      // ===== EQUALITY =====
      case 'is': {
        if (rawValue === null || rawValue === undefined) {
          return sql`${valueCol} IS NULL`
        }
        return sql`${valueData} = ${String(rawValue)}`
      }

      case 'is not': {
        if (rawValue === null || rawValue === undefined) {
          return sql`${valueCol} IS NOT NULL`
        }
        return sql`${valueData} != ${String(rawValue)}`
      }

      // ===== STRING =====
      case 'contains': {
        return sql`${valueData} ILIKE ${'%' + String(rawValue ?? '') + '%'}`
      }

      case 'not contains': {
        return sql`${valueData} NOT ILIKE ${'%' + String(rawValue ?? '') + '%'}`
      }

      case 'starts with': {
        return sql`${valueData} ILIKE ${String(rawValue ?? '') + '%'}`
      }

      case 'ends with': {
        return sql`${valueData} ILIKE ${'%' + String(rawValue ?? '')}`
      }

      // ===== COMPARISON (with numeric cast) =====
      case '>': {
        return sql`(${valueData})::numeric > ${Number(rawValue)}`
      }

      case '<': {
        return sql`(${valueData})::numeric < ${Number(rawValue)}`
      }

      case '>=': {
        return sql`(${valueData})::numeric >= ${Number(rawValue)}`
      }

      case '<=': {
        return sql`(${valueData})::numeric <= ${Number(rawValue)}`
      }

      // ===== SET =====
      case 'in': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${valueData} = ${String(v)}`)
        return conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` OR `)})`
      }

      case 'not in': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${valueData} != ${String(v)}`)
        return conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` AND `)})`
      }

      // ===== EXISTENCE =====
      case 'exists': {
        // EXISTS subquery already checks for row existence
        return sql`true`
      }

      case 'not exists': {
        // Return undefined to skip the EXISTS clause - handled specially
        return undefined
      }

      case 'empty': {
        return sql`(${valueData} IS NULL OR ${valueData} = '')`
      }

      case 'not empty': {
        return sql`(${valueData} IS NOT NULL AND ${valueData} != '')`
      }

      default: {
        logger.warn(`Unknown operator '${operator}' for entity field value condition`)
        if (rawValue === null || rawValue === undefined) return undefined
        return sql`${valueData} = ${String(rawValue)}`
      }
    }
  }
}

// Export singleton instance
export const entityConditionBuilder = new EntityConditionBuilder()
