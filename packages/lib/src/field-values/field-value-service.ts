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
import { isBuiltInField, getBuiltInFieldHandler } from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'
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
   * @param params.entityId - UUID of the entity (contact, ticket, or custom entity instance)
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
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
   *   entityId: "contact-123",
   *   fieldId: "field-email",
   *   value: "customer@shop.com"
   * });
   *
   * @example
   * // Set multi-select tags
   * const result = await fieldValueService.setValue({
   *   entityId: "ticket-456",
   *   fieldId: "field-tags",
   *   value: ["option-1", "option-2"]
   * });
   */
  async setValue(params: SetValueInput): Promise<TypedFieldValue[]> {
    const { entityId, fieldId, value } = params

    // 1. Get field definition (cached)
    const field = await this.getField(fieldId)

    // 2. Convert raw value to typed input using formatter
    const typedInput = formatToTypedInput(value, field.type, {
      selectOptions: field.options as { id?: string; value: string; label: string }[] | undefined,
    })

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
   * Set field value when caller already has the field type information.
   *
   * This method skips the CustomField lookup (since you provide fieldType), making it more
   * efficient when called multiple times in a batch or when you already know the field type.
   * Still fetches field definition (with caching) to handle displayName updates.
   *
   * **Replaces all existing values** - Always DELETEs all rows for this entityId+fieldId,
   * then INSERTs new ones. This is safe for both single and multi-value fields.
   *
   * @param params - The SetValueWithTypeInput object
   * @param params.entityId - UUID of the entity
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
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
   *   entityId: "contact-123",
   *   fieldId: "field-name",
   *   fieldType: "TEXT",
   *   value: { type: "text", value: "John Doe" }
   * });
   *
   * @example
   * // Set a multi-value field
   * const result = await fieldValueService.setValueWithType({
   *   entityId: "ticket-456",
   *   fieldId: "field-tags",
   *   fieldType: "TAGS",
   *   value: [
   *     { type: "option", optionId: "tag-1" },
   *     { type: "option", optionId: "tag-2" }
   *   ]
   * });
   */
  async setValueWithType(params: SetValueWithTypeInput): Promise<TypedFieldValue[]> {
    const { entityId, fieldId, fieldType, value, skipInverseSync = false } = params

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
          entityId,
          fieldId
        )
      }
    }

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

      // Sync inverse if we had old relationships
      if (inverseInfo && oldRelatedIds.length > 0) {
        await syncInverseRelationships(
          { db: this.db, organizationId: this.organizationId },
          { entityId, oldRelatedIds, newRelatedIds: [], inverseInfo }
        )
      }

      return []
    }

    // Handle array of values (multi-value fields)
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) {
      await this.maybeUpdateDisplayValue(entityId, field, null)

      // Sync inverse if we had old relationships
      if (inverseInfo && oldRelatedIds.length > 0) {
        await syncInverseRelationships(
          { db: this.db, organizationId: this.organizationId },
          { entityId, oldRelatedIds, newRelatedIds: [], inverseInfo }
        )
      }

      return []
    }

    // Generate sort keys for each value
    const insertRows = values.map((v, index) => {
      const sortKey = generateKeyBetween(index === 0 ? null : `a${index - 1}`, null)
      return this.buildInsertRow(entityId, fieldId, fieldType, v, sortKey)
    })

    // Insert all values
    const inserted = await this.db.insert(schema.FieldValue).values(insertRows).returning()

    const result = inserted.map((row) =>
      this.rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )

    // Update display value if this is a display field
    await this.maybeUpdateDisplayValue(entityId, field, value)

    // ═══ Sync inverse relationships ═══
    if (inverseInfo) {
      const newRelatedIds = values
        .filter(
          (v): v is { type: 'relationship'; relatedEntityId: string; relatedEntityDefinitionId: string } =>
            v.type === 'relationship' && !!v.relatedEntityId
        )
        .map((v) => v.relatedEntityId)

      await syncInverseRelationships(
        { db: this.db, organizationId: this.organizationId },
        { entityId, oldRelatedIds, newRelatedIds, inverseInfo }
      )
    }

    return result
  }

  /**
   * Add a single value to a multi-value field without removing existing values.
   *
   * This is an APPEND operation - new value is added to the list, not replaced.
   * Automatically calculates the correct sort order based on existing values.
   *
   * **Multi-value fields:** MULTI_SELECT, TAGS, RELATIONSHIP, FILE
   * **Do NOT use this for single-value fields** (TEXT, EMAIL, NUMBER, etc.)
   *
   * @param params - The AddValueInput object
   * @param params.entityId - UUID of the entity
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldId - UUID of the multi-value field
   *                         Example: "660e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldType - The field type (must be a multi-value type)
   *                           Examples: "MULTI_SELECT", "TAGS", "RELATIONSHIP", "FILE"
   * @param params.value - A single TypedFieldValueInput (not an array)
   *                       - MULTI_SELECT/TAGS: { type: "option", optionId: "opt-123" }
   *                       - RELATIONSHIP: { type: "relationship", relatedEntityId: "rel-123", relatedEntityDefinitionId: "def-456" }
   *                       - FILE: { type: "json", value: { name: "document.pdf", url: "..." } }
   *                       Example: { type: "option", optionId: "new-tag-id" }
   *
   * @param params.position - Where to insert the new value (default: 'end')
   *                          - 'start': Insert before all existing values
   *                          - 'end': Append after all existing values
   *                          - { after: sortKey }: Insert after specific value
   *                          Example position: "start" or { after: "existing-sort-key" }
   *
   * @returns Single TypedFieldValue for the newly added value
   *          Includes id, entityId, fieldId, type, value, sortKey, and timestamps
   *          Example: { id: "fv-999", type: "option", optionId: "opt-123", ... }
   *
   * @throws Error if field not found, value doesn't match fieldType, or position not found
   *
   * @example
   * // Add a new tag to existing tags
   * const newTag = await fieldValueService.addValue({
   *   entityId: "ticket-123",
   *   fieldId: "field-tags",
   *   fieldType: "TAGS",
   *   value: { type: "option", optionId: "tag-urgent" },
   *   position: "end"
   * });
   *
   * @example
   * // Add related entity to relationship field
   * const newRelation = await fieldValueService.addValue({
   *   entityId: "order-456",
   *   fieldId: "field-related-items",
   *   fieldType: "RELATIONSHIP",
   *   value: {
   *     type: "relationship",
   *     relatedEntityId: "item-789",
   *     relatedEntityDefinitionId: "entity-def-1"
   *   },
   *   position: "start"
   * });
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
   * @param params - The DeleteValueInput object
   * @param params.entityId - UUID of the entity
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldId - UUID of the field to clear
   *                         Example: "660e8400-e29b-41d4-a716-446655440000"
   *
   * @throws Error if deletion fails
   *
   * @example
   * // Clear the email field for a contact
   * await fieldValueService.deleteValue({
   *   entityId: "contact-123",
   *   fieldId: "field-email"
   * });
   * // Contact's email is now null
   *
   * @example
   * // Clear all tags from a ticket
   * await fieldValueService.deleteValue({
   *   entityId: "ticket-456",
   *   fieldId: "field-tags"
   * });
   * // Ticket's tags array is now empty
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
   * Set a field value with built-in field support and optional event publishing.
   *
   * This is the **primary entry point** for setting field values in most application code.
   * It handles both built-in fields (like createdAt, modifiedBy) and custom fields.
   *
   * **Key features:**
   * - Built-in field detection and delegation to specialized handlers
   * - Type validation using Zod schemas (FieldValueValidator)
   * - Uniqueness constraint checking for unique fields
   * - Automatic displayName update for display fields
   * - Event publishing for audit/tracking (only for contact fields)
   * - CustomField caching for performance
   *
   * @param params - The SetValueWithBuiltInInput object
   * @param params.entityId - UUID of the entity (contact, ticket, or entity instance)
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldId - UUID of the field (can be a built-in field ID like "createdAt")
   *                         Custom field example: "660e8400-e29b-41d4-a716-446655440000"
   *                         Built-in field example: "createdAt", "modifiedBy"
   * @param params.value - Raw value to set. Auto-converted and validated.
   *                       Format varies by field type (see setValue() for details)
   *                       Can be any type - service validates and converts it
   *                       Example: "customer@shop.com", 42, true, ["tag1", "tag2"], null
   * @param params.modelType - The model type for field context
   *                           Options: 'contact', 'ticket', 'thread', 'entity'
   *                           Used to determine if field is built-in and publish events
   *                           Example: 'contact'
   * @param params.publishEvents - Whether to publish contact:field:updated events (default: true)
   *                               Only applies to 'contact' modelType
   *                               Set to false for bulk operations to reduce event volume
   *                               Example: false for bulk updates
   *
   * @returns SetValueResult object containing:
   *          - ids: array of FieldValue IDs (empty for built-in fields)
   *          - values: array of TypedFieldValue objects (empty for built-in fields)
   *          Example: { ids: ["fv-1"], values: [{ id: "fv-1", type: "text", value: "..." }] }
   *
   * @throws Error if:
   *         - Field not found
   *         - Value validation fails (type mismatch, invalid format)
   *         - Uniqueness constraint violated
   *         - Built-in field handler throws error
   *
   * @example
   * // Set an email field (custom field)
   * const result = await fieldValueService.setValueWithBuiltIn({
   *   entityId: "contact-123",
   *   fieldId: "field-email-uuid",
   *   value: "john.doe@example.com",
   *   modelType: "contact",
   *   publishEvents: true
   * });
   * // result: { ids: ["fv-123"], values: [{ id: "fv-123", type: "text", value: "john.doe@example.com", ... }] }
   *
   * @example
   * // Set a built-in field (no custom field lookup needed)
   * const result = await fieldValueService.setValueWithBuiltIn({
   *   entityId: "contact-456",
   *   fieldId: "firstName",  // built-in field
   *   value: "John",
   *   modelType: "contact"
   * });
   * // result: { ids: [], values: [] } (built-in fields don't store in FieldValue table)
   *
   * @example
   * // Bulk update without event publishing
   * const result = await fieldValueService.setValueWithBuiltIn({
   *   entityId: "contact-789",
   *   fieldId: "field-status",
   *   value: "active",
   *   modelType: "contact",
   *   publishEvents: false  // suppress events for bulk operations
   * });
   */
  async setValueWithBuiltIn(params: SetValueWithBuiltInInput): Promise<SetValueResult> {
    const { entityId, fieldId, value, modelType, publishEvents = true, skipInverseSync = false } = params

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
      skipInverseSync,
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
   * Set multiple field values for a single entity in an optimized batch operation.
   *
   * This is the preferred method when setting 2+ fields on the same entity.
   * Prefetches all field definitions once, then validates and sets each field.
   *
   * **Optimizations:**
   * - Prefetches CustomField definitions once (avoids N+1 queries)
   * - Pre-batch validates relationships (single DB query for all relationships)
   * - Separates built-in from custom fields
   * - Continues on error (logs and returns empty result, doesn't block other fields)
   *
   * **Replaces:** CustomFieldService.setValues
   *
   * @param params - The SetValuesForEntityInput object
   * @param params.entityId - UUID of the entity receiving field values
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
   * @param params.values - Array of field value pairs to set
   *                        Each object contains:
   *                        - fieldId: UUID of the field (custom or built-in)
   *                        - value: Raw value (any format, auto-converted by field type)
   *                        Example:
   *                        [
   *                          { fieldId: "field-email", value: "john@shop.com" },
   *                          { fieldId: "field-name", value: "John Doe" },
   *                          { fieldId: "field-tags", value: ["tag1", "tag2"] },
   *                          { fieldId: "firstName", value: "John" } // built-in field
   *                        ]
   * @param params.modelType - The model type ('contact', 'ticket', 'thread', 'entity')
   *                           Used for built-in field detection and event publishing
   *                           Example: 'contact'
   * @param params.publishEvents - Whether to publish events for contact fields (default: true)
   *                               Set to false for bulk operations
   *                               Example: true
   *
   * @returns Array of SetValuesResult objects, one per input field
   *          Each result contains:
   *          - fieldId: The field that was set
   *          - ids: Array of FieldValue IDs (empty for built-in fields)
   *          - values: Array of TypedFieldValue objects (empty for built-in fields)
   *          If a field fails, returns { fieldId, ids: [], values: [] }
   *          Example:
   *          [
   *            { fieldId: "field-email", ids: ["fv-1"], values: [...] },
   *            { fieldId: "field-name", ids: ["fv-2"], values: [...] },
   *            { fieldId: "firstName", ids: [], values: [] }
   *          ]
   *
   * @example
   * // Set multiple fields for a contact
   * const results = await fieldValueService.setValuesForEntity({
   *   entityId: "contact-123",
   *   values: [
   *     { fieldId: "field-email", value: "customer@example.com" },
   *     { fieldId: "field-phone", value: "+1-555-0123" },
   *     { fieldId: "field-status", value: "lead" },
   *     { fieldId: "field-tags", value: ["vip", "ecommerce"] }
   *   ],
   *   modelType: "contact",
   *   publishEvents: true
   * });
   * // Efficiently sets all 4 fields with single prefetch of field definitions
   *
   * @example
   * // Update contact without firing events (bulk scenario)
   * const results = await fieldValueService.setValuesForEntity({
   *   entityId: "contact-456",
   *   values: [
   *     { fieldId: "field-score", value: 100 },
   *     { fieldId: "field-last-contacted", value: "2024-01-15" }
   *   ],
   *   modelType: "contact",
   *   publishEvents: false
   * });
   */
  async setValuesForEntity(params: SetValuesForEntityInput): Promise<SetValuesResult[]> {
    const { entityId, values, modelType, publishEvents = true, skipInverseSync = false } = params

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
      await this.preBatchValidateRelationships(
        customs.map((c) => c.value),
        fieldTypes
      )

      // Now set each value (will use cached field definitions and relationship validations)
      for (const v of customs) {
        try {
          const result = await this.setValueWithBuiltIn({
            entityId,
            fieldId: v.fieldId,
            value: v.value,
            modelType,
            publishEvents,
            skipInverseSync,
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
   * Set the same field values for multiple entities in a resilient batch operation.
   *
   * Applies the same field values to many entities efficiently.
   * Uses Promise.allSettled to handle failures gracefully without blocking other updates.
   *
   * **Use case:** Bulk imports, migrations, or applying the same fields to many entities.
   *
   * **Behavior:**
   * - Prefetches field definitions once (shared across all entities)
   * - Sets fields for each entity in parallel (Promise.all)
   * - Continues even if some entities fail (reports final count of successful updates)
   * - Disables event publishing to reduce overhead
   *
   * **Replaces:** CustomFieldService.bulkSetValues
   *
   * @param params - The SetBulkValuesInput object
   * @param params.entityIds - Array of entity UUIDs to update
   *                           Example: ["entity-1", "entity-2", "entity-3", ...]
   * @param params.values - Array of field value pairs to apply to all entities
   *                        Each object contains:
   *                        - fieldId: UUID of the field
   *                        - value: Raw value (applied to all entities)
   *                        Example:
   *                        [
   *                          { fieldId: "field-status", value: "archived" },
   *                          { fieldId: "field-date", value: "2024-01-15" }
   *                        ]
   * @param params.modelType - The model type ('contact', 'ticket', 'thread', 'entity')
   *                           Used for built-in field detection
   *                           Example: 'contact'
   *
   * @returns Object containing:
   *          - count: Number of entities successfully updated (0 if all failed)
   *          Example: { count: 3 } means 3 out of N entities were successfully updated
   *
   * @example
   * // Archive 100 contacts
   * const result = await fieldValueService.setBulkValues({
   *   entityIds: [
   *     "contact-1", "contact-2", "contact-3", ... // 100 IDs
   *   ],
   *   values: [
   *     { fieldId: "field-status", value: "archived" },
   *     { fieldId: "field-archived-date", value: "2024-01-15T10:00:00Z" }
   *   ],
   *   modelType: "contact"
   * });
   * // result: { count: 98 } (2 contacts failed, but operation didn't stop)
   *
   * @example
   * // Bulk tag entities
   * const result = await fieldValueService.setBulkValues({
   *   entityIds: ["entity-1", "entity-2", "entity-3"],
   *   values: [
   *     { fieldId: "field-tags", value: ["migrated", "batch-001"] }
   *   ],
   *   modelType: "entity"
   * });
   * // result: { count: 3 } (all entities tagged successfully)
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
        entityIds,
        rf.fieldId
      )
      oldRelatedIdsMap.set(rf.fieldId, oldIds)
    }

    // ═══ Set values for all entities in parallel ═══
    // Skip inverse sync here - we'll do bulk sync at the end
    const results = await Promise.allSettled(
      entityIds.map((entityId) =>
        this.setValuesForEntity({
          entityId,
          values: validValues,
          modelType,
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
      const updates: BulkRelationshipUpdate[] = entityIds.map((entityId) => ({
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
   *
   * Automatically returns the correct format based on field type:
   * - Single-value fields (TEXT, EMAIL, etc): Returns single TypedFieldValue or null
   * - Multi-value fields (MULTI_SELECT, TAGS, etc): Returns array of TypedFieldValue or empty array
   *
   * **Caching:** Pass cachedField to avoid redundant CustomField lookups.
   *
   * @param params - The GetValueInput object
   * @param params.entityId - UUID of the entity
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldId - UUID of the field
   *                         Example: "660e8400-e29b-41d4-a716-446655440000"
   * @param cachedField - Optional pre-fetched FieldWithDefinition to avoid lookup
   *                      Useful when you've already fetched the field definition
   *                      Example: from getField() call in batch scenarios
   *
   * @returns TypedFieldValue for single-value fields, TypedFieldValue[] for multi-value fields, or null
   *          Examples:
   *          - Single-value: { id: "fv-1", type: "text", value: "john@example.com", ... }
   *          - Multi-value: [
   *              { id: "fv-1", type: "option", optionId: "tag-1", ... },
   *              { id: "fv-2", type: "option", optionId: "tag-2", ... }
   *            ]
   *          - No value: null
   *
   * @example
   * // Get email field (single-value)
   * const email = await fieldValueService.getValue({
   *   entityId: "contact-123",
   *   fieldId: "field-email"
   * });
   * // email: { id: "fv-1", type: "text", value: "customer@shop.com", ... }
   *
   * @example
   * // Get tags field (multi-value) with cached field
   * const field = await fieldValueService.getField("field-tags");
   * const tags = await fieldValueService.getValue(
   *   { entityId: "ticket-456", fieldId: "field-tags" },
   *   field
   * );
   * // tags: [{ id: "fv-1", type: "option", optionId: "tag-1" }, ...]
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
   * Get multiple field values for an entity in a single efficient query.
   *
   * Returns a Map keyed by fieldId with the field values (single or array based on type).
   * Use this instead of calling getValue() multiple times.
   *
   * **Efficient:** Single DB join of FieldValue + CustomField avoids N+1 queries.
   *
   * @param params - The GetValuesInput object
   * @param params.entityId - UUID of the entity
   *                          Example: "550e8400-e29b-41d4-a716-446655440000"
   * @param params.fieldIds - Optional array of field UUIDs to retrieve
   *                          If omitted, returns all fields for the entity
   *                          Example: ["field-email", "field-name", "field-tags"]
   *
   * @returns Map<fieldId, value> where value is:
   *          - TypedFieldValue for single-value fields
   *          - TypedFieldValue[] for multi-value fields
   *          - Missing keys if no value set for that field
   *          Example:
   *          {
   *            "field-email": { id: "fv-1", type: "text", value: "john@shop.com", ... },
   *            "field-tags": [
   *              { id: "fv-2", type: "option", optionId: "tag-1", ... },
   *              { id: "fv-3", type: "option", optionId: "tag-2", ... }
   *            ]
   *          }
   *
   * @example
   * // Get specific fields for a contact
   * const fieldMap = await fieldValueService.getValues({
   *   entityId: "contact-123",
   *   fieldIds: ["field-email", "field-phone", "field-address"]
   * });
   *
   * const email = fieldMap.get("field-email");  // TypedFieldValue | null
   * const phone = fieldMap.get("field-phone");  // TypedFieldValue | null
   * const address = fieldMap.get("field-address"); // TypedFieldValue | null
   *
   * @example
   * // Get all fields for an entity
   * const allFields = await fieldValueService.getValues({
   *   entityId: "ticket-456"
   *   // no fieldIds specified - returns all custom field values
   * });
   */
  async getValues(
    params: GetValuesInput
  ): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
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
      const typedValues = this.rowsToTypedValues(
        fieldValueRows,
        fieldType,
        isMultiValueFieldType(fieldType)
      )
      result.set(fieldId, typedValues)
    }

    return result
  }

  /**
   * Efficiently get field values for multiple entities in a single batch query.
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
   * @param params.resourceType - Type of resource to batch retrieve
   *                              Options: 'contact', 'ticket', 'entity'
   *                              Example: 'contact'
   * @param params.entityDefId - EntityDefinition UUID (REQUIRED if resourceType is 'entity')
   *                             Identifies which custom entity type to fetch
   *                             Example: "entity-def-123"
   *                             Omit or undefined if resourceType is 'contact' or 'ticket'
   * @param params.resourceIds - Array of entity/resource UUIDs to fetch
   *                            Example: ["contact-1", "contact-2", "contact-3"]
   * @param params.fieldIds - Array of field UUIDs to retrieve
   *                          Example: ["field-email", "field-name", "field-status"]
   *
   * @returns BatchFieldValueResult containing:
   *          - values: Array of TypedFieldValueResult, one per entity+field with actual data
   *            Each result includes:
   *            - resourceId: The entity UUID
   *            - fieldId: The field UUID
   *            - value: TypedFieldValue or TypedFieldValue[] (based on field type)
   *            - issues?: Array of validation issues (orphaned references, type mismatches)
   *
   * @example
   * // Fetch email and name for 10 contacts
   * const result = await fieldValueService.batchGetValues({
   *   resourceType: "contact",
   *   resourceIds: ["contact-1", "contact-2", ..., "contact-10"],
   *   fieldIds: ["field-email", "field-name"]
   * });
   *
   * // result.values might contain:
   * // [
   * //   {
   * //     resourceId: "contact-1",
   * //     fieldId: "field-email",
   * //     value: { id: "fv-1", type: "text", value: "john@shop.com", ... }
   * //   },
   * //   {
   * //     resourceId: "contact-1",
   * //     fieldId: "field-name",
   * //     value: { id: "fv-2", type: "text", value: "John Doe", ... }
   * //   },
   * //   ... (only combinations with actual values)
   * // ]
   *
   * @example
   * // Fetch custom entity values with validation
   * const result = await fieldValueService.batchGetValues({
   *   resourceType: "entity",
   *   entityDefId: "custom-entity-def-456",
   *   resourceIds: ["entity-instance-1", "entity-instance-2"],
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
    const { resourceType, entityDefId, resourceIds, fieldIds } = params

    if (resourceIds.length === 0 || fieldIds.length === 0) {
      return { values: [] }
    }

    // Query field values (metadata will be fetched via ResourceRegistryService)
    const rows = await this.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, this.organizationId),
          inArray(schema.FieldValue.entityId, resourceIds),
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

    // Fetch field type map once, using ResourceRegistryService cache
    const fieldTypeMap = await this.getFieldTypeMap(resourceType, entityDefId, fieldIds)

    // Build result with validation (only include combinations that have actual data)
    const results: TypedFieldValueResult[] = []
    for (const entityId of resourceIds) {
      for (const fieldId of fieldIds) {
        const key = `${entityId}:${fieldId}`
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
              resourceId: entityId,
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
   * @param resourceType - 'contact', 'ticket', 'entity', etc.
   * @param entityDefId - EntityDefinition ID if resourceType is 'entity'
   * @param fieldIds - Field IDs to fetch types for
   * @returns Map<fieldId, FieldType> with typed field types
   * @throws Error if resource not found, field type lookup fails, or fieldType is missing
   */
  private async getFieldTypeMap(
    resourceType: string,
    entityDefId: string | undefined,
    fieldIds: string[]
  ): Promise<Map<string, FieldType>> {
    // Determine the resource ID based on resourceType and entityDefId
    const resourceId = resourceType === 'entity' ? entityDefId : resourceType

    if (!resourceId) {
      throw new Error(`Cannot determine resource ID from resourceType: ${resourceType}`)
    }

    // Fetch resource using service cache
    const resource = await this.registryService.getById(resourceId)
    if (!resource) {
      throw new Error(`Resource not found: ${resourceId}`)
    }

    // Build map of fieldId -> FieldType with strict validation
    const typeMap = new Map<string, FieldType>()
    for (const field of resource.fields) {
      if (fieldIds.includes(field.id ?? '')) {
        // fieldType MUST exist - it's populated by mapCustomFieldsToResourceFields
        if (!field.fieldType) {
          throw new Error(
            `[getFieldTypeMap] Field ${field.id} missing fieldType. ` +
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
  private async getInverseInfoFromField(field: FieldWithDefinition): Promise<InverseFieldInfo | null> {
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

    // Source entity definition is the type of entity we're currently updating
    const sourceEntityDefinitionId = field.entityDefinitionId ?? field.modelType ?? ''

    return {
      inverseFieldId: relationship.inverseFieldId,
      inverseRelationshipType: inverseRelationship?.relationshipType ?? 'has_many',
      sourceEntityDefinitionId,
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
      const toTypedValue = (input: TypedFieldValueInput): TypedFieldValue =>
        ({
          ...input,
          id: '',
          entityId,
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
