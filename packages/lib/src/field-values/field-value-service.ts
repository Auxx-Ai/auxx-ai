// packages/lib/src/field-values/field-value-service.ts

import { database, schema, type Database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { and, eq, inArray, asc } from 'drizzle-orm'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import {
  type TypedFieldValue,
  type TypedFieldValueInput,
  type SelectOption,
  getValueType,
  isMultiValueFieldType,
  isArrayReturnFieldType,
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
import { formatToTypedInput, formatToDisplayValue } from './formatter'
import {
  getExistingRelatedIds,
  batchGetExistingRelatedIds,
  syncInverseRelationships,
  syncInverseRelationshipsBulk,
  type InverseFieldInfo,
  type BulkRelationshipUpdate,
} from './relationship-sync'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { FieldValueValidator, fieldValueSchemas } from './field-value-validator'
import {
  isBuiltInField,
  getBuiltInFieldHandler,
  getBuiltInFieldType,
} from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'
import {
  parseResourceId,
  toResourceId,
  getInstanceId,
  getDefinitionId,
  getModelType,
} from '../resources/resource-id'
import type { ResourceId } from '@auxx/types/resource'
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
    db: Database = database,
    private registryService: ResourceRegistryService = new ResourceRegistryService(
      organizationId,
      db
    )
  ) {
    this.db = db
  }

  // ─────────────────────────────────────────────────────────────
  // WRITE OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Set a single field value with automatic type conversion and smart persistence strategy.
   *
   * This is a lower-level method that requires callers to handle field type detection.
   * For higher-level usage, prefer setValueWithBuiltIn() which handles built-in fields.
   *
   * **Behavior by field type:**
   * - Single-value fields (TEXT, EMAIL, etc): Uses UPDATE if row exists, INSERT if not
   * - Multi-value fields (MULTI_SELECT, TAGS, RELATIONSHIP): DELETEs all existing, then INSERTs all new
   * - Automatically updates EntityInstance.displayName if field is the primaryDisplayFieldId
   * - Null values trigger deletion (returns empty array)
   *
   * **Caching:** CustomField definitions are cached within the service instance to avoid redundant lookups.
   *
   * @param params - The SetValueInput object
   * @param params.resourceId - ResourceId of the entity (format: "entityDefinitionId:entityInstanceId")
   *                            Example: "contact:550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldId - UUID of the custom field
   *                         Example: "660e8400-e29b-41d4-a716-446655440000"
   * @param params.value - Raw value in any format. Service auto-converts based on field type.
   *                       - TEXT/EMAIL/URL: string or number (will be stringified)
   *                       - NUMBER/CURRENCY: number, string (will be parsed), or null
   *                       - CHECKBOX: boolean, "true"/"false", 1/0, or null
   *                       - DATE/DATETIME/TIME: Date object, ISO string, or unix timestamp
   *                       - SINGLE_SELECT: option ID string or null
   *                       - MULTI_SELECT/TAGS: array of option IDs or null
   *                       - RELATIONSHIP: { relatedEntityId: "id", relatedEntityDefinitionId: "def-id" } or array
   *                       - FILE: array of file objects or null
   *                       Example value: "hello@example.com" for EMAIL field
   *
   * @returns Array of TypedFieldValue objects after the operation.
   *          - Empty array [] if value was null/deleted
   *          - Single-element array for single-value fields
   *          - Multi-element array for multi-value fields
   *          Example: [{ id: "fv-1", type: "text", value: "hello@example.com", ... }]
   *
   * @throws Error if field not found, type conversion fails, or uniqueness constraint violated
   *
   * @example
   * // Set email for contact
   * const result = await fieldValueService.setValue({
   *   resourceId: "contact:contact-123",
   *   fieldId: "field-email",
   *   value: "customer@shop.com"
   * });
   *
   * @example
   * // Set multi-select tags
   * const result = await fieldValueService.setValue({
   *   resourceId: "ticket:ticket-456",
   *   fieldId: "field-tags",
   *   value: ["option-1", "option-2"]
   * });
   */
  async setValue(params: SetValueInput): Promise<TypedFieldValue[]> {
    const { resourceId, fieldId, value } = params

    // 1. Get field definition (cached)
    const field = await this.getField(fieldId)

    // 2. Convert raw value to typed input using formatter
    const typedInput = formatToTypedInput(value, field.type, {
      selectOptions: field.options as { id?: string; value: string; label: string }[] | undefined,
    })

    // Handle null/delete case
    if (typedInput === null) {
      await this.deleteValue({ resourceId, fieldId })
      await this.maybeUpdateDisplayValue(resourceId, field, null)
      return []
    }

    // 3. Determine strategy and execute
    let result: TypedFieldValue[]

    if (isMultiValueFieldType(field.type)) {
      // Multi-value: DELETE all + INSERT all
      result = await this.setMultiValue(resourceId, fieldId, field.type, typedInput)
    } else {
      // Single-value: UPSERT (UPDATE or INSERT)
      result = await this.setSingleValue(resourceId, fieldId, field.type, typedInput)
    }

    // 4. Update display value if this is a display field
    await this.maybeUpdateDisplayValue(resourceId, field, typedInput)

    return result
  }

  /**
   * Set field value when caller already has the field type information.
   *
   * This method skips the CustomField lookup (since you provide fieldType), making it more
   * efficient when called multiple times in a batch or when you already know the field type.
   * Still fetches field definition (with caching) to handle displayName updates.
   *
   * **Replaces all existing values** - Always DELETEs all rows for this resourceId+fieldId,
   * then INSERTs new ones. This is safe for both single and multi-value fields.
   *
   * @param params - The SetValueWithTypeInput object
   * @param params.resourceId - ResourceId of the entity (format: "entityDefinitionId:entityInstanceId")
   *                            Example: "contact:550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldId - UUID of the custom field
   *                         Example: "660e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldType - The field type (already determined by caller)
   *                           Examples: "TEXT", "EMAIL", "MULTI_SELECT", "RELATIONSHIP"
   *                           See @auxx/database FieldType enum for all values
   * @param params.value - TypedFieldValueInput or array of TypedFieldValueInput, or null
   *                       Must be properly typed according to fieldType:
   *                       - TEXT: { type: "text", value: "hello" }
   *                       - NUMBER: { type: "number", value: 42 }
   *                       - CHECKBOX: { type: "boolean", value: true }
   *                       - DATE: { type: "date", value: "2024-01-15T10:30:00Z" }
   *                       - SINGLE_SELECT: { type: "option", optionId: "opt-123" }
   *                       - MULTI_SELECT/TAGS: array of option inputs
   *                       - RELATIONSHIP: { type: "relationship", relatedEntityId: "rel-123", relatedEntityDefinitionId: "def-456" }
   *                       - FILE: { type: "json", value: { name: "doc.pdf", url: "..." } }
   *                       Example: { type: "text", value: "customer@example.com" }
   *
   * @returns Array of TypedFieldValue objects after the operation.
   *          - Empty array [] if value was null
   *          - Single-element array for single-value fields
   *          - Multi-element array for multi-value fields
   *          Each TypedFieldValue includes id, entityId, fieldId, type, value, and timestamps
   *
   * @throws Error if value doesn't match fieldType or database operation fails
   *
   * @example
   * // Set a text field with known type
   * const result = await fieldValueService.setValueWithType({
   *   resourceId: "contact:contact-123",
   *   fieldId: "field-name",
   *   fieldType: "TEXT",
   *   value: { type: "text", value: "John Doe" }
   * });
   *
   * @example
   * // Set a multi-value field
   * const result = await fieldValueService.setValueWithType({
   *   resourceId: "ticket:ticket-456",
   *   fieldId: "field-tags",
   *   fieldType: "TAGS",
   *   value: [
   *     { type: "option", optionId: "tag-1" },
   *     { type: "option", optionId: "tag-2" }
   *   ]
   * });
   */
  async setValueWithType(params: SetValueWithTypeInput): Promise<TypedFieldValue[]> {
    const { resourceId, fieldId, fieldType, value, skipInverseSync = false } = params

    // Parse ResourceId to get entityInstanceId for DB queries
    const { entityInstanceId } = parseResourceId(resourceId)

    // Get field definition for displayName update (cached)
    const field = await this.getField(fieldId)

    // ═══ For relationships: capture old values and get inverse info ═══
    let oldRelatedIds: string[] = []
    let inverseInfo: InverseFieldInfo | null = null

    if (fieldType === 'RELATIONSHIP' && !skipInverseSync) {
      inverseInfo = await this.getInverseInfoFromField(field)

      // Only capture old values if we have an inverse to sync
      if (inverseInfo) {
        oldRelatedIds = await getExistingRelatedIds(
          { db: this.db, organizationId: this.organizationId },
          entityInstanceId,
          fieldId
        )
      }
    }

    // Delete existing values for this entityInstanceId + fieldId
    await this.db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )

    // If value is null, we're done (deletion)
    if (value === null) {
      await this.maybeUpdateDisplayValue(resourceId, field, null)

      // Sync inverse if we had old relationships
      if (inverseInfo && oldRelatedIds.length > 0) {
        await syncInverseRelationships(
          { db: this.db, organizationId: this.organizationId },
          { entityId: entityInstanceId, oldRelatedIds, newRelatedIds: [], inverseInfo }
        )
      }

      return []
    }

    // Handle array of values (multi-value fields)
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) {
      await this.maybeUpdateDisplayValue(resourceId, field, null)

      // Sync inverse if we had old relationships
      if (inverseInfo && oldRelatedIds.length > 0) {
        await syncInverseRelationships(
          { db: this.db, organizationId: this.organizationId },
          { entityId: entityInstanceId, oldRelatedIds, newRelatedIds: [], inverseInfo }
        )
      }

      return []
    }

    // Generate sort keys for each value - pass resourceId to buildInsertRow
    const insertRows = values.map((v, index) => {
      const sortKey = generateKeyBetween(index === 0 ? null : `a${index - 1}`, null)
      return this.buildInsertRow(resourceId, fieldId, fieldType, v, sortKey)
    })

    // Insert all values
    const inserted = await this.db.insert(schema.FieldValue).values(insertRows).returning()

    const result = inserted.map((row) =>
      this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )

    // Update display value if this is a display field
    await this.maybeUpdateDisplayValue(resourceId, field, value)

    // ═══ Sync inverse relationships ═══
    if (inverseInfo) {
      const newRelatedIds = values
        .filter(
          (
            v
          ): v is {
            type: 'relationship'
            relatedEntityId: string
            relatedEntityDefinitionId: string
          } => v.type === 'relationship' && !!v.relatedEntityId
        )
        .map((v) => v.relatedEntityId)

      await syncInverseRelationships(
        { db: this.db, organizationId: this.organizationId },
        { entityId: entityInstanceId, oldRelatedIds, newRelatedIds, inverseInfo }
      )
    }

    return result
  }

  /**
   * Add a single value to a multi-value field without removing existing values.
   * APPEND operation - calculates correct sort order based on existing values.
   *
   * @param params.resourceId - ResourceId of the entity (e.g. "contact:abc123")
   * @param params.fieldId - UUID of the multi-value field
   * @param params.fieldType - Field type (MULTI_SELECT, TAGS, RELATIONSHIP, FILE)
   * @param params.value - Single TypedFieldValueInput to add
   * @param params.position - Where to insert: 'start', 'end', or { after: sortKey }
   * @returns Single TypedFieldValue for the newly added value
   *
   * @example
   * await service.addValue({
   *   resourceId: "ticket:abc123",
   *   fieldId: "field-tags",
   *   fieldType: "TAGS",
   *   value: { type: "option", optionId: "tag-urgent" },
   *   position: "end"
   * })
   *
   * @example
   * await service.addValue({
   *   resourceId: "order:xyz456",
   *   fieldId: "field-related-items",
   *   fieldType: "RELATIONSHIP",
   *   value: { type: "relationship", relatedEntityId: "item-789", relatedEntityDefinitionId: "entity-def-1" },
   *   position: "start"
   * })
   */
  async addValue(params: AddValueInput): Promise<TypedFieldValue> {
    const { resourceId, fieldId, fieldType, value, position = 'end' } = params

    // Parse ResourceId to get entityInstanceId for DB queries
    const { entityInstanceId } = parseResourceId(resourceId)

    // Get existing values to determine sortKey position
    const existing = await this.db
      .select({ sortKey: schema.FieldValue.sortKey })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
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

    const insertRow = this.buildInsertRow(resourceId, fieldId, fieldType, value, sortKey)

    const [inserted] = await this.db.insert(schema.FieldValue).values(insertRow).returning()

    return this.rowToTypedValue(inserted as unknown as FieldValueRow, fieldType)
  }

  /**
   * Remove a single value from a multi-value field by its FieldValue ID.
   *
   * Use this to remove one option/tag/relationship from a MULTI_SELECT, TAGS, or FILE field.
   * For single-value fields, use deleteValue() instead.
   *
   * **Note:** This only works with values that have an ID (already persisted).
   * Does NOT update related entity display values.
   *
   * @param valueId - The FieldValue record ID (UUID)
   *                  Example: "fv-123-abc-def"
   *                  This is returned from getValue/addValue/setValue results
   *
   * @throws Error if deletion fails or value doesn't belong to this organization
   *
   * @example
   * // Remove one tag from a ticket
   * const tagToRemove = tags[0];  // from getValue result
   * await fieldValueService.removeValue(tagToRemove.id);
   * // The tag is now removed from the ticket's tags field
   *
   * @example
   * // Remove a relationship
   * const relatedItem = relationships[0];
   * await fieldValueService.removeValue(relatedItem.id);
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
   *
   * Removes all FieldValue records for the given entity+field combination.
   * Use this to clear a field (set it to empty/null).
   *
   * **For single-value fields:** Deletes the one row (field is now null)
   * **For multi-value fields:** Deletes all rows (field is now empty array)
   *
   * **Note:** Does NOT update entity display values (caller may need to do that)
   *
   * @param params.resourceId - ResourceId of the entity (e.g. "contact:abc123")
   * @param params.fieldId - UUID of the field to clear
   *
   * @example
   * await service.deleteValue({ resourceId: "contact:abc123", fieldId: "field-email" })
   */
  async deleteValue(params: DeleteValueInput): Promise<void> {
    const { entityInstanceId } = parseResourceId(params.resourceId)

    await this.db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.fieldId, params.fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )
  }

  // ─────────────────────────────────────────────────────────────
  // HIGH-LEVEL WRITE OPERATIONS (with built-in field support)
  // ─────────────────────────────────────────────────────────────

  /**
   * Set a field value with built-in field support and optional event publishing.
   * Primary entry point for setting field values - handles both built-in and custom fields.
   *
   * Features: built-in field detection, type validation, uniqueness checking,
   * automatic displayName updates, event publishing for contacts, field caching.
   *
   * @param params.resourceId - ResourceId of the entity (e.g. "contact:abc123")
   * @param params.fieldId - Field UUID or built-in field ID (e.g. "firstName", "createdAt")
   * @param params.value - Raw value to set (auto-converted and validated)
   * @param params.publishEvents - Publish contact:field:updated events (default: true)
   * @param params.skipInverseSync - Skip inverse relationship sync (for bulk ops)
   * @returns SetValueResult with state, performedAt, and values array
   *
   * @example
   * await service.setValueWithBuiltIn({
   *   resourceId: "contact:abc123",
   *   fieldId: "field-email-uuid",
   *   value: "john@example.com",
   *   publishEvents: true
   * })
   *
   * @example
   * await service.setValueWithBuiltIn({
   *   resourceId: "contact:xyz456",
   *   fieldId: "firstName",
   *   value: "John"
   * })
   */
  async setValueWithBuiltIn(params: SetValueWithBuiltInInput): Promise<SetValueResult> {
    const { resourceId, fieldId, value, publishEvents = true, skipInverseSync = false } = params

    // Parse ResourceId to get both parts
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

    // Derive modelType from entityDefinitionId
    const modelType = getModelType(entityDefinitionId)

    // 1. Check if built-in field
    if (isBuiltInField(fieldId, modelType)) {
      const handler = getBuiltInFieldHandler(fieldId, modelType)
      if (!handler) {
        throw new Error(`Built-in field ${fieldId} has no handler`)
      }
      await handler(this.db, entityInstanceId, value, this.organizationId)

      // Create synthetic TypedFieldValue for frontend store
      const builtInFieldType = getBuiltInFieldType(fieldId, modelType)
      const performedAt = new Date().toISOString()
      if (value !== null && value !== undefined && builtInFieldType) {
        const typedInput = formatToTypedInput(value, builtInFieldType)
        if (typedInput) {
          const syntheticValue = {
            id: `builtin-${fieldId}-${entityInstanceId}`,
            entityId: entityInstanceId,
            fieldId,
            sortKey: '',
            createdAt: performedAt,
            updatedAt: performedAt,
            ...typedInput,
          } as TypedFieldValue
          return { state: 'complete', performedAt, values: [syntheticValue] }
        }
      }

      return { state: 'complete', performedAt, values: [] }
    }

    // 2. Get field definition (cached)
    const field = await this.getField(fieldId)

    // 3. Validate and convert raw value to typed input using FieldValueValidator
    const typedValue = await this.validateAndConvertValue(value, field.type, field as any)

    // Handle null values (deletion)
    if (typedValue === null) {
      await this.deleteValue({ resourceId, fieldId })
      await this.maybeUpdateDisplayValue(resourceId, field, null)
      return { state: 'complete', performedAt: new Date().toISOString(), values: [] }
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
          excludeEntityId: entityInstanceId,
        },
        this.db
      )
    }

    // 5. Get old value for event (only if publishing for contacts)
    let oldValue: TypedFieldValue | TypedFieldValue[] | null = null
    if (publishEvents && modelType === 'contact') {
      oldValue = await this.getValue({ resourceId, fieldId })
    }

    // 6. Set the value
    const result = await this.setValueWithType({
      resourceId,
      fieldId,
      fieldType: field.type,
      value: typedValue,
      skipInverseSync,
    })

    // 7. Publish event for contacts (use first value for event compat)
    if (publishEvents && modelType === 'contact' && this.userId) {
      await publisher.publishLater({
        type: 'contact:field:updated',
        data: {
          contactId: entityInstanceId,
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

    // Always return arrays with state and timestamp
    return {
      state: 'complete',
      performedAt: new Date().toISOString(),
      values: result,
    }
  }

  /**
   * Set multiple field values for a single entity in an optimized batch operation.
   * Preferred method when setting 2+ fields on the same entity.
   *
   * Optimizations: prefetches field definitions, batch validates relationships,
   * separates built-in/custom fields, continues on individual field errors.
   *
   * @param params.resourceId - ResourceId of the entity (e.g. "contact:abc123")
   * @param params.values - Array of {fieldId, value} pairs to set
   * @param params.publishEvents - Publish contact:field:updated events (default: true)
   * @param params.skipInverseSync - Skip inverse relationship sync (for bulk ops)
   * @returns Array of SetValuesResult (one per field)
   *
   * @example
   * await service.setValuesForEntity({
   *   resourceId: "contact:abc123",
   *   values: [
   *     { fieldId: "field-email", value: "customer@example.com" },
   *     { fieldId: "field-phone", value: "+1-555-0123" },
   *     { fieldId: "field-tags", value: ["vip", "ecommerce"] }
   *   ],
   *   publishEvents: true
   * })
   */
  async setValuesForEntity(params: SetValuesForEntityInput): Promise<SetValuesResult[]> {
    const { resourceId, values, publishEvents = true, skipInverseSync = false } = params

    // Parse ResourceId to get both parts and derive modelType
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
    const modelType = getModelType(entityDefinitionId)

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
        await handler(this.db, entityInstanceId, v.value, this.organizationId)
      }

      // Create synthetic TypedFieldValue for frontend store
      const builtInFieldType = getBuiltInFieldType(v.fieldId, modelType)
      if (v.value !== null && v.value !== undefined && builtInFieldType) {
        const typedInput = formatToTypedInput(v.value, builtInFieldType)
        if (typedInput) {
          const performedAt = new Date().toISOString()
          const syntheticValue = {
            id: `builtin-${v.fieldId}-${entityInstanceId}`,
            entityId: entityInstanceId,
            fieldId: v.fieldId,
            sortKey: '',
            createdAt: performedAt,
            updatedAt: performedAt,
            ...typedInput,
          } as TypedFieldValue
          results.push({
            fieldId: v.fieldId,
            state: 'complete',
            performedAt,
            values: [syntheticValue],
          })
          continue
        }
      }

      results.push({
        fieldId: v.fieldId,
        state: 'complete',
        performedAt: new Date().toISOString(),
        values: [],
      })
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
      await this.preBatchValidateRelationships(
        customs.map((c) => c.value),
        fieldTypes
      )

      // Now set each value (will use cached field definitions and relationship validations)
      for (const v of customs) {
        try {
          const result = await this.setValueWithBuiltIn({
            resourceId,
            fieldId: v.fieldId,
            value: v.value,
            publishEvents,
            skipInverseSync,
          })

          results.push({ fieldId: v.fieldId, ...result })
        } catch (error) {
          // Log but continue with other fields
          console.error(`Failed to set field ${v.fieldId}:`, error)
          results.push({
            fieldId: v.fieldId,
            state: 'failed',
            performedAt: new Date().toISOString(),
            values: [],
          })
        }
      }
    }

    return results
  }

  /**
   * Set the same field values for multiple entities in a resilient batch operation.
   * Uses Promise.allSettled to handle failures gracefully without blocking other updates.
   *
   * Use case: Bulk imports, migrations, applying same fields to many entities.
   * Behavior: prefetches field definitions, sets fields in parallel, continues on failures,
   * disables event publishing, handles bulk inverse relationship sync efficiently.
   *
   * @param params.resourceIds - Array of ResourceIds to update (e.g. ["contact:abc", "contact:xyz"])
   * @param params.values - Array of {fieldId, value} pairs to apply to all entities
   * @returns Object with count of successfully updated entities
   *
   * @example
   * await service.setBulkValues({
   *   resourceIds: ["contact:abc123", "contact:xyz456", ...],
   *   values: [
   *     { fieldId: "field-status", value: "archived" },
   *     { fieldId: "field-archived-date", value: "2024-01-15T10:00:00Z" }
   *   ]
   * })
   */
  async setBulkValues(params: SetBulkValuesInput): Promise<{ count: number }> {
    const { resourceIds, values } = params

    if (resourceIds.length === 0 || values.length === 0) {
      return { count: 0 }
    }

    // Parse ResourceIds and derive modelType from first one (all should be same type in bulk)
    const parsedResources = resourceIds.map((rid) => parseResourceId(rid))
    const entityInstanceIds = parsedResources.map((p) => p.entityInstanceId)
    const modelType = getModelType(parsedResources[0]!.entityDefinitionId)

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

    // ═══ Identify relationship fields and prepare for bulk sync ═══
    const relationshipFields: Array<{
      fieldId: string
      field: FieldWithDefinition
      inverseInfo: InverseFieldInfo
      rawValue: unknown
    }> = []

    for (const v of validValues) {
      const field = this.fieldCache.get(v.fieldId)
      if (field?.type === 'RELATIONSHIP') {
        const inverseInfo = await this.getInverseInfoFromField(field)
        if (inverseInfo) {
          relationshipFields.push({ fieldId: v.fieldId, field, inverseInfo, rawValue: v.value })
        }
      }
    }

    // ═══ Batch capture old relationship values (1 query per relationship field) ═══
    const oldRelatedIdsMap = new Map<string, Map<string, string[]>>() // fieldId → (entityId → oldIds[])

    for (const rf of relationshipFields) {
      const oldIds = await batchGetExistingRelatedIds(
        { db: this.db, organizationId: this.organizationId },
        entityInstanceIds,
        rf.fieldId
      )
      oldRelatedIdsMap.set(rf.fieldId, oldIds)
    }

    // ═══ Set values for all entities in parallel ═══
    // Skip inverse sync here - we'll do bulk sync at the end
    const results = await Promise.allSettled(
      resourceIds.map((resourceId) =>
        this.setValuesForEntity({
          resourceId,
          values: validValues,
          publishEvents: false, // Don't spam events for bulk operations
          skipInverseSync: true, // Bulk sync handled separately below
        })
      )
    )

    // ═══ Bulk sync inverse relationships (aggregated across all entities) ═══
    for (const rf of relationshipFields) {
      const oldIdsForField = oldRelatedIdsMap.get(rf.fieldId)
      if (!oldIdsForField) continue

      // Extract new related IDs from the raw value
      const newRelatedIds = this.extractRelatedIdsFromRaw(rf.rawValue)

      // Build bulk updates array
      const updates: BulkRelationshipUpdate[] = entityInstanceIds.map((entityId) => ({
        entityId,
        oldRelatedIds: oldIdsForField.get(entityId) ?? [],
        newRelatedIds, // Same new value for all entities in bulk operation
      }))

      // Execute bulk sync (minimal queries)
      await syncInverseRelationshipsBulk(
        { db: this.db, organizationId: this.organizationId },
        { updates, inverseInfo: rf.inverseInfo }
      )
    }

    const count = results.filter((r) => r.status === 'fulfilled').length
    return { count }
  }

  /**
   * Extract related entity IDs from a raw relationship value.
   * Handles various input formats (string, object, array).
   */
  private extractRelatedIdsFromRaw(value: unknown): string[] {
    if (!value) return []

    if (Array.isArray(value)) {
      return value
        .map((v) => {
          if (typeof v === 'string') return v
          if (typeof v === 'object' && v !== null && 'relatedEntityId' in v) {
            return (v as { relatedEntityId: string }).relatedEntityId
          }
          return null
        })
        .filter((id): id is string => id !== null)
    }

    if (typeof value === 'string') return [value]

    if (typeof value === 'object' && value !== null && 'relatedEntityId' in value) {
      return [(value as { relatedEntityId: string }).relatedEntityId]
    }

    return []
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
   * Get a single field value for an entity.
   * Returns TypedFieldValue for single-value fields, TypedFieldValue[] for multi-value fields, or null.
   *
   * @param params.resourceId - ResourceId of the entity (e.g. "contact:abc123")
   * @param params.fieldId - UUID of the field
   * @param cachedField - Optional pre-fetched FieldWithDefinition to avoid lookup
   * @returns TypedFieldValue | TypedFieldValue[] | null
   *
   * @example
   * const email = await service.getValue({ resourceId: "contact:abc123", fieldId: "field-email" })
   */
  async getValue(
    params: GetValueInput,
    cachedField?: FieldWithDefinition
  ): Promise<TypedFieldValue | TypedFieldValue[] | null> {
    const { entityInstanceId } = parseResourceId(params.resourceId)

    // Use cached field if provided (avoids redundant CustomField join)
    const field = cachedField ?? (await this.getField(params.fieldId))

    const rows = await this.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.fieldId, params.fieldId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))

    if (rows.length === 0) {
      return null
    }

    return this.rowsToTypedValues(rows, field.type, isArrayReturnFieldType(field.type))
  }

  /**
   * Get multiple field values for an entity in a single efficient query.
   * Returns Map keyed by fieldId. Use this instead of calling getValue() multiple times.
   * Single DB join of FieldValue + CustomField avoids N+1 queries.
   *
   * @param params.resourceId - ResourceId of the entity (e.g. "contact:abc123")
   * @param params.fieldIds - Optional array of field UUIDs (omit to get all fields)
   * @returns Map<fieldId, TypedFieldValue | TypedFieldValue[]>
   *
   * @example
   * const values = await service.getValues({
   *   resourceId: "contact:abc123",
   *   fieldIds: ["field-email", "field-phone"]
   * })
   * const email = values.get("field-email")
   */
  async getValues(
    params: GetValuesInput
  ): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
    const { entityInstanceId } = parseResourceId(params.resourceId)

    const query = this.db
      .select()
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
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
      const typedValues = this.rowsToTypedValues(
        fieldValueRows,
        fieldType,
        isArrayReturnFieldType(fieldType)
      )
      result.set(fieldId, typedValues)
    }

    return result
  }

  /**
   * Efficiently get field values for multiple entities in a single batch query.
   *
   * Uses the ResourceId format (entityDefinitionId:entityInstanceId) which encodes
   * both the entity type and instance in a single value.
   *
   * Returns a normalized array with one result per entity+field combination that has a value.
   * Missing combinations are omitted (rather than returning null for each missing field).
   *
   * **Features:**
   * - Single DB query for all entity+field combinations
   * - Validates data integrity (detects orphaned option/relationship references)
   * - Supports both system resources (contact, ticket) and custom entities
   * - ResourceRegistryService caching for efficient field type lookups
   *
   * @param params - The BatchGetValuesInput object
   * @param params.resourceIds - Array of ResourceIds in format "entityDefinitionId:entityInstanceId"
   *                             Use toResourceIds() helper to build from entityDefinitionId + instanceIds
   *                             Example: ["contact:contact-1", "contact:contact-2"]
   * @param params.fieldIds - Array of field UUIDs to retrieve
   *                          Example: ["field-email", "field-name", "field-status"]
   *
   * @returns BatchFieldValueResult containing:
   *          - values: Array of TypedFieldValueResult, one per entity+field with actual data
   *            Each result includes:
   *            - resourceId: The entity instance ID (NOT the full ResourceId)
   *            - fieldId: The field UUID
   *            - value: TypedFieldValue or TypedFieldValue[] (based on field type)
   *            - issues?: Array of validation issues (orphaned references, type mismatches)
   *
   * @example
   * // Fetch email and name for 10 contacts
   * const result = await fieldValueService.batchGetValues({
   *   resourceIds: toResourceIds("contact", ["contact-1", "contact-2", "contact-10"]),
   *   fieldIds: ["field-email", "field-name"]
   * });
   *
   * @example
   * // Fetch custom entity values
   * const result = await fieldValueService.batchGetValues({
   *   resourceIds: toResourceIds(entityDefinitionId, instanceIds),
   *   fieldIds: ["field-title", "field-status", "field-related"]
   * });
   *
   * // Check for data integrity issues
   * const resultsWithIssues = result.values.filter((r) => r.issues?.length);
   * if (resultsWithIssues.length > 0) {
   *   console.warn("Found data integrity issues:", resultsWithIssues);
   * }
   */
  async batchGetValues(params: BatchGetValuesInput): Promise<BatchFieldValueResult> {
    const { resourceIds, fieldIds } = params

    if (resourceIds.length === 0 || fieldIds.length === 0) {
      return { values: [] }
    }

    // Parse ResourceIds to extract entityInstanceIds for DB query
    const parsedResources = resourceIds.map((rid) => parseResourceId(rid))
    const entityInstanceIds = parsedResources.map((p) => p.entityInstanceId)

    // Create lookup: instanceId -> ResourceId
    const instanceToResourceId = new Map<string, ResourceId>()
    for (const parsed of parsedResources) {
      instanceToResourceId.set(
        parsed.entityInstanceId,
        toResourceId(parsed.entityDefinitionId, parsed.entityInstanceId)
      )
    }

    // Get unique entityDefinitionIds for field type lookups
    const uniqueEntityDefIds = [...new Set(parsedResources.map((p) => p.entityDefinitionId))]

    // Query field values using instance IDs
    const rows = await this.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, this.organizationId),
          inArray(schema.FieldValue.entityId, entityInstanceIds),
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

    // Build combined field type map from all entity definitions
    const fieldTypeMap = new Map<string, FieldType>()
    for (const entityDefId of uniqueEntityDefIds) {
      const typeMap = await this.getFieldTypeMapByDefinition(entityDefId, fieldIds)
      for (const [fid, ftype] of typeMap) {
        fieldTypeMap.set(fid, ftype)
      }
    }

    // Build result with validation (only include combinations that have actual data)
    const results: TypedFieldValueResult[] = []
    for (const instanceId of entityInstanceIds) {
      const fullResourceId = instanceToResourceId.get(instanceId)
      if (!fullResourceId) continue

      for (const fieldId of fieldIds) {
        const key = `${instanceId}:${fieldId}`
        const fieldRows = valueMap.get(key)
        const issues: string[] = []

        // Skip combinations with no data - only return values that exist
        if (!fieldRows || fieldRows.length === 0) {
          continue
        } else {
          const fieldType = fieldTypeMap.get(fieldId)

          if (!fieldType) {
            // Field definition not found - orphaned reference
            issues.push(`Field type not found for field ${fieldId}`)
            results.push({
              resourceId: fullResourceId,
              fieldId,
              value: null,
              issues,
            })
            continue
          }

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
            resourceId: fullResourceId,
            fieldId,
          }

          if (isArrayReturnFieldType(fieldType)) {
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
  // PRIVATE HELPERS - BATCH VALUE RETRIEVAL
  // ─────────────────────────────────────────────────────────────

  /**
   * Build a Map of fieldId -> FieldType using ResourceRegistryService cache.
   * Handles both system resources (e.g., 'contact') and custom entity resources.
   *
   * Uses the preserved FieldType (e.g., 'TEXT', 'RELATIONSHIP') to determine
   * value storage type. Throws if fieldType is missing, as it's required for
   * correct value storage and retrieval.
   *
   * @param entityDefinitionId - Entity definition ID (e.g., 'contact', 'ticket', or a custom entity UUID)
   * @param fieldIds - Field IDs to fetch types for
   * @returns Map<fieldId, FieldType> with typed field types
   * @throws Error if resource not found, field type lookup fails, or fieldType is missing
   */
  private async getFieldTypeMapByDefinition(
    entityDefinitionId: string,
    fieldIds: string[]
  ): Promise<Map<string, FieldType>> {
    // Fetch resource using service cache (entityDefinitionId works for both system and custom)
    const resource = await this.registryService.getById(entityDefinitionId)
    if (!resource) {
      throw new Error(`Resource not found: ${entityDefinitionId}`)
    }

    // Build map of fieldId -> FieldType with strict validation
    const typeMap = new Map<string, FieldType>()
    for (const field of resource.fields) {
      if (fieldIds.includes(field.id ?? '')) {
        // fieldType MUST exist - it's populated by mapCustomFieldsToResourceFields
        if (!field.fieldType) {
          throw new Error(
            `[getFieldTypeMapByDefinition] Field ${field.id} missing fieldType. ` +
              `ResourceField.fieldType must be set for value storage type determination.`
          )
        }
        typeMap.set(field.id!, field.fieldType)
      }
    }

    return typeMap
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
   * Extract inverse field info from a cached field definition.
   * Returns null if field is not a relationship or has no inverse configured.
   */
  private async getInverseInfoFromField(
    field: FieldWithDefinition
  ): Promise<InverseFieldInfo | null> {
    if (field.type !== 'RELATIONSHIP') return null

    const relationship = (field.options as Record<string, unknown>)?.relationship as
      | RelationshipConfig
      | undefined
    if (!relationship?.inverseFieldId) return null

    // Use existing cached getField() for the inverse field
    const inverseField = await this.getField(relationship.inverseFieldId)
    const inverseRelationship = (inverseField.options as Record<string, unknown>)?.relationship as
      | RelationshipConfig
      | undefined

    // Source = entity being updated (has this field)
    const sourceEntityDefinitionId = field.entityDefinitionId ?? field.modelType ?? ''

    // Target = entity with inverse field
    const targetEntityDefinitionId = inverseField.entityDefinitionId ?? inverseField.modelType ?? ''

    return {
      inverseFieldId: relationship.inverseFieldId,
      inverseRelationshipType: inverseRelationship?.relationshipType ?? 'has_many',
      sourceEntityDefinitionId,
      targetEntityDefinitionId,
      sourceFieldId: field.id,
    }
  }

  /**
   * Batch validate relationships efficiently.
   * Collects all relationship validations and does them in a single DB query.
   * Returns a map for quick lookup during individual validations.
   */
  private batchRelationshipValidationCache = new Map<
    string,
    { success: boolean; message?: string }
  >()

  /**
   * Pre-validate all relationships in a batch for the current operation.
   * Call this before validating individual values to enable batch optimization.
   */
  async preBatchValidateRelationships(values: unknown[], fieldTypes: string[]): Promise<void> {
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
    // Debug TAGS conversion
    if (fieldType === 'TAGS') {
      console.log('🔀 validateAndConvertValue for TAGS:', {
        fieldType,
        value,
        isArray: Array.isArray(value),
      })
    }

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

      if (fieldType === 'TAGS') {
        console.log('🔀 Converted TAGS array:', {
          originalCount: value.length,
          convertedCount: converted.length,
          converted,
        })
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

        const { relatedEntityId, relatedEntityDefinitionId } = structureResult.data!

        // Check batch validation cache first (if preBatchValidateRelationships was called)
        if (this.batchRelationshipValidationCache.has(relatedEntityId)) {
          const validation = this.batchRelationshipValidationCache.get(relatedEntityId)!
          if (!validation.success) {
            throwValidationError({
              success: false,
              error: {
                issues: [
                  {
                    message: validation.message || 'Relationship validation failed',
                    path: ['relatedEntityId'],
                  },
                ],
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
    resourceId: ResourceId,
    field: FieldWithDefinition,
    value: TypedFieldValueInput | TypedFieldValueInput[] | null
  ): Promise<void> {
    const { entityInstanceId } = parseResourceId(resourceId)
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
      const toTypedValue = (input: TypedFieldValueInput): TypedFieldValue =>
        ({
          ...input,
          id: '',
          entityId: entityInstanceId,
          fieldId: field.id,
          sortKey: '',
          createdAt: '',
          updatedAt: '',
        }) as TypedFieldValue

      const typedValue = Array.isArray(value) ? value.map(toTypedValue) : toTypedValue(value)

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
        // Use centralized formatter for display value computation
        displayValue = formatToDisplayValue(typedValue, field.type, field.options as any) as
          | string
          | null
      }
    }

    // Update the appropriate column
    await this.db
      .update(schema.EntityInstance)
      .set({ [column]: displayValue })
      .where(
        and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, this.organizationId)
        )
      )
  }

  /**
   * Set single-value field using UPSERT strategy.
   * Checks if row exists, then UPDATE or INSERT.
   */
  private async setSingleValue(
    resourceId: ResourceId,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput | TypedFieldValueInput[]
  ): Promise<TypedFieldValue[]> {
    const { entityInstanceId } = parseResourceId(resourceId)
    const singleValue = Array.isArray(value) ? value[0] : value
    if (!singleValue) return []

    // Check if row exists
    const existingResult = await getExistingFieldValue({
      entityId: entityInstanceId,
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
      // INSERT new row - pass resourceId to buildInsertData
      const insertData = this.buildInsertData(fieldType, singleValue)
      const insertedResult = await insertFieldValue({
        resourceId,
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
    resourceId: ResourceId,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput | TypedFieldValueInput[]
  ): Promise<TypedFieldValue[]> {
    const { entityInstanceId } = parseResourceId(resourceId)
    const values = Array.isArray(value) ? value : [value]

    // Debug logging for TAGS
    if (fieldType === 'TAGS') {
      console.log('💾 setMultiValue called for TAGS:', {
        resourceId,
        fieldId,
        fieldType,
        valueCount: values.length,
        values,
      })
    }

    // DELETE all existing
    const deleteResult = await deleteFieldValues({
      entityId: entityInstanceId,
      fieldId,
      organizationId: this.organizationId,
    })

    if (deleteResult.isErr()) {
      throw new Error(deleteResult.error.message)
    }

    if (values.length === 0) return []

    // Build insert rows with sortKeys - pass resourceId
    const insertInputs = values.map((v, index) => ({
      resourceId,
      fieldId,
      organizationId: this.organizationId,
      sortKey: generateKeyBetween(index === 0 ? null : `a${index - 1}`, null),
      ...this.buildInsertData(fieldType, v),
    }))

    const insertedResult = await batchInsertFieldValues(insertInputs)

    if (insertedResult.isErr()) {
      throw new Error(insertedResult.error.message)
    }

    const result = insertedResult.value.map((row) =>
      this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )

    // Debug logging for TAGS
    if (fieldType === 'TAGS') {
      console.log('✅ Inserted TAGS values:', {
        resourceId,
        fieldId,
        count: result.length,
        values: result,
      })
    }

    return result
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
  private buildUpdateData(value: TypedFieldValueInput): {
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
    resourceId: ResourceId,
    fieldId: string,
    fieldType: string,
    value: TypedFieldValueInput,
    sortKey: string
  ) {
    // Split ResourceId at DB boundary
    const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

    const base = {
      organizationId: this.organizationId,
      entityId: entityInstanceId,
      entityDefinitionId: entityDefinitionId,
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
  private rowToTypedValue(row: FieldValueRow, fieldType: FieldType): TypedFieldValue {
    const base = {
      id: row.id,
      entityId: row.entityId,
      fieldId: row.fieldId,
      sortKey: row.sortKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }

    const valueType = getValueType(fieldType)

    if (!valueType) {
      throw new Error(
        `[rowToTypedValue] Unknown fieldType: ${fieldType}. ` +
          `Cannot determine value storage type.`
      )
    }

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
    }
  }

  /**
   * Validate that a typed value has actual content (not just defaults)
   */
  private isValidTypedValue(value: TypedFieldValue, fieldType: FieldType): boolean {
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
  private validateRowReferences(row: FieldValueRow, fieldType: FieldType): string[] {
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
