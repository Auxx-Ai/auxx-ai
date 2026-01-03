// packages/lib/src/field-values/field-value-service.ts

import { database, schema, type Database } from '@auxx/database'
import { and, eq, inArray, asc } from 'drizzle-orm'
import { generateKeyBetween } from '../utils/fractional-indexing'
import { generateId } from '../utils/generateId'
import {
  type TypedFieldValue,
  type TypedFieldValueInput,
  getValueType,
  isMultiValueFieldType,
} from '@auxx/types'
import type {
  SetValueInput,
  AddValueInput,
  GetValueInput,
  GetValuesWithFieldsInput,
  GetValuesInput,
  BatchGetValuesInput,
  DeleteValueInput,
  FieldValueWithField,
  TypedFieldValueResult,
  BatchFieldValueResult,
  FieldValueRow,
} from './types'

/**
 * Service for managing typed field values in the FieldValue table.
 * Replaces the old CustomFieldValue JSONB storage with typed column storage.
 */
export class FieldValueService {
  private db: Database

  constructor(
    private readonly organizationId: string,
    private readonly userId?: string,
    db: Database = database
  ) {
    this.db = db
  }

  // ─────────────────────────────────────────────────────────────
  // WRITE OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Set field value (replaces existing for single-value, replaces all for multi-value).
   * This is the main method for setting values - handles both insert and update.
   */
  async setValue(params: SetValueInput): Promise<TypedFieldValue[]> {
    const { entityId, fieldId, fieldType, value } = params

    // Delete existing values for this entityId + fieldId
    await this.db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )

    // If value is null, we're done (deletion)
    if (value === null) {
      return []
    }

    // Handle array of values (multi-value fields)
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) {
      return []
    }

    // Generate sort keys for each value
    const insertRows = values.map((v, index) => {
      const sortKey = generateKeyBetween(index === 0 ? null : `a${index - 1}`, null)
      return this.buildInsertRow(entityId, fieldId, fieldType, v, sortKey)
    })

    // Insert all values
    const inserted = await this.db
      .insert(schema.FieldValue)
      .values(insertRows)
      .returning()

    return inserted.map((row) => this.rowToTypedValue(row as unknown as FieldValueRow, fieldType))
  }

  /**
   * Add value to multi-value field (MULTI_SELECT, TAGS, RELATIONSHIP).
   * Appends to existing values instead of replacing them.
   */
  async addValue(params: AddValueInput): Promise<TypedFieldValue> {
    const { entityId, fieldId, fieldType, value, position = 'end' } = params

    // Get existing values to determine sortKey position
    const existing = await this.db
      .select({ sortKey: schema.FieldValue.sortKey })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))

    // Calculate sort key based on position
    let sortKey: string
    if (existing.length === 0) {
      sortKey = generateKeyBetween(null, null)
    } else if (position === 'start') {
      sortKey = generateKeyBetween(null, existing[0]!.sortKey)
    } else if (position === 'end') {
      sortKey = generateKeyBetween(existing[existing.length - 1]!.sortKey, null)
    } else {
      // Insert after specific value
      const afterIndex = existing.findIndex((e) => e.sortKey === position.after)
      if (afterIndex === -1) {
        sortKey = generateKeyBetween(existing[existing.length - 1]!.sortKey, null)
      } else {
        const afterKey = existing[afterIndex]!.sortKey
        const beforeKey = existing[afterIndex + 1]?.sortKey ?? null
        sortKey = generateKeyBetween(afterKey, beforeKey)
      }
    }

    const insertRow = this.buildInsertRow(entityId, fieldId, fieldType, value, sortKey)

    const [inserted] = await this.db
      .insert(schema.FieldValue)
      .values(insertRow)
      .returning()

    return this.rowToTypedValue(inserted as unknown as FieldValueRow, fieldType)
  }

  /**
   * Remove single value by ID (for multi-value fields).
   */
  async removeValue(valueId: string): Promise<void> {
    await this.db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.id, valueId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )
  }

  /**
   * Delete all values for a field on an entity.
   */
  async deleteValue(params: DeleteValueInput): Promise<void> {
    await this.db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, params.entityId),
          eq(schema.FieldValue.fieldId, params.fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )
  }

  // ─────────────────────────────────────────────────────────────
  // READ OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get single value by entityId + fieldId.
   * Returns array for multi-value fields, single value for single-value fields.
   */
  async getValue(params: GetValueInput): Promise<TypedFieldValue | TypedFieldValue[] | null> {
    const rows = await this.db
      .select()
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.entityId, params.entityId),
          eq(schema.FieldValue.fieldId, params.fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))

    if (rows.length === 0) {
      return null
    }

    const fieldType = rows[0]!.CustomField.type
    const typedValues = rows.map((row) =>
      this.rowToTypedValue(row.FieldValue as unknown as FieldValueRow, fieldType)
    )

    // Return single value for single-value fields, array for multi-value
    if (isMultiValueFieldType(fieldType)) {
      return typedValues
    }
    return typedValues[0] ?? null
  }

  /**
   * Get all values for an entity with field metadata.
   */
  async getValuesWithFields(params: GetValuesWithFieldsInput): Promise<FieldValueWithField[]> {
    const rows = await this.db
      .select({
        id: schema.FieldValue.id,
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        valueText: schema.FieldValue.valueText,
        valueNumber: schema.FieldValue.valueNumber,
        valueBoolean: schema.FieldValue.valueBoolean,
        valueDate: schema.FieldValue.valueDate,
        valueJson: schema.FieldValue.valueJson,
        optionId: schema.FieldValue.optionId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
        sortKey: schema.FieldValue.sortKey,
        createdAt: schema.FieldValue.createdAt,
        updatedAt: schema.FieldValue.updatedAt,
        field: {
          id: schema.CustomField.id,
          name: schema.CustomField.name,
          type: schema.CustomField.type,
          modelType: schema.CustomField.modelType,
          position: schema.CustomField.position,
          required: schema.CustomField.required,
          description: schema.CustomField.description,
          defaultValue: schema.CustomField.defaultValue,
          options: schema.CustomField.options,
          icon: schema.CustomField.icon,
          isCustom: schema.CustomField.isCustom,
          active: schema.CustomField.active,
        },
      })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.entityId, params.entityId),
          eq(schema.FieldValue.organizationId, this.organizationId),
          eq(schema.CustomField.modelType, params.modelType)
        )
      )
      .orderBy(asc(schema.CustomField.position), asc(schema.FieldValue.sortKey))

    // Group multi-value fields
    const groupedByField = new Map<string, typeof rows>()
    for (const row of rows) {
      const existing = groupedByField.get(row.fieldId) ?? []
      existing.push(row)
      groupedByField.set(row.fieldId, existing)
    }

    const results: FieldValueWithField[] = []
    for (const [fieldId, fieldRows] of groupedByField) {
      const firstRow = fieldRows[0]!
      const fieldType = firstRow.field.type
      const typedValues = fieldRows.map((row) =>
        this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
      )

      results.push({
        id: firstRow.id,
        entityId: firstRow.entityId,
        fieldId,
        value: isMultiValueFieldType(fieldType) ? typedValues : typedValues[0]!,
        sortKey: firstRow.sortKey,
        createdAt: firstRow.createdAt,
        updatedAt: firstRow.updatedAt,
        field: firstRow.field,
      })
    }

    return results
  }

  /**
   * Get values for specific fields on an entity.
   */
  async getValues(params: GetValuesInput): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
    let query = this.db
      .select()
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.entityId, params.entityId),
          eq(schema.FieldValue.organizationId, this.organizationId),
          params.fieldIds ? inArray(schema.FieldValue.fieldId, params.fieldIds) : undefined
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))

    const rows = await query

    // Group by fieldId
    const result = new Map<string, TypedFieldValue | TypedFieldValue[]>()
    const groupedByField = new Map<string, typeof rows>()

    for (const row of rows) {
      const existing = groupedByField.get(row.FieldValue.fieldId) ?? []
      existing.push(row)
      groupedByField.set(row.FieldValue.fieldId, existing)
    }

    for (const [fieldId, fieldRows] of groupedByField) {
      const fieldType = fieldRows[0]!.CustomField.type
      const typedValues = fieldRows.map((row) =>
        this.rowToTypedValue(row.FieldValue as unknown as FieldValueRow, fieldType)
      )

      if (isMultiValueFieldType(fieldType)) {
        result.set(fieldId, typedValues)
      } else {
        result.set(fieldId, typedValues[0]!)
      }
    }

    return result
  }

  /**
   * Batch get values for multiple entities.
   * Returns null for missing values (field exists but no value set).
   */
  async batchGetValues(params: BatchGetValuesInput): Promise<BatchFieldValueResult> {
    const { resourceType, entityDefId, entityIds, fieldIds } = params

    if (entityIds.length === 0 || fieldIds.length === 0) {
      return { values: [] }
    }

    // Query field values with field metadata
    const rows = await this.db
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        valueText: schema.FieldValue.valueText,
        valueNumber: schema.FieldValue.valueNumber,
        valueBoolean: schema.FieldValue.valueBoolean,
        valueDate: schema.FieldValue.valueDate,
        valueJson: schema.FieldValue.valueJson,
        optionId: schema.FieldValue.optionId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
        sortKey: schema.FieldValue.sortKey,
        id: schema.FieldValue.id,
        createdAt: schema.FieldValue.createdAt,
        updatedAt: schema.FieldValue.updatedAt,
        fieldType: schema.CustomField.type,
      })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.organizationId, this.organizationId),
          eq(schema.CustomField.modelType, resourceType),
          resourceType === 'entity' && entityDefId
            ? eq(schema.CustomField.entityDefinitionId, entityDefId)
            : undefined,
          inArray(schema.FieldValue.entityId, entityIds),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))

    // Group by entityId + fieldId
    const valueMap = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = `${row.entityId}:${row.fieldId}`
      const existing = valueMap.get(key) ?? []
      existing.push(row)
      valueMap.set(key, existing)
    }

    // Build result with nulls for missing values
    const results: TypedFieldValueResult[] = []
    for (const entityId of entityIds) {
      for (const fieldId of fieldIds) {
        const key = `${entityId}:${fieldId}`
        const fieldRows = valueMap.get(key)

        if (!fieldRows || fieldRows.length === 0) {
          results.push({ resourceId: entityId, fieldId, value: null })
        } else {
          const fieldType = fieldRows[0]!.fieldType
          const typedValues = fieldRows.map((row) =>
            this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
          )

          if (isMultiValueFieldType(fieldType)) {
            results.push({ resourceId: entityId, fieldId, value: typedValues })
          } else {
            results.push({ resourceId: entityId, fieldId, value: typedValues[0]! })
          }
        }
      }
    }

    return { values: results }
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Build a FieldValue insert row from typed input.
   */
  private buildInsertRow(
    entityId: string,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput,
    sortKey: string
  ) {
    const now = new Date().toISOString()
    const base = {
      id: generateId(),
      organizationId: this.organizationId,
      entityId,
      fieldId,
      sortKey,
      createdAt: now,
      updatedAt: now,
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueDate: null as string | null,
      valueJson: null as unknown,
      optionId: null as string | null,
      relatedEntityId: null as string | null,
    }

    switch (value.type) {
      case 'text':
        return { ...base, valueText: value.value }
      case 'number':
        return { ...base, valueNumber: value.value }
      case 'boolean':
        return { ...base, valueBoolean: value.value }
      case 'date':
        return {
          ...base,
          valueDate: value.value instanceof Date ? value.value.toISOString() : value.value,
        }
      case 'json':
        return { ...base, valueJson: value.value }
      case 'option':
        return { ...base, optionId: value.optionId }
      case 'relationship':
        return { ...base, relatedEntityId: value.relatedEntityId }
    }
  }

  /**
   * Convert a FieldValue row to a TypedFieldValue.
   */
  private rowToTypedValue(row: FieldValueRow, fieldType: string): TypedFieldValue {
    const base = {
      id: row.id,
      entityId: row.entityId,
      fieldId: row.fieldId,
      sortKey: row.sortKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }

    const valueType = getValueType(fieldType)

    switch (valueType) {
      case 'text':
        return { ...base, type: 'text', value: row.valueText ?? '' }
      case 'number':
        return { ...base, type: 'number', value: row.valueNumber ?? 0 }
      case 'boolean':
        return { ...base, type: 'boolean', value: row.valueBoolean ?? false }
      case 'date':
        return { ...base, type: 'date', value: row.valueDate ?? '' }
      case 'json':
        return { ...base, type: 'json', value: (row.valueJson as Record<string, unknown>) ?? {} }
      case 'option':
        return { ...base, type: 'option', optionId: row.optionId ?? '' }
      case 'relationship':
        return { ...base, type: 'relationship', relatedEntityId: row.relatedEntityId ?? '' }
      default:
        return { ...base, type: 'text', value: row.valueText ?? '' }
    }
  }
}
