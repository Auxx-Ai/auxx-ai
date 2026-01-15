// packages/lib/src/workflow-engine/query-builder/entity-condition-builder.ts

import { sql, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { schema } from '@auxx/database'
import type { ResourceField, EnumValue } from '../../resources/registry/field-types'
import { BaseType } from '../core/types'
import { BaseConditionBuilder, type GenericCondition } from './base-condition-builder'
import { getValueType } from '@auxx/types'
import type { Operator } from '../operators/definitions'
import type { ResourceFieldId } from '@auxx/types/field'
import { parseResourceFieldId, getFieldId, getFieldDefinitionId } from '@auxx/types/field'

const logger = createScopedLogger('entity-condition-builder')

/**
 * Context for entity instance queries
 */
export interface EntityQueryContext {
  /** Fields for this entity (from ResourceRegistryService) */
  fields: ResourceField[]
  /** The outer table schema (EntityInstance) for proper column references in subqueries */
  outerTable: typeof schema.EntityInstance
  /**
   * Fields for related entities (for relationship path filtering)
   *
   * Key: relatedEntityDefinitionId
   * Value: Array of ResourceField for that entity
   *
   * Only needed when conditions use relationship paths like ['product:vendor', 'vendor:name']
   */
  relatedEntityFields?: Record<string, ResourceField[]>
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
    const fieldRef = condition.fieldId

    logger.debug(`Processing condition: fieldId=${Array.isArray(fieldRef) ? JSON.stringify(fieldRef) : fieldRef}, operator=${condition.operator}, value=${condition.value}`)

    // Case 1: Path array (preferred) - relationship traversal
    if (Array.isArray(fieldRef)) {
      if (fieldRef.length === 0) {
        logger.warn('Empty field path array')
        return undefined
      }

      // Single element array = direct field
      if (fieldRef.length === 1) {
        const { fieldId: fieldKey } = parseResourceFieldId(fieldRef[0])
        logger.debug(`Processing single-element array as direct field: ${fieldKey}`)
        return this.buildDirectFieldCondition(fieldKey, condition, context)
      }

      // Multi-element array = relationship path
      logger.debug(`Processing relationship path with ${fieldRef.length} elements`)
      return this.buildRelationshipPathCondition(fieldRef, condition, context)
    }

    // Case 2: String reference
    if (typeof fieldRef === 'string') {
      // Legacy dot notation - convert to path
      if (fieldRef.includes('.')) {
        const pathParts = fieldRef.split('.')
        logger.debug(`Converting dot notation '${fieldRef}' to path array`)
        return this.buildRelationshipPathCondition(pathParts, condition, context)
      }

      // Direct field reference (could be ResourceFieldId or plain key)
      const fieldKey = fieldRef.includes(':') ? parseResourceFieldId(fieldRef as ResourceFieldId).fieldId : fieldRef
      logger.debug(`Processing direct field: ${fieldKey}`)
      return this.buildDirectFieldCondition(fieldKey, condition, context)
    }

    logger.warn(`Invalid field reference type: ${typeof fieldRef}`)
    return undefined
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
   * Build condition for direct field on this entity
   */
  private buildDirectFieldCondition(
    fieldKey: string,
    condition: GenericCondition,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    // Find field by key
    const field = context.fields.find((f) => f.key === fieldKey)
    if (!field) {
      logger.warn(`Field '${fieldKey}' not found in entity fields`)
      logger.debug(`Available fields: ${context.fields.map(f => f.key).join(', ')}`)
      return undefined
    }

    logger.debug(`Found field: key=${field.key}, type=${field.type}, isSystem=${field.isSystem}, dbColumn=${field.dbColumn}, dbFieldType=${field.dbFieldType}`)

    // Extract ID from object format and transform enum labels
    let rawValue = this.extractReferenceId(condition.value)
    if (field.type === BaseType.ENUM && field.enumValues) {
      rawValue = this.labelToDbValue(field.enumValues, rawValue)
    }

    // Handle system fields (columns on EntityInstance table) differently
    if (field.isSystem && field.dbColumn) {
      logger.debug(`Building system field condition for column: ${field.dbColumn}`)
      return this.buildSystemFieldCondition(
        field.dbColumn,
        condition.operator,
        rawValue,
        field.type,
        context
      )
    }

    // Custom fields stored in FieldValue table
    const fieldIdForSql = field.id || fieldKey
    const fieldType = this.baseTypeToQueryType(field.type)
    const dbFieldType = field.dbFieldType || 'TEXT'

    logger.debug(`Building custom field condition SQL: fieldIdForSql=${fieldIdForSql}, operator=${condition.operator}, value=${rawValue}, fieldType=${fieldType}, dbFieldType=${dbFieldType}`)

    return this.buildTypedConditionSql(
      condition.operator,
      fieldIdForSql,
      rawValue,
      fieldType,
      dbFieldType,
      context
    )
  }

  /**
   * Build condition for system fields (columns on EntityInstance table)
   * These fields are queried directly without EXISTS subquery
   */
  private buildSystemFieldCondition(
    dbColumn: string,
    operator: Operator,
    rawValue: unknown,
    fieldType: BaseType,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    const column = context.outerTable[dbColumn as keyof typeof context.outerTable]

    if (!column) {
      logger.warn(`System column '${dbColumn}' not found on EntityInstance table`)
      return undefined
    }

    logger.debug(`Building SQL for system field: column=${dbColumn}, operator=${operator}, value=${rawValue}`)

    // Handle date operators
    if (fieldType === BaseType.DATE || fieldType === BaseType.DATETIME) {
      switch (operator) {
        case 'before':
          return sql`${column} < ${String(rawValue)}`
        case 'after':
          return sql`${column} > ${String(rawValue)}`
        case 'on':
          return sql`${column}::date = ${String(rawValue)}::date`
        case 'not on':
          return sql`${column}::date != ${String(rawValue)}::date`
        case 'is':
          return sql`${column} = ${String(rawValue)}`
        case 'is not':
          return sql`${column} != ${String(rawValue)}`
        case 'exists':
          return sql`${column} IS NOT NULL`
        case 'not exists':
          return sql`${column} IS NULL`
        case 'empty':
          return sql`${column} IS NULL`
        case 'not empty':
          return sql`${column} IS NOT NULL`
        default:
          logger.warn(`Operator '${operator}' not supported for date system fields`)
          return undefined
      }
    }

    // Handle string operators
    if (fieldType === BaseType.STRING) {
      switch (operator) {
        case 'is':
          return rawValue === null || rawValue === undefined
            ? sql`${column} IS NULL`
            : sql`${column} = ${String(rawValue)}`
        case 'is not':
          return rawValue === null || rawValue === undefined
            ? sql`${column} IS NOT NULL`
            : sql`${column} != ${String(rawValue)}`
        case 'contains':
          return sql`${column}::text ILIKE ${'%' + String(rawValue ?? '') + '%'}`
        case 'not contains':
          return sql`${column}::text NOT ILIKE ${'%' + String(rawValue ?? '') + '%'}`
        case 'starts with':
          return sql`${column}::text ILIKE ${String(rawValue ?? '') + '%'}`
        case 'ends with':
          return sql`${column}::text ILIKE ${'%' + String(rawValue ?? '')}`
        case 'in': {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          return sql`${column} IN ${values.map(v => String(v))}`
        }
        case 'not in': {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          return sql`${column} NOT IN ${values.map(v => String(v))}`
        }
        case 'exists':
          return sql`${column} IS NOT NULL`
        case 'not exists':
          return sql`${column} IS NULL`
        case 'empty':
          return sql`(${column} IS NULL OR ${column}::text = '')`
        case 'not empty':
          return sql`(${column} IS NOT NULL AND ${column}::text != '')`
        default:
          logger.warn(`Operator '${operator}' not supported for string system fields`)
          return rawValue === null || rawValue === undefined
            ? undefined
            : sql`${column} = ${String(rawValue)}`
      }
    }

    // Fallback for other types
    logger.warn(`System field type '${fieldType}' not fully implemented, using basic equality`)
    return rawValue === null || rawValue === undefined
      ? sql`${column} IS NULL`
      : sql`${column} = ${String(rawValue)}`
  }

  /**
   * Build condition for related entity's field using ResourceFieldId path array
   *
   * @param path - Field path array of ResourceFieldIds or plain keys
   *   e.g., ['product:vendor', 'vendor:name'] or ['vendor', 'name'] (legacy)
   * @param condition - The condition with operator and value
   * @param context - Entity query context
   *
   * @example
   * // Single level: products where vendor.name contains 'Peter'
   * buildRelationshipPathCondition(
   *   ['product:vendor', 'vendor:name'],
   *   { operator: 'contains', value: 'Peter' },
   *   context
   * )
   *
   * // Multi-level: products where vendor.country.code is 'US' (Phase 2)
   * buildRelationshipPathCondition(
   *   ['product:vendor', 'vendor:country', 'country:code'],
   *   { operator: 'is', value: 'US' },
   *   context
   * )
   */
  private buildRelationshipPathCondition(
    path: (ResourceFieldId | string)[],
    condition: GenericCondition,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    logger.debug(`Building relationship path condition for path: ${JSON.stringify(path)}`)

    if (path.length < 2) {
      logger.warn(`Relationship path must have at least 2 elements, got: ${path.length}`)
      return undefined
    }

    // For Phase 1, support only 1-level nesting (2 elements: relationship + field)
    if (path.length > 2) {
      logger.warn(`Multi-level paths not yet supported. Path length: ${path.length}`)
      return undefined
    }

    const [relationshipRef, targetRef] = path
    logger.debug(`Relationship field: ${relationshipRef}, target field: ${targetRef}`)

    // Parse field keys from references (handle both ResourceFieldId and plain string)
    const relationshipFieldKey = typeof relationshipRef === 'string' && relationshipRef.includes(':')
      ? parseResourceFieldId(relationshipRef as ResourceFieldId).fieldId
      : relationshipRef

    const targetFieldKey = typeof targetRef === 'string' && targetRef.includes(':')
      ? parseResourceFieldId(targetRef as ResourceFieldId).fieldId
      : targetRef

    // Find the relationship field on the source entity
    const relationshipField = context.fields.find((f) =>
      f.key === relationshipFieldKey || (f.id && f.id === relationshipFieldKey)
    )

    if (!relationshipField) {
      logger.warn(`Relationship field '${relationshipFieldKey}' not found on entity`)
      return undefined
    }

    if (relationshipField.type !== BaseType.RELATION) {
      logger.warn(`Field '${relationshipFieldKey}' is not a relationship (type: ${relationshipField.type})`)
      return undefined
    }

    // Get related entity definition ID
    const relatedEntityDefId = relationshipField.relationship?.relatedEntityDefinitionId
    if (!relatedEntityDefId) {
      logger.warn(`No related entity definition for '${relationshipFieldKey}'`)
      return undefined
    }

    logger.debug(`Found relationship pointing to entity: ${relatedEntityDefId}`)

    // Validate path if using ResourceFieldId format
    if (typeof targetRef === 'string' && targetRef.includes(':')) {
      const { entityDefinitionId: targetEntity } = parseResourceFieldId(targetRef as ResourceFieldId)
      if (relatedEntityDefId !== targetEntity) {
        logger.warn(
          `Path validation failed: relationship '${relationshipRef}' ` +
          `points to '${relatedEntityDefId}' but next step expects '${targetEntity}'`
        )
        return undefined
      }
    }

    // Get fields for the related entity
    const relatedFields = this.getRelatedEntityFields(relatedEntityDefId, context)
    if (!relatedFields) {
      logger.warn(`Related entity fields not found for '${relatedEntityDefId}'`)
      return undefined
    }

    logger.debug(`Found ${relatedFields.length} fields for related entity '${relatedEntityDefId}'`)

    const relatedField = relatedFields.find((f) =>
      f.key === targetFieldKey || (f.id && f.id === targetFieldKey)
    )

    if (!relatedField) {
      logger.warn(`Target field '${targetFieldKey}' not found on entity '${relatedEntityDefId}'`)
      return undefined
    }

    logger.debug(`Building nested query for relationship: ${relationshipField.key} -> ${relatedField.key}`)

    // Build nested EXISTS query
    return this.buildNestedRelationshipQuery(
      relationshipField,
      relatedField,
      condition.operator,
      condition.value,
      context
    )
  }

  /**
   * Build nested EXISTS query for related entity field filtering
   *
   * Generates SQL pattern:
   * EXISTS (
   *   SELECT 1 FROM FieldValue rel
   *   WHERE rel.entityId = product.id
   *     AND rel.fieldId = 'vendor_field_id'
   *     AND EXISTS (
   *       SELECT 1 FROM FieldValue related
   *       WHERE related.entityId = rel.relatedEntityId
   *         AND related.fieldId = 'name_field_id'
   *         AND related.valueText ILIKE '%peter%'
   *     )
   * )
   */
  private buildNestedRelationshipQuery(
    relationshipField: ResourceField,
    relatedField: ResourceField,
    operator: Operator,
    rawValue: unknown,
    context: EntityQueryContext
  ): SQL<unknown> | undefined {
    const outerTableId = context.outerTable.id
    const relationshipFieldId = relationshipField.id || relationshipField.key
    const relatedFieldId = relatedField.id || relatedField.key

    // Extract value and transform if needed
    let value = this.extractReferenceId(rawValue)
    if (relatedField.type === BaseType.ENUM && relatedField.enumValues) {
      value = this.labelToDbValue(relatedField.enumValues, value)
    }

    // Determine which typed column to use for related field
    const relatedFieldType = relatedField.dbFieldType || this.fieldTypeToDbType(relatedField.type)
    const relatedColumnName = this.getTypedColumnName(relatedFieldType)

    // Build the value condition SQL directly for the related field
    const relatedValueCondition = this.buildRelatedFieldValueCondition(
      operator,
      value,
      relatedColumnName
    )

    if (!relatedValueCondition) {
      logger.warn(`Failed to build value condition for operator '${operator}'`)
      return undefined
    }

    // Build nested EXISTS with relationship traversal
    return sql`EXISTS (
      SELECT 1 FROM "FieldValue" rel
      WHERE rel."entityId" = ${outerTableId}
        AND rel."fieldId" = ${relationshipFieldId}
        AND EXISTS (
          SELECT 1 FROM "FieldValue" related
          WHERE related."entityId" = rel."relatedEntityId"
            AND related."fieldId" = ${relatedFieldId}
            AND ${relatedValueCondition}
        )
    )`
  }

  /**
   * Build value condition for related field in nested query
   * Similar to buildTypedValueCondition but uses 'related' table alias
   */
  private buildRelatedFieldValueCondition(
    operator: Operator,
    rawValue: unknown,
    columnName: string
  ): SQL<unknown> | undefined {
    const valueCol = sql.raw(`related."${columnName}"`)

    // Handle optionId fields (MULTI_SELECT, TAGS)
    if (columnName === 'optionId') {
      switch (operator) {
        case 'is':
          return rawValue === null || rawValue === undefined
            ? sql`${valueCol} IS NULL`
            : sql`${valueCol} = ${String(rawValue)}`
        case 'is not':
          return rawValue === null || rawValue === undefined
            ? sql`${valueCol} IS NOT NULL`
            : sql`${valueCol} != ${String(rawValue)}`
        case 'contains':
          return sql`${valueCol} = ${String(rawValue)}`
        case 'not contains':
          return sql`${valueCol} != ${String(rawValue)}`
        case 'in': {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          const conditions = values.map((v) => sql`${valueCol} = ${String(v)}`)
          return conditions.length === 1
            ? conditions[0]
            : sql`(${sql.join(conditions, sql` OR `)})`
        }
        case 'not in': {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          const conditions = values.map((v) => sql`${valueCol} != ${String(v)}`)
          return conditions.length === 1
            ? conditions[0]
            : sql`(${sql.join(conditions, sql` AND `)})`
        }
        case 'exists':
          return sql`true`
        case 'not empty':
          return sql`true`
        default:
          logger.warn(`Operator '${operator}' not supported for optionId fields`)
          return undefined
      }
    }

    // Handle relatedEntityId fields (RELATIONSHIP)
    if (columnName === 'relatedEntityId') {
      switch (operator) {
        case 'is':
          return rawValue === null || rawValue === undefined
            ? sql`${valueCol} IS NULL`
            : sql`${valueCol} = ${String(rawValue)}`
        case 'is not':
          return rawValue === null || rawValue === undefined
            ? sql`${valueCol} IS NOT NULL`
            : sql`${valueCol} != ${String(rawValue)}`
        case 'in': {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          const conditions = values.map((v) => sql`${valueCol} = ${String(v)}`)
          return conditions.length === 1
            ? conditions[0]
            : sql`(${sql.join(conditions, sql` OR `)})`
        }
        case 'not in': {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          const conditions = values.map((v) => sql`${valueCol} != ${String(v)}`)
          return conditions.length === 1
            ? conditions[0]
            : sql`(${sql.join(conditions, sql` AND `)})`
        }
        case 'exists':
          return sql`true`
        case 'not empty':
          return sql`true`
        default:
          logger.warn(`Operator '${operator}' not supported for relatedEntityId fields`)
          return undefined
      }
    }

    // Handle other typed fields
    switch (operator) {
      case 'is':
        return rawValue === null || rawValue === undefined
          ? sql`${valueCol} IS NULL`
          : sql`${valueCol} = ${String(rawValue)}`
      case 'is not':
        return rawValue === null || rawValue === undefined
          ? sql`${valueCol} IS NOT NULL`
          : sql`${valueCol} != ${String(rawValue)}`
      case 'contains':
        return sql`${valueCol}::text ILIKE ${'%' + String(rawValue ?? '') + '%'}`
      case 'not contains':
        return sql`${valueCol}::text NOT ILIKE ${'%' + String(rawValue ?? '') + '%'}`
      case 'starts with':
        return sql`${valueCol}::text ILIKE ${String(rawValue ?? '') + '%'}`
      case 'ends with':
        return sql`${valueCol}::text ILIKE ${'%' + String(rawValue ?? '')}`
      case '>':
        return sql`${sql.raw(`related."valueNumber"`)} > ${Number(rawValue)}`
      case '<':
        return sql`${sql.raw(`related."valueNumber"`)} < ${Number(rawValue)}`
      case '>=':
        return sql`${sql.raw(`related."valueNumber"`)} >= ${Number(rawValue)}`
      case '<=':
        return sql`${sql.raw(`related."valueNumber"`)} <= ${Number(rawValue)}`
      case 'before': {
        logger.debug(`Building 'before' date condition for related field with value: ${rawValue}`)
        const dateCol = sql.raw(`related."valueDate"`)
        return sql`${dateCol} < ${String(rawValue)}`
      }
      case 'after': {
        logger.debug(`Building 'after' date condition for related field with value: ${rawValue}`)
        const dateCol = sql.raw(`related."valueDate"`)
        return sql`${dateCol} > ${String(rawValue)}`
      }
      case 'on': {
        logger.debug(`Building 'on' date condition for related field with value: ${rawValue}`)
        const dateCol = sql.raw(`related."valueDate"`)
        return sql`${dateCol}::date = ${String(rawValue)}::date`
      }
      case 'not on': {
        logger.debug(`Building 'not on' date condition for related field with value: ${rawValue}`)
        const dateCol = sql.raw(`related."valueDate"`)
        return sql`${dateCol}::date != ${String(rawValue)}::date`
      }
      case 'in': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${valueCol} = ${String(v)}`)
        return conditions.length === 1
          ? conditions[0]
          : sql`(${sql.join(conditions, sql` OR `)})`
      }
      case 'not in': {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        if (!values.length) return undefined
        const conditions = values.map((v) => sql`${valueCol} != ${String(v)}`)
        return conditions.length === 1
          ? conditions[0]
          : sql`(${sql.join(conditions, sql` AND `)})`
      }
      case 'exists':
        return sql`true`
      case 'empty':
        return sql`(${valueCol} IS NULL OR ${valueCol}::text = '')`
      case 'not empty':
        return sql`(${valueCol} IS NOT NULL AND ${valueCol}::text != '')`
      default:
        logger.warn(`Unknown operator '${operator}' for related field value condition`)
        return rawValue === null || rawValue === undefined
          ? undefined
          : sql`${valueCol} = ${String(rawValue)}`
    }
  }

  /**
   * Get fields for a related entity definition.
   * Must be provided via context.relatedEntityFields
   */
  private getRelatedEntityFields(
    relatedEntityDefId: string,
    context: EntityQueryContext
  ): ResourceField[] | undefined {
    return context.relatedEntityFields?.[relatedEntityDefId]
  }

  /**
   * Convert BaseType to database field type
   */
  private fieldTypeToDbType(baseType: BaseType): string {
    switch (baseType) {
      case BaseType.STRING:
      case BaseType.EMAIL:
      case BaseType.PHONE:
      case BaseType.URL:
        return 'TEXT'
      case BaseType.NUMBER:
      case BaseType.CURRENCY:
        return 'NUMBER'
      case BaseType.BOOLEAN:
        return 'BOOLEAN'
      case BaseType.DATE:
      case BaseType.DATETIME:
        return 'DATE'
      case BaseType.ENUM:
        return 'TEXT'
      case BaseType.RELATION:
        return 'RELATIONSHIP'
      default:
        return 'TEXT'
    }
  }

  /**
   * Get the FieldValue column name for a database field type.
   *
   * IMPORTANT: For MULTI_SELECT and TAGS, each selected option is stored
   * as a SEPARATE FieldValue row with optionId. The EXISTS subquery will
   * match ANY row that satisfies the condition.
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
        return 'optionId' // MULTI_SELECT, TAGS (multi-row storage)
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
    operator: Operator,
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
   *
   * IMPORTANT: For MULTI_SELECT and TAGS, each selected option is stored
   * as a SEPARATE FieldValue row with optionId. The EXISTS subquery will
   * match ANY row that satisfies the condition.
   */
  private buildTypedValueCondition(
    operator: Operator,
    rawValue: unknown,
    dbFieldType: string
  ): SQL<unknown> | undefined {
    const columnName = this.getTypedColumnName(dbFieldType)
    const valueCol = sql.raw(`"FieldValue"."${columnName}"`)

    // ========================================
    // MULTI-VALUE OPTION FIELDS (MULTI_SELECT, TAGS)
    // These store each option as a separate row with optionId
    // ========================================
    if (columnName === 'optionId') {
      switch (operator) {
        case 'is': {
          // Check if ANY row has this optionId (for single selection)
          if (rawValue === null || rawValue === undefined) {
            return sql`${valueCol} IS NULL`
          }
          return sql`${valueCol} = ${String(rawValue)}`
        }

        case 'is not': {
          // Check if NO row has this optionId
          if (rawValue === null || rawValue === undefined) {
            return sql`${valueCol} IS NOT NULL`
          }
          return sql`${valueCol} != ${String(rawValue)}`
        }

        case 'contains': {
          // Check if ANY row has this optionId (for multi-selection)
          return sql`${valueCol} = ${String(rawValue)}`
        }

        case 'not contains': {
          // Check if NO row has this optionId
          return sql`${valueCol} != ${String(rawValue)}`
        }

        case 'in': {
          // Check if ANY row has optionId in the list
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          const conditions = values.map((v) => sql`${valueCol} = ${String(v)}`)
          return conditions.length === 1
            ? conditions[0]
            : sql`(${sql.join(conditions, sql` OR `)})`
        }

        case 'not in': {
          // Check if NO row has optionId in the list
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          if (!values.length) return undefined
          const conditions = values.map((v) => sql`${valueCol} != ${String(v)}`)
          return conditions.length === 1
            ? conditions[0]
            : sql`(${sql.join(conditions, sql` AND `)})`
        }

        case 'empty': {
          // Empty handled at outer EXISTS level (no rows for this field)
          return sql`false`
        }

        case 'not empty': {
          // At least one tag selected (handled by EXISTS)
          return sql`true`
        }

        case 'exists': {
          // Field has at least one value
          return sql`true`
        }

        default: {
          logger.warn(`Operator '${operator}' not supported for optionId fields`)
          return undefined
        }
      }
    }

    // ===== EXISTING CODE FOR OTHER FIELD TYPES =====
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

      // ===== DATE OPERATORS =====
      case 'before': {
        logger.debug(`Building 'before' date condition with value: ${rawValue}`)
        const dateCol = sql.raw(`"FieldValue"."valueDate"`)
        return sql`${dateCol} < ${String(rawValue)}`
      }

      case 'after': {
        logger.debug(`Building 'after' date condition with value: ${rawValue}`)
        const dateCol = sql.raw(`"FieldValue"."valueDate"`)
        return sql`${dateCol} > ${String(rawValue)}`
      }

      case 'on': {
        logger.debug(`Building 'on' date condition with value: ${rawValue}`)
        const dateCol = sql.raw(`"FieldValue"."valueDate"`)
        return sql`${dateCol}::date = ${String(rawValue)}::date`
      }

      case 'not on': {
        logger.debug(`Building 'not on' date condition with value: ${rawValue}`)
        const dateCol = sql.raw(`"FieldValue"."valueDate"`)
        return sql`${dateCol}::date != ${String(rawValue)}::date`
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
