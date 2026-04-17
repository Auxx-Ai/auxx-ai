// packages/lib/src/workflow-engine/query-builder/system-condition-builder.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Operator } from '../../conditions/operator-definitions'
import { RESOURCE_FIELD_REGISTRY, RESOURCE_TABLE_MAP } from '../../resources/registry'
import type { TableId } from '../../resources/registry/field-registry'
import { type FieldOptionItem, getFieldOptions } from '../../resources/registry/option-helpers'
import { BaseConditionBuilder, type GenericCondition } from './base-condition-builder'

const logger = createScopedLogger('system-condition-builder')

/**
 * Condition builder for system resources (Contact, Ticket, etc.)
 * Uses Drizzle ORM column references for query building
 */
export class SystemConditionBuilder extends BaseConditionBuilder<TableId> {
  /**
   * Strip resource prefix from fieldId if present (e.g., "message:from" → "from").
   * UI stores ResourceFieldId format but registry keys are plain field names.
   */
  private stripFieldPrefix(fieldId: string): string {
    return fieldId.includes(':')
      ? parseResourceFieldId(fieldId as ResourceFieldId).fieldId
      : fieldId
  }

  // ─────────────────────────────────────────────────────────────────
  // ABSTRACT IMPLEMENTATIONS
  // ─────────────────────────────────────────────────────────────────

  protected conditionToSql(
    condition: GenericCondition,
    resourceType: TableId
  ): SQL<unknown> | undefined {
    // Handle custom fields (custom_xxx) with subquery
    const rawFieldId = Array.isArray(condition.fieldId) ? condition.fieldId[0] : condition.fieldId
    if (rawFieldId?.startsWith('custom_')) {
      return this.buildCustomFieldSubquery(resourceType, condition)
    }

    // Strip resource prefix for registry lookups (e.g., "message:from" → "from")
    const fieldId = this.stripFieldPrefix(rawFieldId)

    const fieldMeta = this.resolveFieldMetadata(resourceType, fieldId)
    if (!fieldMeta) {
      logger.warn(`Unable to resolve metadata for field '${fieldId}' on ${resourceType}`)
      return undefined
    }

    // Extract ID from object format and transform option labels
    let rawValue = this.extractReferenceId(condition.value)
    if (fieldMeta.type === 'enum') {
      const fieldOpts = this.getFieldOptions(fieldId, resourceType)
      if (fieldOpts && fieldOpts.length > 0) {
        rawValue = this.labelToStoredValue(fieldOpts, rawValue)
      }
    }

    const normalizedType = fieldMeta.type === 'enum' ? 'string' : fieldMeta.type

    return this.buildOperatorSql(
      condition.operator,
      rawValue,
      fieldMeta.columns,
      normalizedType,
      resourceType,
      fieldId
    )
  }

  buildOrderBySql(
    field: string,
    direction: 'asc' | 'desc',
    resourceType: TableId
  ): SQL<unknown>[] | undefined {
    const fieldDef = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(field)]
    if (!fieldDef?.capabilities.sortable || fieldDef.capabilities.hidden || !fieldDef.dbColumn) {
      return undefined
    }

    const tableName = RESOURCE_TABLE_MAP[resourceType].dbName
    const columns = this.resolveColumns([`${tableName}.${fieldDef.dbColumn}`])

    if (!columns.length) {
      return undefined
    }

    return columns.map((column) => (direction === 'desc' ? desc(column) : asc(column)))
  }

  protected getFieldType(fieldId: string, resourceType: TableId): string | undefined {
    // Custom fields are always valid (validated separately)
    if (fieldId.startsWith('custom_')) {
      return 'string'
    }

    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(fieldId)]
    if (!field) return undefined

    return this.baseTypeToQueryType(field.type)
  }

  protected getFieldOptions(fieldId: string, resourceType: TableId): FieldOptionItem[] | undefined {
    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(fieldId)]
    return getFieldOptions(field)
  }

  // ─────────────────────────────────────────────────────────────────
  // SYSTEM-SPECIFIC HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Build SQL for a specific operator using Drizzle column references
   */
  private buildOperatorSql(
    operator: Operator,
    rawValue: any,
    columns: AnyColumn[],
    normalizedType: string,
    resourceType: TableId,
    fieldId: string
  ): SQL<unknown> | undefined {
    switch (operator) {
      // ===== EQUALITY =====
      case 'is': {
        if (rawValue === null || rawValue === undefined) {
          return this.combineColumnPredicates(columns, (col) => isNull(col), 'and')
        }
        const value = this.convertValue(rawValue, normalizedType)
        return this.combineColumnPredicates(columns, (col) => eq(col, value))
      }

      case 'is not': {
        if (rawValue === null || rawValue === undefined) {
          return this.combineColumnPredicates(columns, (col) => not(isNull(col)), 'and')
        }
        const value = this.convertValue(rawValue, normalizedType)
        return this.combineColumnPredicates(columns, (col) => ne(col, value), 'and')
      }

      // ===== STRING =====
      case 'contains': {
        const value = `%${String(rawValue ?? '')}%`
        return this.combineColumnPredicates(columns, (col) => ilike(col, value))
      }

      case 'not contains': {
        const value = `%${String(rawValue ?? '')}%`
        return this.combineColumnPredicates(columns, (col) => not(ilike(col, value)), 'and')
      }

      case 'starts with': {
        const value = `${String(rawValue ?? '')}%`
        return this.combineColumnPredicates(columns, (col) => ilike(col, value))
      }

      case 'ends with': {
        const value = `%${String(rawValue ?? '')}`
        return this.combineColumnPredicates(columns, (col) => ilike(col, value))
      }

      // ===== COMPARISON =====
      case '>': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => gt(col, value))
      }

      case '<': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => lt(col, value))
      }

      case '>=': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => gte(col, value))
      }

      case '<=': {
        const value = this.convertValue(rawValue, normalizedType ?? 'number')
        return this.combineColumnPredicates(columns, (col) => lte(col, value))
      }

      // ===== SET =====
      case 'in': {
        const values = this.normalizeArrayWithOptions(
          rawValue,
          normalizedType,
          resourceType,
          fieldId
        )
        if (!values.length) return undefined
        return this.combineColumnPredicates(columns, (col) => inArray(col, values))
      }

      case 'not in': {
        const values = this.normalizeArrayWithOptions(
          rawValue,
          normalizedType,
          resourceType,
          fieldId
        )
        if (!values.length) return undefined
        return this.combineColumnPredicates(columns, (col) => notInArray(col, values), 'and')
      }

      // ===== DATE (same-day) =====
      case 'on_date': {
        if (rawValue === null || rawValue === undefined) return undefined
        const date = new Date(rawValue)
        const startOfDay = new Date(date)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(date)
        endOfDay.setHours(23, 59, 59, 999)
        return this.combineColumnPredicates(columns, (col) =>
          and(gte(col, startOfDay), lte(col, endOfDay))
        )
      }

      case 'not_on_date': {
        if (rawValue === null || rawValue === undefined) return undefined
        const date = new Date(rawValue)
        const startOfDay = new Date(date)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(date)
        endOfDay.setHours(23, 59, 59, 999)
        return this.combineColumnPredicates(
          columns,
          (col) => or(lt(col, startOfDay), gt(col, endOfDay)),
          'and'
        )
      }

      // ===== EXISTENCE =====
      case 'empty': {
        return this.combineColumnPredicates(columns, (col) => or(isNull(col), eq(col, '')), 'and')
      }

      case 'not empty': {
        return this.combineColumnPredicates(
          columns,
          (col) => and(isNotNull(col), not(eq(col, ''))),
          'and'
        )
      }

      case 'exists': {
        return this.combineColumnPredicates(
          columns,
          (col) => and(isNotNull(col), not(eq(col, ''))),
          'and'
        )
      }

      case 'not exists': {
        return this.combineColumnPredicates(columns, (col) => isNull(col), 'and')
      }

      default: {
        logger.warn(`Unknown operator '${operator}' for field`)
        if (rawValue === null || rawValue === undefined) return undefined
        const value = this.convertValue(rawValue, normalizedType)
        return this.combineColumnPredicates(columns, (col) => eq(col, value))
      }
    }
  }

  /**
   * Combine predicates across columns with AND/OR
   */
  private combineColumnPredicates(
    columns: AnyColumn[],
    builder: (column: AnyColumn) => SQL<unknown>,
    logicalMode: 'and' | 'or' = 'or'
  ): SQL<unknown> | undefined {
    const clauses = columns.map((col) => builder(col))
    if (clauses.length === 0) return undefined
    if (clauses.length === 1) return clauses[0]
    return logicalMode === 'and' ? and(...clauses) : or(...clauses)
  }

  /**
   * Resolve field metadata from registry
   */
  private resolveFieldMetadata(
    resourceType: TableId,
    fieldId: string
  ): { columns: AnyColumn[]; type: string } | undefined {
    const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[this.stripFieldPrefix(fieldId)]
    if (!field || !field.capabilities.filterable || field.capabilities.hidden || !field.dbColumn) {
      return undefined
    }

    const tableName = RESOURCE_TABLE_MAP[resourceType].dbName
    const columns = this.resolveColumns([`${tableName}.${field.dbColumn}`])
    if (!columns.length) return undefined

    return {
      columns,
      type: this.baseTypeToQueryType(field.type),
    }
  }

  /**
   * Resolve column paths to Drizzle column references
   */
  private resolveColumns(columnPaths: string[]): AnyColumn[] {
    const resolved: AnyColumn[] = []

    for (const path of columnPaths) {
      const [tableKey, columnKey] = path.split('.')
      if (!tableKey || !columnKey) continue

      const table = (schema as Record<string, any>)[tableKey]
      if (!table) continue

      const column = table[columnKey]
      if (!column) continue

      resolved.push(column as AnyColumn)
    }

    return resolved
  }

  /**
   * Normalize array with option label transformation
   */
  private normalizeArrayWithOptions(
    value: any,
    expectedType: string,
    resourceType: TableId,
    fieldId: string
  ): (string | number | boolean | Date)[] {
    const fieldOpts =
      expectedType === 'enum' ? this.getFieldOptions(fieldId, resourceType) : undefined

    const values = Array.isArray(value) ? value : [value]
    return values
      .map((item) => {
        item = this.extractReferenceId(item)
        if (expectedType === 'enum' && fieldOpts && fieldOpts.length > 0) {
          item = this.labelToStoredValue(fieldOpts, item)
        }
        return this.convertValue(item, expectedType === 'enum' ? 'string' : expectedType)
      })
      .filter((item): item is string | number | boolean | Date => item !== undefined)
  }

  /**
   * Build EXISTS subquery for FieldValue table
   * This is specific to system resources that support custom fields
   */
  private buildCustomFieldSubquery(
    resourceType: TableId,
    condition: GenericCondition
  ): SQL<unknown> | undefined {
    const customFieldId = condition.fieldId.replace(/^custom_/, '')
    const tableInfo = RESOURCE_TABLE_MAP[resourceType]
    if (!tableInfo) return undefined

    const resourceTable = (schema as Record<string, any>)[tableInfo.dbName]
    if (!resourceTable) return undefined

    // Handle 'not exists' operator
    if (condition.operator === 'not exists') {
      return sql`NOT EXISTS (
        SELECT 1 FROM ${schema.FieldValue}
        WHERE ${schema.FieldValue.entityId} = ${resourceTable.id}
          AND ${schema.FieldValue.fieldId} = ${customFieldId}
      )`
    }

    const valueCondition = this.buildCustomFieldValueCondition(
      condition.operator as Operator,
      condition.value
    )
    if (!valueCondition) return undefined

    return sql`EXISTS (
      SELECT 1 FROM ${schema.FieldValue}
      WHERE ${schema.FieldValue.entityId} = ${resourceTable.id}
        AND ${schema.FieldValue.fieldId} = ${customFieldId}
        AND ${valueCondition}
    )`
  }

  /**
   * Build value condition for FieldValue typed columns.
   * Uses COALESCE across typed columns to produce a comparable text value,
   * matching the old CustomFieldValue JSONB behavior.
   */
  private buildCustomFieldValueCondition(operator: Operator, value: any): SQL<unknown> | undefined {
    // COALESCE across typed columns to get a text representation
    const textValue = sql`COALESCE(${schema.FieldValue.valueText}, ${schema.FieldValue.optionId}, CAST(${schema.FieldValue.valueNumber} AS text), CAST(${schema.FieldValue.valueBoolean} AS text), CAST(${schema.FieldValue.valueDate} AS text))`

    switch (operator) {
      case 'is':
        if (value === null || value === undefined) {
          return sql`${textValue} IS NULL`
        }
        return sql`${textValue} = ${String(value)}`

      case 'is not':
        if (value === null || value === undefined) {
          return sql`${textValue} IS NOT NULL`
        }
        return sql`${textValue} != ${String(value)}`

      case 'contains':
        return sql`${textValue} ILIKE ${'%' + String(value ?? '') + '%'}`

      case 'not contains':
        return sql`${textValue} NOT ILIKE ${'%' + String(value ?? '') + '%'}`

      case 'starts with':
        return sql`${textValue} ILIKE ${String(value ?? '') + '%'}`

      case 'ends with':
        return sql`${textValue} ILIKE ${'%' + String(value ?? '')}`

      case '>':
        return sql`${schema.FieldValue.valueNumber} > ${Number(value)}`

      case '<':
        return sql`${schema.FieldValue.valueNumber} < ${Number(value)}`

      case '>=':
        return sql`${schema.FieldValue.valueNumber} >= ${Number(value)}`

      case '<=':
        return sql`${schema.FieldValue.valueNumber} <= ${Number(value)}`

      case 'in': {
        const values = Array.isArray(value) ? value : [value]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${textValue} = ${String(v)}`)
        return conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` OR `)})`
      }

      case 'not in': {
        const values = Array.isArray(value) ? value : [value]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${textValue} != ${String(v)}`)
        return conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` AND `)})`
      }

      case 'exists':
        return sql`true`

      case 'empty':
        return sql`(${textValue} IS NULL OR ${textValue} = '')`

      case 'not empty':
        return sql`(${textValue} IS NOT NULL AND ${textValue} != '')`

      default:
        return undefined
    }
  }
}

// Export singleton instance for convenience
export const systemConditionBuilder = new SystemConditionBuilder()
