// packages/lib/src/field-values/field-value-service.ts

import { database, schema, type Database } from '@auxx/database'
import { and, eq, inArray, asc } from 'drizzle-orm'
import { generateKeyBetween } from '../utils/fractional-indexing'
import {
  type TypedFieldValue,
  type TypedFieldValueInput,
  type SelectOption,
  getValueType,
  isMultiValueFieldType,
} from '@auxx/types'
import {
  getFieldWithDefinition,
  getExistingFieldValue,
  insertFieldValue,
  batchInsertFieldValues,
  updateFieldValue,
  deleteFieldValues,
  updateEntityDisplayName,
  type FieldWithDefinition,
  type FieldValueRow as ServiceFieldValueRow,
} from '@auxx/services'
import { convertToTypedInput, getDisplayValue } from './value-converter'
import type {
  SetValueInput,
  SetValueWithTypeInput,
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
 *
 * Key improvements:
 * - Caches CustomField lookups within service instance
 * - Uses UPDATE for single-value fields instead of DELETE+INSERT
 * - Automatically updates EntityInstance.displayName when primary display field changes
 */
export class FieldValueService {
  private db: Database

  /** Cache for CustomField lookups (keyed by fieldId) */
  private fieldCache: Map<string, FieldWithDefinition> = new Map()

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
   * Set field value with smart strategy based on field type.
   * - Fetches CustomField to determine type (with caching)
   * - Single-value fields: UPDATE if exists, INSERT if not
   * - Multi-value fields: DELETE all + INSERT all
   * - Updates displayName if field is primaryDisplayFieldId
   *
   * @param params - Entity ID, field ID, and raw value (any type)
   * @returns Array of TypedFieldValue after operation
   */
  async setValue(params: SetValueInput): Promise<TypedFieldValue[]> {
    const { entityId, fieldId, value } = params

    // 1. Get field definition (cached)
    const field = await this.getField(fieldId)

    // 2. Convert raw value to typed input using field type
    const typedInput = convertToTypedInput(
      value,
      field.type,
      field.options as SelectOption[] | undefined
    )

    // Handle null/delete case
    if (typedInput === null) {
      await this.deleteValue({ entityId, fieldId })
      await this.maybeUpdateDisplayName(entityId, field, null)
      return []
    }

    // 3. Determine strategy and execute
    let result: TypedFieldValue[]

    if (isMultiValueFieldType(field.type)) {
      // Multi-value: DELETE all + INSERT all
      result = await this.setMultiValue(entityId, fieldId, field.type, typedInput)
    } else {
      // Single-value: UPSERT (UPDATE or INSERT)
      result = await this.setSingleValue(entityId, fieldId, field.type, typedInput)
    }

    // 4. Update displayName if this is the primary display field
    await this.maybeUpdateDisplayName(entityId, field, typedInput)

    return result
  }

  /**
   * Set field value when caller already has field type info.
   * Still fetches field definition (cached) to update displayName if needed.
   */
  async setValueWithType(params: SetValueWithTypeInput): Promise<TypedFieldValue[]> {
    const { entityId, fieldId, fieldType, value } = params

    // Get field definition for displayName update (cached)
    const field = await this.getField(fieldId)

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
      await this.maybeUpdateDisplayName(entityId, field, null)
      return []
    }

    // Handle array of values (multi-value fields)
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) {
      await this.maybeUpdateDisplayName(entityId, field, null)
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

    const result = inserted.map((row) => this.rowToTypedValue(row as unknown as FieldValueRow, fieldType))

    // Update displayName if this is the primary display field
    await this.maybeUpdateDisplayName(entityId, field, value)

    return result
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
  // PRIVATE HELPERS - SMART VALUE SETTING
  // ─────────────────────────────────────────────────────────────

  /**
   * Get CustomField with EntityDefinition (cached within service instance).
   */
  private async getField(fieldId: string): Promise<FieldWithDefinition> {
    const cached = this.fieldCache.get(fieldId)
    if (cached) return cached

    const result = await getFieldWithDefinition({
      fieldId,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    this.fieldCache.set(fieldId, result.value)
    return result.value
  }

  /**
   * Update EntityInstance.displayName if field is primaryDisplayFieldId.
   */
  private async maybeUpdateDisplayName(
    entityId: string,
    field: FieldWithDefinition,
    value: TypedFieldValueInput | TypedFieldValueInput[] | null
  ): Promise<void> {
    const entityDef = field.entityDefinition
    if (!entityDef || entityDef.primaryDisplayFieldId !== field.id) {
      return
    }

    // Convert TypedFieldValueInput to TypedFieldValue for getDisplayValue
    // (getDisplayValue expects full TypedFieldValue with base fields)
    let displayValue: TypedFieldValue | TypedFieldValue[] | null = null
    if (value) {
      const toTypedValue = (input: TypedFieldValueInput): TypedFieldValue => ({
        ...input,
        id: '',
        entityId,
        fieldId: field.id,
        sortKey: '',
        createdAt: '',
        updatedAt: '',
      } as TypedFieldValue)

      displayValue = Array.isArray(value)
        ? value.map(toTypedValue)
        : toTypedValue(value)
    }

    const displayName = getDisplayValue(displayValue, field.options as SelectOption[] | undefined)

    await updateEntityDisplayName({
      entityId,
      organizationId: this.organizationId,
      displayName: displayName || null,
    })
  }

  /**
   * Set single-value field using UPSERT strategy.
   * Checks if row exists, then UPDATE or INSERT.
   */
  private async setSingleValue(
    entityId: string,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput | TypedFieldValueInput[]
  ): Promise<TypedFieldValue[]> {
    const singleValue = Array.isArray(value) ? value[0] : value
    if (!singleValue) return []

    // Check if row exists
    const existingResult = await getExistingFieldValue({
      entityId,
      fieldId,
      organizationId: this.organizationId,
    })

    if (existingResult.isErr()) {
      throw new Error(existingResult.error.message)
    }

    const existing = existingResult.value

    if (existing) {
      // UPDATE existing row
      const updateData = this.buildUpdateData(fieldType, singleValue)
      const updatedResult = await updateFieldValue({
        id: existing.id,
        organizationId: this.organizationId,
        ...updateData,
      })

      if (updatedResult.isErr()) {
        throw new Error(updatedResult.error.message)
      }

      return [this.rowToTypedValue(updatedResult.value as unknown as FieldValueRow, fieldType)]
    } else {
      // INSERT new row
      const insertData = this.buildInsertData(fieldType, singleValue)
      const insertedResult = await insertFieldValue({
        entityId,
        fieldId,
        organizationId: this.organizationId,
        sortKey: generateKeyBetween(null, null),
        ...insertData,
      })

      if (insertedResult.isErr()) {
        throw new Error(insertedResult.error.message)
      }

      return [this.rowToTypedValue(insertedResult.value as unknown as FieldValueRow, fieldType)]
    }
  }

  /**
   * Set multi-value field using DELETE+INSERT strategy.
   */
  private async setMultiValue(
    entityId: string,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput | TypedFieldValueInput[]
  ): Promise<TypedFieldValue[]> {
    const values = Array.isArray(value) ? value : [value]

    // DELETE all existing
    const deleteResult = await deleteFieldValues({
      entityId,
      fieldId,
      organizationId: this.organizationId,
    })

    if (deleteResult.isErr()) {
      throw new Error(deleteResult.error.message)
    }

    if (values.length === 0) return []

    // Build insert rows with sortKeys
    const insertInputs = values.map((v, index) => ({
      entityId,
      fieldId,
      organizationId: this.organizationId,
      sortKey: generateKeyBetween(index === 0 ? null : `a${index - 1}`, null),
      ...this.buildInsertData(fieldType, v),
    }))

    const insertedResult = await batchInsertFieldValues(insertInputs)

    if (insertedResult.isErr()) {
      throw new Error(insertedResult.error.message)
    }

    return insertedResult.value.map((row) =>
      this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )
  }

  /**
   * Build insert data from typed value input (for service layer).
   */
  private buildInsertData(
    fieldType: string,
    value: TypedFieldValueInput
  ): {
    valueText?: string | null
    valueNumber?: number | null
    valueBoolean?: boolean | null
    valueDate?: string | null
    valueJson?: unknown | null
    optionId?: string | null
    relatedEntityId?: string | null
  } {
    switch (value.type) {
      case 'text':
        return { valueText: value.value }
      case 'number':
        return { valueNumber: value.value }
      case 'boolean':
        return { valueBoolean: value.value }
      case 'date':
        return {
          valueDate: value.value instanceof Date ? value.value.toISOString() : value.value,
        }
      case 'json':
        return { valueJson: value.value }
      case 'option':
        return { optionId: value.optionId }
      case 'relationship':
        return { relatedEntityId: value.relatedEntityId }
    }
  }

  /**
   * Build update data from typed value input (for service layer).
   */
  private buildUpdateData(
    fieldType: string,
    value: TypedFieldValueInput
  ): {
    valueText?: string | null
    valueNumber?: number | null
    valueBoolean?: boolean | null
    valueDate?: string | null
    valueJson?: unknown | null
    optionId?: string | null
    relatedEntityId?: string | null
  } {
    // Same structure as insert data
    return this.buildInsertData(fieldType, value)
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS - ROW BUILDING
  // ─────────────────────────────────────────────────────────────

  /**
   * Build a FieldValue insert row from typed input (for direct DB insert).
   * Note: id, createdAt, updatedAt are auto-generated by the database.
   */
  private buildInsertRow(
    entityId: string,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput,
    sortKey: string
  ) {
    const base = {
      organizationId: this.organizationId,
      entityId,
      fieldId,
      sortKey,
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
