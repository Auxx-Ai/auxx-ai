// packages/lib/src/field-values/field-value-helpers.ts

import { type Database, database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { getValueType, type TypedFieldValue, type TypedFieldValueInput } from '@auxx/types'
import { type ActorId, isActorId, parseActorId, toActorId } from '@auxx/types/actor'
import {
  getInverseFieldId,
  type RelationshipConfig,
  type RelationshipType,
} from '@auxx/types/custom-field'
import { isFieldPath, parseResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { findCachedResource, getCachedResource, getOrgCache } from '../cache'
import type { FieldOptions } from '../custom-fields/field-options'
import { isRecordId, parseRecordId, toRecordId } from '../resources/resource-id'
import { cascadeDependentDisplayNames, getDisplayFieldDeps } from './display-field-deps'
import { FieldValueValidator, fieldValueSchemas } from './field-value-validator'
import { formatToDisplayValue } from './formatter'
import type { InverseFieldInfo } from './relationship-sync'
import type { FieldReference, FieldValueRow } from './types'

// Re-export for convenience
export type { InverseFieldInfo }

// =============================================================================
// CACHED FIELD TYPE
// =============================================================================

/** Field definition enriched with display config from the resource cache. */
export type CachedField = CustomFieldEntity & {
  entityDefinition: {
    id: string
    primaryDisplayFieldId: string | null
    secondaryDisplayFieldId: string | null
    avatarFieldId: string | null
  } | null
}

// =============================================================================
// CONTEXT INTERFACE
// =============================================================================

/**
 * Shared context for field value operations.
 * Passed to all mutation and query functions for dependency injection.
 */
export interface FieldValueContext {
  db: Database
  organizationId: string
  userId?: string
  /** Pusher socket ID of the originating client — used for self-event exclusion in realtime sync. */
  socketId?: string
  /** Cache for CustomField lookups (keyed by fieldId) */
  fieldCache: Map<string, CachedField>
  /** Cache for batch relationship validations (keyed by relatedEntityId) */
  batchRelationshipValidationCache: Map<string, { success: boolean; message?: string }>
  /** Shared validator instance (stateless, reusable) */
  validator: FieldValueValidator
}

// =============================================================================
// CONTEXT FACTORY
// =============================================================================

/**
 * Create a new FieldValueContext.
 */
export function createFieldValueContext(
  organizationId: string,
  userId?: string,
  db: Database = database,
  socketId?: string
): FieldValueContext {
  return {
    db,
    organizationId,
    userId,
    socketId,
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: new FieldValueValidator(),
  }
}

// =============================================================================
// FIELD CACHING
// =============================================================================

/**
 * Get CustomField with EntityDefinition (cached within context).
 * Uses the org cache — zero DB queries.
 */
export async function getField(ctx: FieldValueContext, fieldId: string): Promise<CachedField> {
  const cached = ctx.fieldCache.get(fieldId)
  if (cached) return cached

  const cachedField = await getOrgCache().from(ctx.organizationId, 'customFields').byId(fieldId)
  if (!cachedField) throw new Error(`Field "${fieldId}" not found`)

  const resource = cachedField.entityDefinitionId
    ? await getCachedResource(ctx.organizationId, cachedField.entityDefinitionId)
    : null

  const field: CachedField = {
    ...cachedField,
    entityDefinition: resource
      ? {
          id: resource.entityDefinitionId ?? resource.id,
          primaryDisplayFieldId: resource.display.primaryDisplayField?.id ?? null,
          secondaryDisplayFieldId: resource.display.secondaryDisplayField?.id ?? null,
          avatarFieldId: resource.display.avatarField?.id ?? null,
        }
      : null,
  }

  ctx.fieldCache.set(fieldId, field)
  return field
}

/**
 * Resolve systemAttribute strings to actual CustomField IDs in a batch.
 * Single cache hit to load all custom fields, then remap any value whose
 * fieldId matches a known systemAttribute. Values with real fieldIds pass through unchanged.
 */
export async function resolveFieldIds(
  orgId: string,
  values: Array<{ fieldId: string; value: unknown }>
): Promise<Array<{ fieldId: string; value: unknown }>> {
  const cache = getOrgCache()
  const allFields = await cache.from(orgId, 'customFields').all()
  const attrToId = new Map<string, string>()
  for (const fields of Object.values(allFields)) {
    for (const f of fields) {
      if (f.systemAttribute) attrToId.set(f.systemAttribute, f.id)
    }
  }

  let changed = false
  const resolved = values.map((v) => {
    const realId = attrToId.get(v.fieldId)
    if (realId) {
      changed = true
      return { ...v, fieldId: realId }
    }
    return v
  })

  return changed ? resolved : values
}

/**
 * Extract inverse field info from a cached field definition.
 * Returns null if field is not a relationship or has no inverse configured.
 */
export async function getInverseInfoFromField(
  ctx: FieldValueContext,
  field: CachedField
): Promise<InverseFieldInfo | null> {
  if (field.type !== 'RELATIONSHIP') return null

  const relationship = (field.options as Record<string, unknown>)?.relationship as
    | RelationshipConfig
    | undefined
  const inverseFieldId = relationship ? getInverseFieldId(relationship) : null
  if (!inverseFieldId) return null

  // Use existing cached getField() for the inverse field
  const inverseField = await getField(ctx, inverseFieldId)
  const inverseRelationship = (inverseField.options as Record<string, unknown>)?.relationship as
    | RelationshipConfig
    | undefined

  // Source = entity being updated (has this field)
  const sourceEntityDefinitionId = field.entityDefinitionId

  // Target = entity with inverse field
  const targetEntityDefinitionId = inverseField.entityDefinitionId

  // Default to 'has_many' if not specified (valid RelationshipType)
  const inverseRelationshipType: RelationshipType =
    inverseRelationship?.relationshipType ?? 'has_many'

  return {
    inverseFieldId,
    inverseRelationshipType,
    sourceEntityDefinitionId,
    targetEntityDefinitionId,
    sourceFieldId: field.id,
  }
}

// =============================================================================
// ROW CONVERSION
// =============================================================================

/**
 * Convert a FieldValue row to a TypedFieldValue.
 */
export function rowToTypedValue(row: FieldValueRow, fieldType: FieldType): TypedFieldValue {
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
      `[rowToTypedValue] Unknown fieldType: ${fieldType}. ` + `Cannot determine value storage type.`
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
        recordId:
          row.relatedEntityId && row.relatedEntityDefinitionId
            ? toRecordId(row.relatedEntityDefinitionId, row.relatedEntityId)
            : ('' as RecordId),
      }
    case 'actor':
      // Actor can be stored as actorId (for users) or relatedEntityId (for groups)
      if (row.actorId) {
        return {
          ...base,
          type: 'actor',
          actorType: 'user',
          id: row.actorId,
          actorId: toActorId('user', row.actorId),
        }
      } else if (row.relatedEntityId) {
        return {
          ...base,
          type: 'actor',
          actorType: 'group',
          id: row.relatedEntityId,
          actorId: toActorId('group', row.relatedEntityId),
        }
      }
      // Fallback for empty actor
      return { ...base, type: 'actor', actorType: 'user', id: '', actorId: '' as ActorId }
  }
}

/**
 * Convert database rows to TypedFieldValue(s).
 * Handles both single and multi-value fields.
 */
export function rowsToTypedValues(
  rows: FieldValueRow[],
  fieldType: FieldType,
  isMultiValue: boolean
): TypedFieldValue | TypedFieldValue[] | null {
  const typedValues = rows.map((row) => rowToTypedValue(row, fieldType))

  // Return single value for single-value fields, array for multi-value
  if (isMultiValue) {
    return typedValues
  }
  return typedValues[0] ?? null
}

/**
 * Validate that a typed value has actual content (not just defaults).
 */
export function isValidTypedValue(value: TypedFieldValue, fieldType: FieldType): boolean {
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
        'recordId' in value &&
        typeof (value as any).recordId === 'string'
      )
    case 'actor':
      return (
        value.type === 'actor' &&
        'actorType' in value &&
        'id' in value &&
        typeof (value as any).id === 'string'
      )
    default:
      return true
  }
}

/**
 * Validate that referenced entities/options exist.
 */
export function validateRowReferences(row: FieldValueRow, fieldType: FieldType): string[] {
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

  // Check for orphaned actor references
  if (valueType === 'actor') {
    // Actor must have either actorId (user) or relatedEntityId (group)
    if (!row.actorId && !row.relatedEntityId) {
      issues.push('Missing actor ID (neither actorId nor relatedEntityId set)')
    }
  }

  return issues
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate and convert raw value to TypedFieldValueInput using FieldValueValidator.
 * Each field type has dedicated Zod schema validation.
 * Throws descriptive error if validation fails.
 */
export async function validateAndConvertValue(
  ctx: FieldValueContext,
  value: unknown,
  fieldType: FieldType,
  field: CachedField
): Promise<TypedFieldValueInput | TypedFieldValueInput[] | null> {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null
  }

  // Handle arrays (for multi-value fields like MULTI_SELECT, TAGS, RELATIONSHIP)
  if (Array.isArray(value)) {
    const converted: TypedFieldValueInput[] = []
    for (const v of value) {
      const single = await validateSingleValue(ctx, v, fieldType)
      if (single !== null) {
        converted.push(single)
      }
    }

    return converted.length > 0 ? converted : null
  }

  // Single value
  return validateSingleValue(ctx, value, fieldType)
}

/**
 * Validate single value using appropriate Zod schema.
 * Each field type has its own validation logic.
 */
export async function validateSingleValue(
  ctx: FieldValueContext,
  value: unknown,
  fieldType: FieldType
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
      const result = ctx.validator.validateText(value)
      if (!result.success) throwValidationError(result)
      const textValue = result.data || ''
      return textValue === '' ? null : { type: 'text', value: textValue }
    }

    case 'EMAIL': {
      const result = ctx.validator.validateEmail(value)
      if (!result.success) throwValidationError(result)
      return { type: 'text', value: result.data || '' }
    }

    case 'URL': {
      const result = ctx.validator.validateUrl(value)
      if (!result.success) throwValidationError(result)
      return { type: 'text', value: result.data || '' }
    }

    case 'PHONE_INTL': {
      const result = ctx.validator.validatePhone(value)
      if (!result.success) throwValidationError(result)
      return { type: 'text', value: result.data || '' }
    }

    case 'NUMBER':
    case 'CURRENCY': {
      const result = ctx.validator.validateNumber(value)
      if (!result.success) throwValidationError(result)
      return { type: 'number', value: result.data ?? 0 }
    }

    case 'CHECKBOX': {
      const result = ctx.validator.validateBoolean(value)
      if (!result.success) throwValidationError(result)
      return { type: 'boolean', value: result.data ?? false }
    }

    case 'DATE':
    case 'DATETIME':
    case 'TIME': {
      const result = ctx.validator.validateDate(value)
      if (!result.success) throwValidationError(result)
      return { type: 'date', value: result.data || '' }
    }

    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
    case 'TAGS': {
      const result = ctx.validator.validateOption(value)
      if (!result.success) throwValidationError(result)
      return { type: 'option', optionId: result.data || '' }
    }

    case 'RELATIONSHIP': {
      // Parse and normalize relationship value to { recordId } format
      const structureResult = fieldValueSchemas.relationship.safeParse(value)
      if (!structureResult.success) throwValidationError(structureResult)

      const { recordId } = structureResult.data!
      const { entityInstanceId } = parseRecordId(recordId)

      // Check batch validation cache first (if preBatchValidateRelationships was called)
      if (ctx.batchRelationshipValidationCache.has(entityInstanceId)) {
        const validation = ctx.batchRelationshipValidationCache.get(entityInstanceId)!
        if (!validation.success) {
          throwValidationError({
            success: false,
            error: {
              issues: [
                {
                  message: validation.message || 'Relationship validation failed',
                  path: ['recordId'],
                },
              ],
            },
          })
        }
      } else {
        // Fall back to individual validation if batch wasn't called
        const result = await ctx.validator.validateRelationship(value, {
          db: ctx.db,
          organizationId: ctx.organizationId,
        })
        if (!result.success) throwValidationError(result)
      }

      return {
        type: 'relationship',
        recordId,
      }
    }

    case 'NAME': {
      const result = ctx.validator.validateNameJson(value)
      if (!result.success) throwValidationError(result)
      return { type: 'json', value: result.data || {} }
    }

    case 'ADDRESS_STRUCT': {
      const result = ctx.validator.validateAddressStructJson(value)
      if (!result.success) throwValidationError(result)
      return { type: 'json', value: result.data || {} }
    }

    case 'FILE': {
      if (typeof value === 'object' && value !== null) {
        const obj = value as { ref?: string }
        if (obj.ref && /^(asset|file):.+/.test(obj.ref)) {
          return { type: 'json', value: value as Record<string, unknown> }
        }
      }
      return null
    }

    case 'ACTOR': {
      // Actor field accepts ActorId string (e.g., "user:xxx" or "group:xxx") or { actorType, id }
      if (typeof value === 'string') {
        // Check if it's an ActorId format (e.g., "user:abc123" or "group:xyz789")
        if (isActorId(value)) {
          const { type: actorType, id } = parseActorId(value as ActorId)
          return { type: 'actor', actorType, id }
        }
        // Plain string without prefix - assume user type with raw ID
        return { type: 'actor', actorType: 'user', id: value }
      }
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>
        const actorType = (obj.actorType ?? obj.type ?? 'user') as 'user' | 'group'
        const id = obj.id as string
        if (!id) {
          throwValidationError({
            success: false,
            error: { issues: [{ message: 'Actor ID is required', path: ['id'] }] },
          })
        }
        // Parse id if it's in ActorId format (e.g., "user:abc123")
        if (isActorId(id)) {
          const parsed = parseActorId(id as ActorId)
          return { type: 'actor', actorType: parsed.type, id: parsed.id }
        }
        return { type: 'actor', actorType, id }
      }
      throwValidationError({
        success: false,
        error: { issues: [{ message: 'Invalid actor value', path: [] }] },
      })
      return null // unreachable but TypeScript needs it
    }

    case 'JSON': {
      const result = ctx.validator.validateJson(value)
      if (!result.success) throwValidationError(result)
      return { type: 'json', value: result.data || {} }
    }

    default: {
      const result = ctx.validator.validateJson(value)
      if (!result.success) throwValidationError(result)
      return { type: 'json', value: result.data || {} }
    }
  }
}

/**
 * Pre-validate all relationships in a batch for the current operation.
 * Call this before validating individual values to enable batch optimization.
 *
 * Accepts both new format (RecordId) and legacy format.
 */
export async function preBatchValidateRelationships(
  ctx: FieldValueContext,
  values: unknown[],
  fieldTypes: FieldType[]
): Promise<void> {
  // Collect all relationships from values - supports both new and legacy formats
  const relationships: Array<
    | RecordId
    | { relatedEntityId: string; relatedEntityDefinitionId: string }
    | { recordId: RecordId }
  > = []

  /** Helper to extract relationship value(s) from input */
  const extractRelationship = (v: unknown) => {
    if (!v) return
    // RecordId string
    if (typeof v === 'string' && isRecordId(v)) {
      relationships.push(v)
    }
    // New format: { recordId }
    else if (typeof v === 'object' && 'recordId' in v) {
      relationships.push(v as { recordId: RecordId })
    }
    // Legacy format: { relatedEntityId, relatedEntityDefinitionId }
    else if (typeof v === 'object' && 'relatedEntityId' in v) {
      relationships.push(v as { relatedEntityId: string; relatedEntityDefinitionId: string })
    }
  }

  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const fieldType = fieldTypes[i]

    if (fieldType !== 'RELATIONSHIP') continue

    if (Array.isArray(value)) {
      for (const v of value) {
        extractRelationship(v)
      }
    } else {
      extractRelationship(value)
    }
  }

  // Batch validate if we have relationships
  if (relationships.length > 0) {
    ctx.batchRelationshipValidationCache = await ctx.validator.batchValidateRelationships(
      relationships,
      { db: ctx.db, organizationId: ctx.organizationId }
    )
  }
}

// =============================================================================
// DISPLAY VALUE
// =============================================================================

/**
 * Fetch the displayName for a related entity instance.
 * Lightweight single-column query — used when a display field is a RELATIONSHIP type.
 */
export async function getRelatedDisplayName(
  db: Database,
  organizationId: string,
  recordId: RecordId
): Promise<string | null> {
  const { entityInstanceId } = parseRecordId(recordId)
  const row = await db.query.EntityInstance.findFirst({
    where: (ei, { eq: eqOp, and: andOp }) =>
      andOp(eqOp(ei.id, entityInstanceId), eqOp(ei.organizationId, organizationId)),
    columns: { displayName: true },
  })
  return row?.displayName ?? null
}

/**
 * Batch fetch displayNames for multiple related entity instances.
 * Returns a Map of entityInstanceId → displayName.
 */
export async function batchGetRelatedDisplayNames(
  db: Database,
  organizationId: string,
  recordIds: RecordId[]
): Promise<Map<string, string | null>> {
  if (recordIds.length === 0) return new Map()

  const instanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, instanceIds),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )

  const map = new Map<string, string | null>()
  for (const row of rows) {
    map.set(row.id, row.displayName)
  }
  return map
}

/**
 * Check if a field is a source field for a NAME-type primary display field.
 * If so, compose "firstName lastName" from the current value and the other source field.
 * Returns the composed display string, null to clear, or undefined if not applicable.
 */
async function resolveNameFieldDisplayValue(
  ctx: FieldValueContext,
  recordId: RecordId,
  entityDef: { primaryDisplayFieldId: string | null },
  field: CachedField,
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
): Promise<string | null | undefined> {
  if (!entityDef.primaryDisplayFieldId) return undefined

  const primaryField = await getField(ctx, entityDef.primaryDisplayFieldId)
  if (primaryField.type !== 'NAME') return undefined

  const nameOpts = (primaryField.options as Record<string, any>)?.name as
    | { firstNameFieldId?: string; lastNameFieldId?: string }
    | undefined
  if (!nameOpts?.firstNameFieldId || !nameOpts?.lastNameFieldId) return undefined

  const isFirstName = nameOpts.firstNameFieldId === field.id
  const isLastName = nameOpts.lastNameFieldId === field.id
  if (!isFirstName && !isLastName) return undefined

  // Extract the text value being set
  const currentText =
    value && !Array.isArray(value) && value.type === 'text' ? (value.value as string) || '' : ''

  // Fetch the other source field's current value
  const { entityInstanceId } = parseRecordId(recordId)
  const otherFieldId = isFirstName ? nameOpts.lastNameFieldId : nameOpts.firstNameFieldId
  const [otherRow] = await ctx.db
    .select({ valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, otherFieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .limit(1)
  const otherText = otherRow?.valueText || ''

  const firstName = isFirstName ? currentText : otherText
  const lastName = isLastName ? currentText : otherText

  return [firstName, lastName].filter(Boolean).join(' ').trim() || null
}

/**
 * Update EntityInstance display columns if field is a display field.
 * Handles primary (displayName), secondary (secondaryDisplayValue), and avatar (avatarUrl).
 */
export async function maybeUpdateDisplayValue(
  ctx: FieldValueContext,
  recordId: RecordId,
  field: CachedField,
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
): Promise<void> {
  const { entityInstanceId } = parseRecordId(recordId)
  const entityDef = field.entityDefinition
  if (!entityDef) return

  // Check which display field this is (if any)
  type DisplayColumn = 'displayName' | 'secondaryDisplayValue' | 'avatarUrl'
  let column: DisplayColumn | null = null

  if (entityDef.primaryDisplayFieldId === field.id) {
    column = 'displayName'
  } else if (entityDef.secondaryDisplayFieldId === field.id) {
    column = 'secondaryDisplayValue'
  } else if (entityDef.avatarFieldId === field.id) {
    column = 'avatarUrl'
  }

  // If no direct match, check if this field is a source for a NAME-type display field
  if (!column && entityDef.primaryDisplayFieldId) {
    const result = await resolveNameFieldDisplayValue(ctx, recordId, entityDef, field, value)
    if (result !== undefined) {
      await ctx.db
        .update(schema.EntityInstance)
        .set({ displayName: result })
        .where(
          and(
            eq(schema.EntityInstance.id, entityInstanceId),
            eq(schema.EntityInstance.organizationId, ctx.organizationId)
          )
        )
      await updateSearchText(ctx.db, entityInstanceId, ctx.organizationId)

      // Cascade to dependent entities
      const resource = await getCachedResource(ctx.organizationId, entityDef.id)
      const entityType = resource?.entityType ?? entityDef.id
      const deps = await getDisplayFieldDeps(ctx.organizationId, entityType)
      if (deps.length > 0) {
        await cascadeDependentDisplayNames(ctx, entityInstanceId, result, deps)
      }
      return
    }
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
    } else if (field.type === 'RELATIONSHIP') {
      // For RELATIONSHIP display fields, resolve the related entity's displayName
      const singleValue = Array.isArray(typedValue) ? typedValue[0] : typedValue
      if (singleValue && singleValue.type === 'relationship' && 'recordId' in singleValue) {
        const relRecordId = (singleValue as { recordId: RecordId }).recordId
        if (relRecordId) {
          displayValue = await getRelatedDisplayName(ctx.db, ctx.organizationId, relRecordId)
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
  await ctx.db
    .update(schema.EntityInstance)
    .set({ [column]: displayValue })
    .where(
      and(
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityInstance.organizationId, ctx.organizationId)
      )
    )

  // Update searchText when primary or secondary display field changes
  if (column === 'displayName' || column === 'secondaryDisplayValue') {
    await updateSearchText(ctx.db, entityInstanceId, ctx.organizationId)

    // Cascade to dependent entities (e.g., when a part's title changes, update subpart displayNames)
    const resource = await getCachedResource(ctx.organizationId, entityDef.id)
    const entityType = resource?.entityType ?? entityDef.id
    const deps = await getDisplayFieldDeps(ctx.organizationId, entityType)
    if (deps.length > 0) {
      await cascadeDependentDisplayNames(ctx, entityInstanceId, displayValue, deps)
    }
  }
}

/**
 * Update searchText on EntityInstance by concatenating displayName and secondaryDisplayValue.
 * Called when primary or secondary display field values change.
 */
export async function updateSearchText(
  db: Database,
  entityInstanceId: string,
  organizationId: string
): Promise<void> {
  await db.execute(sql`
    UPDATE "EntityInstance"
    SET "searchText" = TRIM(CONCAT_WS(' ', "displayName", "secondaryDisplayValue"))
    WHERE id = ${entityInstanceId}
      AND "organizationId" = ${organizationId}
  `)
}

// =============================================================================
// FIELD TYPE MAP
// =============================================================================

/**
 * Build a Map of fieldId -> FieldType using ResourceRegistryService cache.
 * Handles both system resources (e.g., 'contact') and custom entity resources.
 */
export async function getFieldTypeMapByDefinition(
  registryService: ResourceRegistryService,
  entityDefinitionId: string,
  fieldIds: string[]
): Promise<Map<string, FieldType>> {
  // Fetch resource using service cache (entityDefinitionId works for both system and custom)
  const resource = await registryService.getById(entityDefinitionId)
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

// =============================================================================
// FIELD PATH VALIDATION
// =============================================================================

/** Maximum allowed path depth to prevent infinite loops */
const MAX_PATH_DEPTH = 5

/**
 * Validate all field references before fetching.
 * Throws descriptive errors for invalid paths.
 */
export async function validateFieldReferences(
  organizationId: string,
  fieldReferences: FieldReference[]
): Promise<void> {
  for (const ref of fieldReferences) {
    const path = isFieldPath(ref) ? ref : [ref]

    // Enforce max depth limit
    if (path.length > MAX_PATH_DEPTH) {
      throw new Error(`Path exceeds maximum depth of ${MAX_PATH_DEPTH} hops (got ${path.length})`)
    }

    for (let i = 0; i < path.length; i++) {
      const { entityDefinitionId, fieldId } = parseResourceFieldId(path[i])
      const resource = await findCachedResource(organizationId, entityDefinitionId)

      if (!resource) {
        throw new Error(`Entity "${entityDefinitionId}" not found`)
      }

      const field = resource.fields.find((f) => f.id === fieldId || f.key === fieldId)
      if (!field) {
        throw new Error(`Field "${fieldId}" not found in "${entityDefinitionId}"`)
      }

      // All but last hop must be relationship fields
      if (i < path.length - 1 && field.fieldType !== FieldTypeEnum.RELATIONSHIP) {
        throw new Error(
          `Field "${fieldId}" in "${entityDefinitionId}" is not a relationship (step ${i + 1} of path)`
        )
      }
    }
  }
}

/**
 * Get field type from org cache for a specific field.
 */
export async function getFieldTypeFromRegistry(
  organizationId: string,
  entityDefinitionId: string,
  fieldId: string
): Promise<FieldType> {
  const info = await getFieldInfoFromRegistry(organizationId, entityDefinitionId, fieldId)
  return info.fieldType
}

/**
 * Get field type and options from org cache for a specific field.
 * Used by the record field cache to store formatting metadata alongside typed values.
 */
export async function getFieldInfoFromRegistry(
  organizationId: string,
  entityDefinitionId: string,
  fieldId: string
): Promise<{ fieldType: FieldType; fieldOptions?: FieldOptions }> {
  const resource = await findCachedResource(organizationId, entityDefinitionId)
  if (!resource) {
    throw new Error(`Entity "${entityDefinitionId}" not found`)
  }

  const field = resource.fields.find((f) => f.id === fieldId || f.key === fieldId)
  if (!field || !field.fieldType) {
    throw new Error(`Field "${fieldId}" not found or missing fieldType`)
  }

  return { fieldType: field.fieldType, fieldOptions: field.options }
}
