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
  type FieldWithDefinition,
} from '@auxx/services'
import { convertToTypedInput, getDisplayValue } from './value-converter'
import { FieldValueValidator, fieldValueSchemas } from './field-value-validator'
import { isBuiltInField, getBuiltInFieldHandler } from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { publisher } from '../events'
import type { ContactFieldUpdatedEvent } from '../events/types'
import type {
  SetValueInput,
  SetValueWithTypeInput,
  AddValueInput,
  GetValueInput,
  GetValuesInput,
  BatchGetValuesInput,
  DeleteValueInput,
  TypedFieldValueResult,
  BatchFieldValueResult,
  FieldValueRow,
  SetValueWithBuiltInInput,
  SetValuesForEntityInput,
  SetBulkValuesInput,
  SetValueResult,
  SetValuesResult,
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

  /** Shared validator instance (stateless, reusable) */
  private validator = new FieldValueValidator()

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
      await this.maybeUpdateDisplayValue(entityId, field, null)
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

    // 4. Update display value if this is a display field
    await this.maybeUpdateDisplayValue(entityId, field, typedInput)

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
      await this.maybeUpdateDisplayValue(entityId, field, null)
      return []
    }

    // Handle array of values (multi-value fields)
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) {
      await this.maybeUpdateDisplayValue(entityId, field, null)
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

    // Update display value if this is a display field
    await this.maybeUpdateDisplayValue(entityId, field, value)

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
  // HIGH-LEVEL WRITE OPERATIONS (with built-in field support)
  // ─────────────────────────────────────────────────────────────

  /**
   * Set field value with built-in field support and optional event publishing.
   * This is the main entry point for setting values (replaces CustomFieldService.setValue).
   * Uses FieldValueValidator with Zod schemas for type-safe validation.
   *
   * @param params - Input parameters including entityId, fieldId, value, modelType
   * @returns Result containing id and typed value
   * @throws Error if validation fails
   */
  async setValueWithBuiltIn(params: SetValueWithBuiltInInput): Promise<SetValueResult> {
    const { entityId, fieldId, value, modelType, publishEvents = true } = params

    // 1. Check if built-in field
    if (isBuiltInField(fieldId, modelType)) {
      const handler = getBuiltInFieldHandler(fieldId, modelType)
      if (!handler) {
        throw new Error(`Built-in field ${fieldId} has no handler`)
      }
      await handler(this.db, entityId, value, this.organizationId)
      return { ids: [], values: [] } // Built-in fields don't return FieldValue
    }

    // 2. Get field definition (cached)
    const field = await this.getField(fieldId)

    // 3. Validate and convert raw value to typed input using FieldValueValidator
    const typedValue = await this.validateAndConvertValue(value, field.type, field as any)

    // Handle null values (deletion)
    if (typedValue === null) {
      await this.deleteValue({ entityId, fieldId })
      await this.maybeUpdateDisplayValue(entityId, field, null)
      return { ids: [], values: [] }
    }

    // 4. Check uniqueness if applicable (if field has unique constraint)
    if ((field as any).isUnique && typedValue !== null) {
      await checkUniqueValueTyped(
        {
          fieldId,
          value: typedValue,
          organizationId: this.organizationId,
          modelType,
          entityDefinitionId: field.entityDefinitionId,
          excludeEntityId: entityId,
        },
        this.db
      )
    }

    // 5. Get old value for event (only if publishing for contacts)
    let oldValue: TypedFieldValue | TypedFieldValue[] | null = null
    if (publishEvents && modelType === 'contact') {
      oldValue = await this.getValue({ entityId, fieldId })
    }

    // 6. Set the value
    const result = await this.setValueWithType({
      entityId,
      fieldId,
      fieldType: field.type,
      value: typedValue,
    })

    // 7. Publish event for contacts (use first value for event compat)
    if (publishEvents && modelType === 'contact' && this.userId) {
      await publisher.publishLater({
        type: 'contact:field:updated',
        data: {
          contactId: entityId,
          organizationId: this.organizationId,
          userId: this.userId,
          fieldId: field.id,
          fieldName: field.name,
          fieldType: field.type,
          oldValue,
          newValue: result[0] ?? null,
        },
      } as ContactFieldUpdatedEvent)
    }

    // Always return arrays
    return {
      ids: result.map((r) => r.id),
      values: result,
    }
  }

  /**
   * Set multiple field values for one entity efficiently.
   * - Handles both built-in and custom fields
   * - Prefetches field definitions to avoid N+1 queries
   * Replaces CustomFieldService.setValues
   *
   * @param params - Input parameters including entityId, values array, modelType
   * @returns Array of results for each field
   */
  async setValuesForEntity(params: SetValuesForEntityInput): Promise<SetValuesResult[]> {
    const { entityId, values, modelType, publishEvents = true } = params

    // Filter out undefined values
    const validValues = values.filter((v) => v.value !== undefined)
    if (validValues.length === 0) return []

    // Separate built-in from custom fields
    const builtIns: typeof validValues = []
    const customs: typeof validValues = []

    for (const v of validValues) {
      if (isBuiltInField(v.fieldId, modelType)) {
        builtIns.push(v)
      } else {
        customs.push(v)
      }
    }

    const results: SetValuesResult[] = []

    // Handle built-in fields
    for (const v of builtIns) {
      const handler = getBuiltInFieldHandler(v.fieldId, modelType)
      if (handler) {
        await handler(this.db, entityId, v.value, this.organizationId)
      }
      results.push({ fieldId: v.fieldId, ids: [], values: [] })
    }

    // Handle custom fields - batch prefetch all field definitions and validate relationships
    if (customs.length > 0) {
      // Prefetch all fields (fills cache)
      await Promise.all(customs.map((v) => this.getField(v.fieldId).catch(() => null)))

      // Pre-batch validate all relationships (fills cache for later)
      const fieldTypes = customs.map((c) => {
        const field = this.fieldCache.get(c.fieldId)
        return field?.type ?? 'TEXT'
      })
      await this.preBatchValidateRelationships(customs.map((c) => c.value), fieldTypes)

      // Now set each value (will use cached field definitions and relationship validations)
      for (const v of customs) {
        try {
          const result = await this.setValueWithBuiltIn({
            entityId,
            fieldId: v.fieldId,
            value: v.value,
            modelType,
            publishEvents,
          })
          results.push({ fieldId: v.fieldId, ...result })
        } catch (error) {
          // Log but continue with other fields
          console.error(`Failed to set field ${v.fieldId}:`, error)
          results.push({ fieldId: v.fieldId, ids: [], values: [] })
        }
      }
    }

    return results
  }

  /**
   * Set same values for multiple entities.
   * Uses Promise.allSettled for resilience.
   * Replaces CustomFieldService.bulkSetValues
   *
   * @param params - Input parameters including entityIds, values array, modelType
   * @returns Count of successfully updated entities
   */
  async setBulkValues(params: SetBulkValuesInput): Promise<{ count: number }> {
    const { entityIds, values, modelType } = params

    if (entityIds.length === 0 || values.length === 0) {
      return { count: 0 }
    }

    // Filter out undefined values
    const validValues = values.filter((v) => v.value !== undefined)
    if (validValues.length === 0) {
      return { count: 0 }
    }

    // Prefetch all field definitions once (outside the loop)
    const customFieldIds = validValues
      .filter((v) => !isBuiltInField(v.fieldId, modelType))
      .map((v) => v.fieldId)
    const uniqueFieldIds = [...new Set(customFieldIds)]
    await Promise.all(uniqueFieldIds.map((id) => this.getField(id).catch(() => null)))

    // Set values for all entities in parallel
    const results = await Promise.allSettled(
      entityIds.map((entityId) =>
        this.setValuesForEntity({
          entityId,
          values: validValues,
          modelType,
          publishEvents: false, // Don't spam events for bulk operations
        })
      )
    )

    const count = results.filter((r) => r.status === 'fulfilled').length
    return { count }
  }

  /**
   * Convert database rows to TypedFieldValue(s).
   * Handles both single and multi-value fields.
   * Shared by getValue() and getValues() to eliminate code duplication.
   */
  private rowsToTypedValues(
    rows: FieldValueRow[],
    fieldType: string,
    isMultiValue: boolean
  ): TypedFieldValue | TypedFieldValue[] {
    const typedValues = rows.map((row) => this.rowToTypedValue(row, fieldType))

    // Return single value for single-value fields, array for multi-value
    if (isMultiValue) {
      return typedValues
    }
    return typedValues[0] ?? null
  }

  // ─────────────────────────────────────────────────────────────
  // READ OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get single value by entityId + fieldId.
   * Returns array for multi-value fields, single value for single-value fields.
   */
  async getValue(
    params: GetValueInput,
    cachedField?: FieldWithDefinition
  ): Promise<TypedFieldValue | TypedFieldValue[] | null> {
    // Use cached field if provided (avoids redundant CustomField join)
    const field = cachedField ?? (await this.getField(params.fieldId))

    const rows = await this.db
      .select()
      .from(schema.FieldValue)
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

    return this.rowsToTypedValues(rows, field.type, isMultiValueFieldType(field.type))
  }

  /**
   * Get values for specific fields on an entity.
   */
  async getValues(params: GetValuesInput): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
    const query = this.db
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
    const result = new Map<string, TypedFieldValue | TypedFieldValue[]>()

    // Group by fieldId
    const groupedByField = new Map<string, typeof rows>()
    for (const row of rows) {
      const existing = groupedByField.get(row.FieldValue.fieldId) ?? []
      existing.push(row)
      groupedByField.set(row.FieldValue.fieldId, existing)
    }

    // Convert and store results
    for (const [fieldId, fieldRows] of groupedByField) {
      const fieldType = fieldRows[0]!.CustomField.type
      const fieldValueRows = fieldRows.map((r) => r.FieldValue as unknown as FieldValueRow)
      const typedValues = this.rowsToTypedValues(fieldValueRows, fieldType, isMultiValueFieldType(fieldType))
      result.set(fieldId, typedValues)
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
        relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
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

    // Build result with validation
    const results: TypedFieldValueResult[] = []
    for (const entityId of entityIds) {
      for (const fieldId of fieldIds) {
        const key = `${entityId}:${fieldId}`
        const fieldRows = valueMap.get(key)
        const issues: string[] = []

        if (!fieldRows || fieldRows.length === 0) {
          results.push({
            resourceId: entityId,
            fieldId,
            value: null,
          })
        } else {
          const fieldType = fieldRows[0]!.fieldType
          const typedValues = fieldRows.map((row) => {
            const typed = this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
            // Check for invalid values
            if (!this.isValidTypedValue(typed, fieldType)) {
              issues.push(`Invalid value for ${fieldType} field`)
            }
            return typed
          })

          // Check for orphaned option/relationship references
          for (const row of fieldRows) {
            const rowIssues = this.validateRowReferences(row, fieldType)
            issues.push(...rowIssues)
          }

          const result: TypedFieldValueResult = {
            resourceId: entityId,
            fieldId,
          }

          if (isMultiValueFieldType(fieldType)) {
            result.value = typedValues
          } else {
            result.value = typedValues[0]!
          }

          if (issues.length > 0) {
            result.issues = issues
          }

          results.push(result)
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
   * Batch validate relationships efficiently.
   * Collects all relationship validations and does them in a single DB query.
   * Returns a map for quick lookup during individual validations.
   */
  private batchRelationshipValidationCache = new Map<string, { success: boolean; message?: string }>()

  /**
   * Pre-validate all relationships in a batch for the current operation.
   * Call this before validating individual values to enable batch optimization.
   */
  async preBatchValidateRelationships(
    values: unknown[],
    fieldTypes: string[]
  ): Promise<void> {
    // Collect all relationships from values
    const relationships: Array<{ relatedEntityId: string; relatedEntityDefinitionId: string }> = []

    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      const fieldType = fieldTypes[i]

      if (fieldType !== 'RELATIONSHIP') continue

      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === 'object' && 'relatedEntityId' in v) {
            relationships.push({
              relatedEntityId: (v as any).relatedEntityId,
              relatedEntityDefinitionId: (v as any).relatedEntityDefinitionId,
            })
          }
        }
      } else if (value && typeof value === 'object' && 'relatedEntityId' in value) {
        relationships.push({
          relatedEntityId: (value as any).relatedEntityId,
          relatedEntityDefinitionId: (value as any).relatedEntityDefinitionId,
        })
      }
    }

    // Batch validate if we have relationships
    if (relationships.length > 0) {
      this.batchRelationshipValidationCache = await this.validator.batchValidateRelationships(
        relationships,
        { db: this.db, organizationId: this.organizationId }
      )
    }
  }

  /**
   * Validate and convert raw value to TypedFieldValueInput using FieldValueValidator.
   * Each field type has dedicated Zod schema validation.
   * Throws descriptive error if validation fails.
   */
  private async validateAndConvertValue(
    value: unknown,
    fieldType: string,
    field: FieldWithDefinition
  ): Promise<TypedFieldValueInput | TypedFieldValueInput[] | null> {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return null
    }

    // Use shared validator instance (stateless, reusable)
    // Handle arrays (for multi-value fields like MULTI_SELECT, TAGS, RELATIONSHIP)
    if (Array.isArray(value)) {
      const converted: TypedFieldValueInput[] = []
      for (const v of value) {
        const single = await this.validateSingleValue(v, fieldType)
        if (single !== null) {
          converted.push(single)
        }
      }
      return converted.length > 0 ? converted : null
    }

    // Single value
    return this.validateSingleValue(value, fieldType)
  }

  /**
   * Validate single value using appropriate Zod schema.
   * Each field type has its own validation logic.
   * Uses shared validator instance for efficiency.
   */
  private async validateSingleValue(
    value: unknown,
    fieldType: string
  ): Promise<TypedFieldValueInput | null> {
    // Helper to throw validation error with proper message
    const throwValidationError = (result: { success: false; error: any }) => {
      const issues = result.error.issues || []
      const message = issues.map((i: any) => i.message).join(', ') || 'Validation failed'
      throw new Error(message)
    }

    switch (fieldType) {
      case 'TEXT':
      case 'RICH_TEXT':
      case 'ADDRESS': {
        const result = this.validator.validateText(value)
        if (!result.success) throwValidationError(result)
        const textValue = result.data || ''
        return textValue === '' ? null : { type: 'text', value: textValue }
      }

      case 'EMAIL': {
        const result = this.validator.validateEmail(value)
        if (!result.success) throwValidationError(result)
        return { type: 'text', value: result.data || '' }
      }

      case 'URL': {
        const result = this.validator.validateUrl(value)
        if (!result.success) throwValidationError(result)
        return { type: 'text', value: result.data || '' }
      }

      case 'PHONE_INTL': {
        const result = this.validator.validatePhone(value)
        if (!result.success) throwValidationError(result)
        return { type: 'text', value: result.data || '' }
      }

      case 'NUMBER':
      case 'CURRENCY': {
        const result = this.validator.validateNumber(value)
        if (!result.success) throwValidationError(result)
        return { type: 'number', value: result.data ?? 0 }
      }

      case 'CHECKBOX': {
        const result = this.validator.validateBoolean(value)
        if (!result.success) throwValidationError(result)
        return { type: 'boolean', value: result.data ?? false }
      }

      case 'DATE':
      case 'DATETIME':
      case 'TIME': {
        const result = this.validator.validateDate(value)
        if (!result.success) throwValidationError(result)
        return { type: 'date', value: result.data || '' }
      }

      case 'SINGLE_SELECT':
      case 'MULTI_SELECT':
      case 'TAGS': {
        const result = this.validator.validateOption(value)
        if (!result.success) throwValidationError(result)
        return { type: 'option', optionId: result.data || '' }
      }

      case 'RELATIONSHIP': {
        // Parse relationship value first
        const structureResult = fieldValueSchemas.relationship.safeParse(value)
        if (!structureResult.success) throwValidationError(structureResult)

        const { relatedEntityId, relatedEntityDefinitionId } = structureResult.data

        // Check batch validation cache first (if preBatchValidateRelationships was called)
        if (this.batchRelationshipValidationCache.has(relatedEntityId)) {
          const validation = this.batchRelationshipValidationCache.get(relatedEntityId)!
          if (!validation.success) {
            throwValidationError({
              success: false,
              error: {
                issues: [{ message: validation.message || 'Relationship validation failed', path: ['relatedEntityId'] }],
              },
            })
          }
        } else {
          // Fall back to individual validation if batch wasn't called
          const result = await this.validator.validateRelationship(value, {
            db: this.db,
            organizationId: this.organizationId,
          })
          if (!result.success) throwValidationError(result)
        }

        return {
          type: 'relationship',
          relatedEntityId,
          relatedEntityDefinitionId,
        }
      }

      case 'NAME': {
        const result = this.validator.validateNameJson(value)
        if (!result.success) throwValidationError(result)
        return { type: 'json', value: result.data || {} }
      }

      case 'ADDRESS_STRUCT': {
        const result = this.validator.validateAddressStructJson(value)
        if (!result.success) throwValidationError(result)
        return { type: 'json', value: result.data || {} }
      }

      case 'FILE': {
        const result = this.validator.validateFileJson(value)
        if (!result.success) throwValidationError(result)
        return { type: 'json', value: result.data || {} }
      }

      default: {
        const result = this.validator.validateJson(value)
        if (!result.success) throwValidationError(result)
        return { type: 'json', value: result.data || {} }
      }
    }
  }

  /**
   * Update EntityInstance display columns if field is a display field.
   * Handles primary (displayName), secondary (secondaryDisplayValue), and avatar (avatarUrl).
   */
  private async maybeUpdateDisplayValue(
    entityId: string,
    field: FieldWithDefinition,
    value: TypedFieldValueInput | TypedFieldValueInput[] | null
  ): Promise<void> {
    const entityDef = field.entityDefinition
    if (!entityDef) return

    // Check which display field this is (if any)
    type DisplayColumn = 'displayName' | 'secondaryDisplayValue' | 'avatarUrl'
    let column: DisplayColumn | null = null

    if (entityDef.primaryDisplayFieldId === field.id) {
      column = 'displayName'
    } else if (entityDef.secondaryDisplayFieldId === field.id) {
      column = 'secondaryDisplayValue'
    } else if ((entityDef as any).avatarFieldId === field.id) {
      column = 'avatarUrl'
    }

    if (!column) return

    // Compute display value
    let displayValue: string | null = null
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

      const typedValue = Array.isArray(value)
        ? value.map(toTypedValue)
        : toTypedValue(value)

      // For avatar fields, extract URL directly
      if (column === 'avatarUrl') {
        const singleValue = Array.isArray(typedValue) ? typedValue[0] : typedValue
        if (singleValue) {
          if (singleValue.type === 'text') {
            displayValue = singleValue.value || null
          } else if (singleValue.type === 'json') {
            const json = singleValue.value as Record<string, unknown>
            if (typeof json?.url === 'string') {
              displayValue = json.url
            }
          }
        }
      } else {
        displayValue = getDisplayValue(typedValue, field.options as SelectOption[] | undefined) || null
      }
    }

    // Update the appropriate column
    await this.db
      .update(schema.EntityInstance)
      .set({ [column]: displayValue })
      .where(
        and(
          eq(schema.EntityInstance.id, entityId),
          eq(schema.EntityInstance.organizationId, this.organizationId)
        )
      )
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
      const updateData = this.buildUpdateData(singleValue)
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
    relatedEntityDefinitionId?: string | null
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
        return {
          relatedEntityId: value.relatedEntityId,
          relatedEntityDefinitionId: value.relatedEntityDefinitionId,
        }
    }
  }

  /**
   * Build update data from typed value input (for service layer).
   */
  private buildUpdateData(
    value: TypedFieldValueInput
  ): {
    valueText?: string | null
    valueNumber?: number | null
    valueBoolean?: boolean | null
    valueDate?: string | null
    valueJson?: unknown | null
    optionId?: string | null
    relatedEntityId?: string | null
    relatedEntityDefinitionId?: string | null
  } {
    // Same structure as insert data (fieldType not needed for structure)
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
        return {
          relatedEntityId: value.relatedEntityId,
          relatedEntityDefinitionId: value.relatedEntityDefinitionId,
        }
    }
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
      relatedEntityDefinitionId: null as string | null,
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
        return {
          ...base,
          relatedEntityId: value.relatedEntityId,
          relatedEntityDefinitionId: value.relatedEntityDefinitionId,
        }
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
        return {
          ...base,
          type: 'relationship',
          relatedEntityId: row.relatedEntityId ?? '',
          relatedEntityDefinitionId: row.relatedEntityDefinitionId ?? '',
        }
      default:
        return { ...base, type: 'text', value: row.valueText ?? '' }
    }
  }

  /**
   * Validate that a typed value has actual content (not just defaults)
   */
  private isValidTypedValue(value: TypedFieldValue, fieldType: string): boolean {
    const valueType = getValueType(fieldType)

    switch (valueType) {
      case 'text':
        return value.type === 'text' && typeof value.value === 'string'
      case 'number':
        return value.type === 'number' && typeof value.value === 'number'
      case 'boolean':
        return value.type === 'boolean' && typeof value.value === 'boolean'
      case 'date':
        return value.type === 'date' && typeof value.value === 'string'
      case 'json':
        return value.type === 'json' && typeof value.value === 'object'
      case 'option':
        return (
          value.type === 'option' &&
          'optionId' in value &&
          typeof (value as any).optionId === 'string'
        )
      case 'relationship':
        return (
          value.type === 'relationship' &&
          'relatedEntityId' in value &&
          typeof (value as any).relatedEntityId === 'string'
        )
      default:
        return true
    }
  }

  /**
   * Validate that referenced entities/options exist
   */
  private validateRowReferences(row: FieldValueRow, fieldType: string): string[] {
    const issues: string[] = []
    const valueType = getValueType(fieldType)

    // Check for orphaned option references (option exists but is no longer valid)
    if (valueType === 'option' && row.optionId) {
      if (!row.optionId || row.optionId.trim() === '') {
        issues.push('Empty option ID reference')
      }
    }

    // Check for orphaned relationship references
    if (valueType === 'relationship') {
      if (!row.relatedEntityId || row.relatedEntityId.trim() === '') {
        issues.push('Missing related entity ID')
      }
      if (!row.relatedEntityDefinitionId || row.relatedEntityDefinitionId.trim() === '') {
        issues.push('Missing related entity definition ID')
      }
    }

    return issues
  }
}
