// packages/lib/src/field-values/field-value-helpers.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import {
  getValueType,
  isMultiValueFieldType,
  type TypedFieldValue,
  type TypedFieldValueInput,
} from '@auxx/types'
import {
  type ActorId,
  type ActorIdType,
  isActorId,
  parseActorId,
  toActorId,
} from '@auxx/types/actor'
import {
  getInverseFieldId,
  type RelationshipConfig,
  type RelationshipType,
} from '@auxx/types/custom-field'
import {
  type FieldPath,
  getFieldId,
  isFieldPath,
  isResourceFieldId,
  parseResourceFieldId,
} from '@auxx/types/field'
import {
  type ActorFieldValue,
  type FieldValueMeta,
  mergeMeta,
  readEnvelope,
} from '@auxx/types/field-value'
import { isEntityDefinitionType, type RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { findCachedResource, getCachedEntityDefId, getCachedResource, getOrgCache } from '../cache'
import type { FieldOptions } from '../custom-fields/field-options'
import { BadRequestError } from '../errors'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import { getRealtimeService, rooms } from '../realtime'
import type { ResourceRegistryService } from '../resources/registry/resource-registry-service'
import { isRecordId, parseRecordId, toRecordId } from '../resources/resource-id'
import { cascadeDependentDisplayNames, getDisplayFieldDeps } from './display-field-deps'
import { FieldValueValidator, fieldValueSchemas } from './field-value-validator'
import { formatToDisplayValue } from './formatter'
import { getOrgCurrencyCode, withOrgCurrency } from './org-currency'
import { MAX_MULTI_VALUES, primaryValue } from './primary-value'
import type { InverseFieldInfo } from './relationship-sync'
import { isSearchTextIndexedFieldType, updateSearchText } from './search-text'
import { toFieldType } from './stored-field-type'
import type { CachedField, FieldReference, FieldValueRow } from './types'

// Re-export for convenience
export type { InverseFieldInfo, CachedField }

// =============================================================================
// CONTEXT INTERFACE
// =============================================================================

/**
 * Shared context for field value operations.
 * Passed to all mutation and query functions for dependency injection.
 */
export interface FieldValueContext {
  /**
   * Accepts a `Transaction` as well as the pooled `Database` — callers such as
   * `resources/merge/merge-service.ts` run field-value writes inside a transaction,
   * and `setBulkValues`/`addValues` rebuild this context around their own `tx`.
   * The two differ only by `$client` (`Connection = NodePgDatabase & { $client }`),
   * which nothing reachable from this context touches.
   */
  db: Database | Transaction
  organizationId: string
  userId?: string
  /** Pusher socket ID of the originating client — used for self-event exclusion in realtime sync. */
  socketId?: string
  /** Cache for CustomField lookups (keyed by fieldId) */
  fieldCache: Map<string, CachedField>
  /** Cache for batch relationship validations (keyed by relatedEntityId) */
  batchRelationshipValidationCache: Map<string, { success: boolean; message?: string }>
  /** Cache for entityType → EntityDefinition UUID (keyed by system entityType string) */
  entityDefIdCache?: Map<string, string>
  /** Shared validator instance (stateless, reusable) */
  validator: FieldValueValidator
  /**
   * Set of systemAttributes the caller is authorized to write even if a
   * registered pre-hook would normally drop or reject them. Used by trusted
   * code paths (e.g. the seeder setting `is_system_tag = true` on system
   * records). Empty set by default — user/API requests have no bypass.
   */
  bypassFieldGuards: ReadonlySet<SystemAttribute>
  /**
   * When `true`, suppresses per-field pre-hook invocation inside
   * `setValueWithBuiltIn`. Set by the bulk path (`setBulkValues`) after it
   * has run pre-hooks once across the batched fan-out, so individual writes
   * don't re-fire the hooks.
   */
  skipPreHooks?: boolean
  /**
   * Request-scoped entity-def read enforcement (capability layer v2 §2.2).
   * Present ⇒ `batchGetValues` drops anchors and traversal refs on defs the
   * member can't view. Absent ⇒ no enforcement (internal/system callers).
   *
   * Typed as the {@link CapabilityView} gate surface, not the concrete
   * `CapabilitySet`: both consumers here call only `canViewEntity`, and an
   * agent run reaches this path holding a `MinCapabilitySet`. Narrowing it
   * back would force a cast at every non-request caller.
   */
  capabilities?: CapabilityView
}

// =============================================================================
// CONTEXT FACTORY
// =============================================================================

/** Optional extras for `createFieldValueContext`. */
export interface CreateFieldValueContextOptions {
  bypassFieldGuards?: ReadonlySet<SystemAttribute>
  skipPreHooks?: boolean
  capabilities?: CapabilityView
}

const EMPTY_BYPASS: ReadonlySet<SystemAttribute> = new Set()

/**
 * Create a new FieldValueContext.
 */
export function createFieldValueContext(
  organizationId: string,
  userId?: string,
  db: Database | Transaction = database,
  socketId?: string,
  options: CreateFieldValueContextOptions = {}
): FieldValueContext {
  return {
    db,
    organizationId,
    userId,
    socketId,
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: new FieldValueValidator(),
    bypassFieldGuards: options.bypassFieldGuards ?? EMPTY_BYPASS,
    skipPreHooks: options.skipPreHooks,
    capabilities: options.capabilities,
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
 * Normalize any field identifier accepted at API boundaries to a real FieldId.
 *
 * Three input forms are accepted:
 *   1. `FieldId` (UUID for custom fields, key for system fields) — pass through
 *   2. `systemAttribute` (e.g. `'primary_email'`) — looked up via the map
 *   3. `ResourceFieldId` (`entityDefinitionId:fieldId`) — prefix dropped
 *
 * The recordIds on the same request already scope the entity definition, so
 * the prefix in form (3) is redundant. Forms (2) and (3) are normalized to (1)
 * before downstream lookup.
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
    // (3) ResourceFieldId → short FieldId
    let fieldId = v.fieldId
    if (isResourceFieldId(fieldId)) {
      fieldId = getFieldId(fieldId)
      changed = true
    }
    // (2) systemAttribute → real FieldId
    const realId = attrToId.get(fieldId)
    if (realId) {
      changed = true
      return { ...v, fieldId: realId }
    }
    return fieldId !== v.fieldId ? { ...v, fieldId } : v
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

  // `CustomField.entityDefinitionId` is nullable — table-backed system resources carry
  // none. Both halves are needed to build the RecordIds the inverse rows are written
  // under, so a field missing one has no inverse to sync.
  if (!sourceEntityDefinitionId || !targetEntityDefinitionId) return null

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
// RELATIONSHIP RECORDID CANONICALIZATION
// =============================================================================

/**
 * Canonicalize the entityDefinitionId prefix of a relationship RecordId.
 *
 * If the prefix is a system entity type string (e.g. `"contact"`), resolve it
 * to the org's EntityDefinition UUID via the org cache. If the prefix is
 * already a UUID, return unchanged. If the cache lookup fails, return the
 * input unchanged (fail soft — downstream validator treats missing related
 * entities as soft errors).
 *
 * Memoized per-`ctx` so a batch of N relationship values targeting the same
 * system type costs one cache lookup.
 */
export async function canonicalizeRelationshipRecordId(
  ctx: FieldValueContext,
  recordId: RecordId
): Promise<RecordId> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!isEntityDefinitionType(entityDefinitionId)) return recordId

  const cache = (ctx.entityDefIdCache ??= new Map())
  let resolved = cache.get(entityDefinitionId)
  if (!resolved) {
    const looked = await getCachedEntityDefId(ctx.organizationId, entityDefinitionId)
    if (!looked) return recordId
    cache.set(entityDefinitionId, looked)
    resolved = looked
  }
  return toRecordId(resolved, entityInstanceId)
}

/**
 * Canonicalize relationship RecordIds inside a TypedFieldValueInput (or array).
 * Non-relationship values and arrays of them pass through unchanged.
 */
export async function canonicalizeRelationshipValue(
  ctx: FieldValueContext,
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
): Promise<TypedFieldValueInput | TypedFieldValueInput[] | null> {
  if (value === null) return null
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => canonicalizeOneTypedInput(ctx, v)))
  }
  return canonicalizeOneTypedInput(ctx, value)
}

async function canonicalizeOneTypedInput(
  ctx: FieldValueContext,
  value: TypedFieldValueInput
): Promise<TypedFieldValueInput> {
  if (value.type !== 'relationship') return value
  const canonical = await canonicalizeRelationshipRecordId(ctx, value.recordId)
  return canonical === value.recordId ? value : { ...value, recordId: canonical }
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
    case 'number': {
      // CURRENCY is NUMBER's shape exactly: an integer minor-unit amount in
      // `valueNumber`. The denomination is the field's, resolved at the render
      // site from `options.currencyCode` — a value never carries its own.
      return { ...base, type: 'number', value: row.valueNumber ?? 0 }
    }
    case 'boolean':
      return { ...base, type: 'boolean', value: row.valueBoolean ?? false }
    case 'date':
      return { ...base, type: 'date', value: row.valueDate ?? '' }
    case 'json':
      return {
        ...base,
        type: 'json',
        value: (readEnvelope(row.valueJson).v as Record<string, unknown>) ?? {},
      }
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
      // Actor storage: actorId column for users + agents (agents marked by
      // relatedEntityDefinitionId='agent'); relatedEntityId for groups + dispatch workers
      // (workers marked by relatedEntityDefinitionId='worker', since a DispatchWorker.id can't
      // live in actorId — that column FKs User.id).
      if (row.actorId) {
        if (row.relatedEntityDefinitionId === 'agent') {
          return {
            ...base,
            type: 'actor',
            actorType: 'agent',
            id: row.actorId,
            actorId: toActorId('agent', row.actorId),
          }
        }
        return {
          ...base,
          type: 'actor',
          actorType: 'user',
          id: row.actorId,
          actorId: toActorId('user', row.actorId),
        }
      } else if (row.relatedEntityId) {
        if (row.relatedEntityDefinitionId === 'worker') {
          return {
            ...base,
            type: 'actor',
            actorType: 'worker',
            id: row.relatedEntityId,
            actorId: toActorId('worker', row.relatedEntityId),
          }
        }
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
    case 'computed':
      // CALC is the only `computed` field type and it is never persisted, so a
      // FieldValue row can't carry one — and `TypedFieldValue` has no arm for it.
      // Reaching here means a caller invented a row for a computed field.
      throw new Error(
        `[rowToTypedValue] Field type ${fieldType} is computed and has no stored value.`
      )
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
 * Reduce a typed field value (or array/null) to the flat scalar space that
 * `extractFieldValueScalar` (field-value-scalar.ts) produces — text/number/boolean/date/json
 * → `.value`, option → `optionId`, relationship → `recordId`, actor → `actorId`. Keeps
 * captured OLD values (from `batchGetExistingFieldValues`) comparable with the raw NEW
 * values a bulk writer holds, so transition matching + condition evaluation on a
 * manifest behave like the interactive path (B2 plan — manifest value space).
 */
export function flattenTypedFieldValue(
  value: TypedFieldValue | TypedFieldValue[] | null | undefined
): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((v) => flattenTypedFieldValue(v))
  switch (value.type) {
    case 'text':
    case 'number':
    case 'boolean':
    case 'date':
    case 'json':
      return value.value
    case 'option':
      return value.optionId
    case 'relationship':
      return value.recordId
    case 'actor':
      return value.actorId
    default:
      return null
  }
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

  // Handle arrays (for multi-value fields like MULTI_SELECT, TAGS, RELATIONSHIP,
  // or any scalar field flagged with options.multi = true)
  if (Array.isArray(value)) {
    const fieldOptions = field.options as
      | { actor?: { multiple?: boolean }; multi?: boolean }
      | undefined
    const isMulti = isMultiValueFieldType(fieldType, fieldOptions)

    // Cardinality guard: reject arrays of length > 1 on single-value fields.
    // Without this check, `setValueWithType` would DELETE+INSERT one row per
    // element and the entity would silently end up with multiple FieldValue
    // rows under a (entityId, fieldId) that the read path expects to be
    // scalar — hydrated as an array, surprising every downstream consumer.
    if (!isMulti && value.length > 1) {
      throw new BadRequestError(
        `Field ${field.id} (${fieldType}) is single-value; received ${value.length} values`
      )
    }

    // Auto-unwrap length-1 arrays on single-value fields so callers that
    // uniformly wrap values in arrays (for shape consistency) keep working.
    if (!isMulti) {
      if (value.length === 0) return null
      return validateSingleValue(ctx, value[0], fieldType)
    }

    const converted: TypedFieldValueInput[] = []
    for (const v of value) {
      const single = await validateSingleValue(ctx, v, fieldType)
      if (single !== null) {
        converted.push(single)
      }
    }

    // Value cap: bounds the multi-value injection vector and the UI.
    if (converted.length > MAX_MULTI_VALUES) {
      throw new BadRequestError(
        `Field ${field.id} accepts at most ${MAX_MULTI_VALUES} values; received ${converted.length}`
      )
    }

    return converted.length > 0 ? converted : null
  }

  // Single value
  return validateSingleValue(ctx, value, fieldType)
}

/**
 * Narrow an `ActorId` prefix to the kinds an ACTOR field value can hold.
 *
 * `ActorIdType` also carries `profile:`, which addresses a `PermissionProfile` as an
 * additive ResourceAccess grantee — never a record value. `ActorFieldValue.actorType`
 * and its zod schema both list four kinds, so a `profile:` id is rejected here rather
 * than converted into an `actorType` the validator would refuse one step later.
 */
function toActorFieldType(type: ActorIdType): ActorFieldValue['actorType'] {
  if (type === 'profile') {
    throw new BadRequestError('Actor fields cannot reference a permission profile')
  }
  return type
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

    case 'NUMBER': {
      const result = ctx.validator.validateNumber(value)
      if (!result.success) throwValidationError(result)
      return { type: 'number', value: result.data ?? 0 }
    }

    /**
     * CURRENCY does NOT fall through to NUMBER: it is the only field type whose
     * stored number has a declared UNIT, so it is the only one that can assert
     * a decidable integrality check on the way in.
     *
     * 🛑 Never converts units. Given `600` it cannot know whether that is $6.00
     * or $600 — the undecidable guess that produced 100×-wrong stored data. A
     * provider reporting decimal major units converts in its own projection.
     *
     * Any currency code on the input is IGNORED. The denomination is the
     * field's; see `FieldOptions.currencyCode`.
     */
    case 'CURRENCY': {
      let amount: unknown = value

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>
        if (!('type' in obj)) amount = obj.amount ?? obj.value
      }

      const result = ctx.validator.validateNumber(amount)
      if (!result.success) throwValidationError(result)
      const num = result.data ?? 0

      // A fractional value in a minor-units field is ALWAYS wrong — cents, yen
      // and thousandths of a dinar are integers for every ISO currency. This is
      // decidable, unlike dollars-vs-cents on a whole number, and it is the
      // single check that would have caught the connector passthrough bug at
      // the first sync instead of months later.
      if (!Number.isInteger(num)) {
        throw new BadRequestError(
          `CURRENCY values are integer minor units (cents for USD), but received ${num}. ` +
            'A provider reporting decimal major units must scale in its own projection.'
        )
      }

      return { type: 'number', value: num }
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
          return { type: 'actor', actorType: toActorFieldType(actorType), id }
        }
        // Plain string without prefix - assume user type with raw ID
        return { type: 'actor', actorType: 'user', id: value }
      }
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>
        const actorType = (obj.actorType ?? obj.type ?? 'user') as 'user' | 'group' | 'agent'
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
          return { type: 'actor', actorType: toActorFieldType(parsed.type), id: parsed.id }
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
  db: Database | Transaction,
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
  db: Database | Transaction,
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
 * Publish a `record:updated` realtime event carrying just the denormalized
 * column(s) that changed, on the def's own record channel (plan v3/03 §8.1).
 * Matches RecordUpdatedEvent's intended contract: "denormalized columns
 * changed". Excludes the originating socket.
 */
async function publishRecordColumnUpdate(
  ctx: FieldValueContext,
  entityDefId: string,
  entityInstanceId: string,
  columns: {
    displayName?: string | null
    secondaryDisplayValue?: string | null
    avatarUrl?: string | null
  }
): Promise<void> {
  try {
    const recordId = toRecordId(entityDefId, entityInstanceId)
    getRealtimeService()
      .publish(
        rooms.orgRecords(ctx.organizationId, entityDefId),
        'record:updated',
        {
          entityDefinitionId: entityDefId,
          record: {
            id: entityInstanceId,
            recordId,
            ...columns,
            updatedAt: new Date().toISOString(),
          },
        },
        { excludeSocketId: ctx.socketId }
      )
      .catch(() => {})
  } catch {
    // non-critical — realtime push is best-effort
  }
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
      await publishRecordColumnUpdate(ctx, entityDef.id, entityInstanceId, {
        displayName: result,
      })
      return
    }
  }

  if (!column) {
    // Not a display field — but its value may still be part of the search
    // corpus (`search-text.ts`). Refreshing here is what lets a query name a
    // company, a city or a status the record was never *titled* with.
    if (isSearchTextIndexedFieldType(field.type)) {
      await updateSearchText(ctx.db, entityInstanceId, ctx.organizationId)
    }
    return
  }

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

    // For avatar fields, extract URL directly, queue thumbnail for FILE refs,
    // or encode non-URL text values into the polymorphic visual-ref grammar
    // (e.g. inbox_color → 'color:indigo'). See encodeAvatarRef below.
    if (column === 'avatarUrl') {
      const singleValue = Array.isArray(typedValue) ? typedValue[0] : typedValue
      if (singleValue) {
        if (singleValue.type === 'json') {
          const json = singleValue.value as Record<string, unknown>
          if (typeof json?.url === 'string') {
            displayValue = json.url
          } else if (typeof json?.ref === 'string') {
            // FILE field: { ref: "asset:abc123" } — queue avatar thumbnail
            const assetId = (json.ref as string).match(/^asset:(.+)$/)?.[1]
            if (assetId) {
              // Set null interim — thumbnail callback will set the CDN URL
              displayValue = null
              // Fire-and-forget: queue thumbnail generation in background
              void queueAvatarThumbnail(ctx.organizationId, ctx.userId, assetId)
            }
          }
        } else if (singleValue.type === 'text') {
          const raw = singleValue.value
          displayValue = raw ? encodeAvatarRef(field, raw) : null
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
      // Use centralized formatter for display value computation. Multi-value
      // fields render their PRIMARY (first) value — `formatToDisplayValue`
      // maps over arrays, and writing that array into the display column
      // would corrupt `displayName`/`secondaryDisplayValue`.
      const primaryTyped = primaryValue(typedValue)
      // `withOrgCurrency` layers the org rung under a CURRENCY field that never
      // picked its own code, so the persisted display value follows
      // `organization.currency`. A no-op for every other field type.
      const options =
        field.type === 'CURRENCY'
          ? withOrgCurrency(
              field.options as never,
              'CURRENCY',
              await getOrgCurrencyCode(ctx.organizationId, ctx.db)
            )
          : (field.options as never)
      displayValue = primaryTyped
        ? (formatToDisplayValue(primaryTyped, toFieldType(field.type), options as any) as
            | string
            | null)
        : null
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

  await publishRecordColumnUpdate(ctx, entityDef.id, entityInstanceId, { [column]: displayValue })
}

// =============================================================================
// AVATAR REF ENCODING
// =============================================================================

/**
 * True when `s` already conforms to the visual-ref grammar (URL, encoded URL,
 * base64, color, or icon). Keeps `encodeAvatarRef` idempotent — backfill
 * writes `'color:indigo'` directly; subsequent field writes must not re-wrap
 * it as `'color:color:indigo'`.
 */
function looksLikeEncodedRef(s: string): boolean {
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('url:') ||
    s.startsWith('base64:') ||
    s.startsWith('color:') ||
    s.startsWith('icon:')
  )
}

/**
 * Encode a non-URL avatar source as a polymorphic visual-ref. Today the only
 * case is a plain color name from a TEXT field wired as `avatarFieldId`
 * (e.g. inbox_color). Extend here when user-configurable entities add emoji or
 * icon avatar sources.
 */
function encodeAvatarRef(field: CachedField, rawText: string): string {
  if (field.type === 'URL') return rawText
  if (looksLikeEncodedRef(rawText)) return rawText
  return `color:${rawText}`
}

// =============================================================================
// AVATAR THUMBNAIL HELPERS
// =============================================================================

/**
 * Queue avatar thumbnail generation for a FILE field asset.
 * Fire-and-forget — the thumbnail job callback will update EntityInstance.avatarUrl.
 */
async function queueAvatarThumbnail(
  organizationId: string,
  userId: string | undefined,
  assetId: string
): Promise<void> {
  try {
    const { ensureThumbnailPresets } = await import('../files/core/thumbnail-batch')
    await ensureThumbnailPresets({
      organizationId,
      userId: userId ?? 'system',
      source: { type: 'asset', assetId },
      presets: ['avatar-128'],
      defaultOptions: { queue: true, visibility: 'PUBLIC' },
    })
  } catch (error) {
    // Non-critical — avatar will show fallback icon until retry
    console.warn('[avatar] Failed to queue avatar thumbnail', { assetId, error })
  }
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
 * Normalize a {@link FieldReference} into a {@link FieldPath}.
 *
 * `FieldReference` also admits a bare `FieldId` — a field cuid with no
 * entity-definition half — but every consumer of the normalized path immediately
 * calls `parseResourceFieldId`, which for a colon-less string `console.error`s and
 * returns `{ entityDefinitionId: <the whole id>, fieldId: '' }`. That resolves the
 * reference against an entity that cannot exist instead of failing, so unqualified
 * references are rejected here with a message that names the actual problem.
 */
export function normalizeFieldReference(ref: FieldReference): FieldPath {
  if (isFieldPath(ref)) return ref
  if (!isResourceFieldId(ref)) {
    throw new BadRequestError(
      `Field reference "${ref}" is not entity-qualified — expected "<entityDefinitionId>:<fieldId>"`
    )
  }
  return [ref]
}

/**
 * Validate all field references before fetching.
 * Throws descriptive errors for invalid paths.
 */
export async function validateFieldReferences(
  organizationId: string,
  fieldReferences: FieldReference[]
): Promise<void> {
  for (const ref of fieldReferences) {
    const path = normalizeFieldReference(ref)

    // Enforce max depth limit
    if (path.length > MAX_PATH_DEPTH) {
      throw new Error(`Path exceeds maximum depth of ${MAX_PATH_DEPTH} hops (got ${path.length})`)
    }

    for (const [i, step] of path.entries()) {
      const { entityDefinitionId, fieldId } = parseResourceFieldId(step)
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
): Promise<{ fieldId: string; fieldType: FieldType; fieldOptions?: FieldOptions }> {
  const resource = await findCachedResource(organizationId, entityDefinitionId)
  if (!resource) {
    console.error('[getFieldInfoFromRegistry] entity not found', {
      organizationId,
      entityDefinitionId,
      fieldId,
    })
    throw new Error(`Entity "${entityDefinitionId}" not found`)
  }

  const field = resource.fields.find((f) => f.id === fieldId || f.key === fieldId)
  if (!field) {
    console.error('[getFieldInfoFromRegistry] field not found on resource', {
      entityDefinitionId,
      fieldId,
      resourceId: resource.id,
      resourceApiSlug: resource.apiSlug,
      resourceEntityType: resource.entityType,
      availableFieldKeys: resource.fields.map((f) => f.key),
    })
    throw new Error(`Field "${fieldId}" not found on entity "${entityDefinitionId}"`)
  }
  if (!field.fieldType) {
    console.error('[getFieldInfoFromRegistry] field missing fieldType', {
      entityDefinitionId,
      fieldId,
      resourceId: resource.id,
      resourceEntityType: resource.entityType,
      fieldKey: field.key,
      fieldType: field.fieldType,
      fieldBaseType: field.type,
      fieldIsSystem: field.isSystem,
    })
    throw new Error(`Field "${fieldId}" missing fieldType on entity "${entityDefinitionId}"`)
  }

  // Return the canonical field id (`field.id`) — the DB CustomField row id for
  // system fields. Callers key FieldValue queries / maps by this so a static-form
  // ref (e.g. `contact:firstName`) resolves to the same id values are stored under.
  return { fieldId: field.id, fieldType: field.fieldType, fieldOptions: field.options }
}
