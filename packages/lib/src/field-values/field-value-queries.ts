// packages/lib/src/field-values/field-value-queries.ts

import { schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { getValueType, isArrayReturnFieldType, type TypedFieldValue } from '@auxx/types'
import {
  type FieldPath,
  type FieldReference,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import { findCachedResource } from '../cache'
import type { FieldOptions, NameFieldOptions } from '../custom-fields/field-options'
import { rungsAtOrAbove } from '../permissions/capabilities/record-visibility-scope'
import type { AiStatus } from '../realtime/events'
import {
  resolveResourceAccessGrantees,
  resourceAccessGranteeConditions,
} from '../resource-access/grantee-resolution'
import type { TableId } from '../resources/registry/field-registry'
import { isSystemResourceId } from '../resources/registry/types'
import { parseRecordId, toRecordId } from '../resources/resource-id'
import { readAiMetadata } from './ai-commit'
import {
  type CachedField,
  type FieldValueContext,
  getField,
  getFieldInfoFromRegistry,
  normalizeFieldReference,
  rowsToTypedValues,
  rowToTypedValue,
  validateFieldReferences,
} from './field-value-helpers'
import { resolveMailHostGate, resolveMailLensGate } from './mail-lens-gate'
import {
  batchFetchSystemRelationships,
  isVirtualField,
  resolveEntityInstanceFields,
  resolveSystemTableFields,
  resolveVirtualFields,
  type SystemFieldDescriptor,
} from './resolvers'
import { toFieldType } from './stored-field-type'
import type {
  BatchFieldValueResult,
  BatchGetValuesInput,
  FieldValueRow,
  GetValueInput,
  GetValuesInput,
  TypedFieldValueResult,
} from './types'

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get a single field value for an entity.
 * Returns TypedFieldValue for single-value fields, TypedFieldValue[] for multi-value fields, or null.
 *
 * @param ctx - Field value context
 * @param params.recordId - RecordId of the entity (e.g. "contact:abc123")
 * @param params.fieldId - UUID of the field
 * @param cachedField - Optional pre-fetched CachedField to avoid lookup
 * @returns TypedFieldValue | TypedFieldValue[] | null
 *
 * @example
 * const email = await getValue(ctx, { recordId: "contact:abc123", fieldId: "field-email" })
 */
export async function getValue(
  ctx: FieldValueContext,
  params: GetValueInput,
  cachedField?: CachedField
): Promise<TypedFieldValue | TypedFieldValue[] | null> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  // MAIL enforcement — the single-host twin of the gate `batchGetValues` applies
  // (see {@link resolveMailHostGate}). `thread` / `message` are
  // `NON_RECORD_DEF_SLUGS`, so the def-presence test this path's siblings rely on
  // passes them for every member. `null` is already this function's "no value"
  // answer, so a withheld host or field blanks rather than throws — every caller
  // (the mutation re-reads, the geocoding stale-write guard, the dispatch and
  // money readers) already handles it. Non-mail hosts short-circuit with no I/O.
  const mailGate = await resolveMailHostGate(ctx, params.recordId)
  if (mailGate && (mailGate.hidden || !mailGate.admitsField(params.fieldId))) return null

  // Use cached field if provided (avoids redundant CustomField join)
  const field = cachedField ?? (await getField(ctx, params.fieldId))

  const rows = await ctx.db
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, params.fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  return shapeStoredRowsAsValue(field, rows as unknown as FieldValueRow[])
}

/**
 * `getValue`'s exact result shaping over already-loaded stored rows: `null`
 * for no rows, a scalar for single-value fields, an array for array-return
 * fields. THE single shaping seam — `getValue` and the derived-oldValue path
 * both go through it, so they cannot drift.
 */
export function shapeStoredRowsAsValue(
  field: CachedField,
  rows: FieldValueRow[]
): TypedFieldValue | TypedFieldValue[] | null {
  if (rows.length === 0) return null
  return rowsToTypedValues(
    rows,
    toFieldType(field.type),
    isArrayReturnFieldType(field.type, field.options as FieldOptions | undefined)
  )
}

/**
 * What `getValue(ctx, { recordId, fieldId })` would return, derived from
 * rows the caller already holds (the set path's idempotency-guard load) —
 * saves the re-SELECT while preserving BOTH getValue behaviors the raw rows
 * lack: the mail-host gate (a withheld host or field answers `null`, never
 * the stored rows) and the scalar/array result shaping.
 */
export async function getValueFromStoredRows(
  ctx: FieldValueContext,
  recordId: RecordId,
  fieldId: string,
  field: CachedField,
  rows: FieldValueRow[]
): Promise<TypedFieldValue | TypedFieldValue[] | null> {
  const mailGate = await resolveMailHostGate(ctx, recordId)
  if (mailGate && (mailGate.hidden || !mailGate.admitsField(fieldId))) return null
  return shapeStoredRowsAsValue(field, rows)
}

/**
 * Get multiple field values for an entity in a single efficient query.
 * Returns Map keyed by fieldId. Use this instead of calling getValue() multiple times.
 * Single DB join of FieldValue + CustomField avoids N+1 queries.
 *
 * @param ctx - Field value context
 * @param params.recordId - RecordId of the entity (e.g. "contact:abc123")
 * @param params.fieldIds - Optional array of field UUIDs (omit to get all fields)
 * @returns Map<fieldId, TypedFieldValue | TypedFieldValue[]>
 *
 * @example
 * const values = await getValues(ctx, {
 *   recordId: "contact:abc123",
 *   fieldIds: ["field-email", "field-phone"]
 * })
 * const email = values.get("field-email")
 */
export async function getValues(
  ctx: FieldValueContext,
  params: GetValuesInput
): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  // MAIL enforcement — see {@link getValue}. `params.fieldIds` is optional, so
  // this path can be asked for EVERY field a thread has; the per-field test runs
  // over the grouped results below rather than over the request. An empty Map is
  // already the legal "nothing stored" answer, so a withheld host blanks.
  const mailGate = await resolveMailHostGate(ctx, params.recordId)
  if (mailGate?.hidden) return new Map()

  const query = ctx.db
    .select()
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.organizationId, ctx.organizationId),
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
    // FIELD visibility: drop values above the viewer's lens on this thread.
    if (mailGate && !mailGate.admitsField(fieldId)) continue
    const fieldType = fieldRows[0]!.CustomField.type as FieldType
    const fieldOptions = fieldRows[0]!.CustomField.options as FieldOptions | undefined
    const fieldValueRows = fieldRows.map((r) => r.FieldValue as unknown as FieldValueRow)
    const typedValues = rowsToTypedValues(
      fieldValueRows,
      fieldType,
      isArrayReturnFieldType(fieldType, fieldOptions)
    )
    if (typedValues !== null) {
      result.set(fieldId, typedValues)
    }
  }

  return result
}

/**
 * Get field values for multiple entities.
 * Handles both direct fields (ResourceFieldId) and relationship paths (FieldPath).
 *
 * For paths like ["product:vendor", "vendor:name"]:
 * 1. Fetch product:vendor relationships for all products
 * 2. Collect all vendor IDs from step 1
 * 3. Fetch vendor:name for all vendors
 * 4. Map results back to source products
 *
 * Query count = max path depth (e.g., depth 2 = 2 queries, regardless of record count)
 *
 * @param ctx - Field value context
 * @param registryService - Resource registry service for field type lookups
 * @param params - The BatchGetValuesInput object
 * @param params.recordIds - Array of RecordIds in format "entityDefinitionId:entityInstanceId"
 * @param params.fieldReferences - Array of FieldReference (ResourceFieldId or FieldPath)
 *
 * @returns BatchFieldValueResult containing values array
 *
 * @example
 * // Direct field fetch
 * const result = await batchGetValues(ctx, registryService, {
 *   recordIds: ["contact:contact-1", "contact:contact-2"],
 *   fieldReferences: ["contact:email", "contact:name"]
 * });
 *
 * @example
 * // Relationship path fetch
 * const result = await batchGetValues(ctx, registryService, {
 *   recordIds: ["product:prod-1"],
 *   fieldReferences: [["product:vendor", "vendor:name"]]
 * });
 */
export async function batchGetValues(
  ctx: FieldValueContext,
  params: BatchGetValuesInput
): Promise<BatchFieldValueResult> {
  let { recordIds, fieldReferences } = params

  // Read enforcement (v2 §2.2) — filter the def set in memory, never per-row:
  // - drop anchor records whose def the member can't view;
  // - drop relationship-traversal refs touching ANY non-viewable def (a path
  //   must not traverse *through* a restricted def either).
  // Direct refs stay: they only yield values for the already-gated anchors.
  const caps = ctx.capabilities
  if (caps) {
    // ANCHOR records key off {@link hasDefPresence}, not `canViewEntity`
    // (plan v3/03 §6.1): a member reaching a def ONLY through per-record grants
    // must still get values for the rows they were shared. The rows themselves
    // are already scoped — every path that produces these `recordIds`
    // (`listFiltered`, `getById`, `getByIds`, the picker) applies
    // `recordVisibilityScope` in SQL — so this gate's job is the DEF axis, and
    // widening it here cannot admit a row the read path did not already admit.
    recordIds = recordIds.filter((rid) =>
      caps.hasDefPresence(parseRecordId(rid).entityDefinitionId)
    )
    // TRAVERSAL paths keep the strict `canViewEntity` test. A path hop reads
    // *through* a def to rows the caller never named and this function never
    // scoped, so presence is not enough — a grant on one row of a def must not
    // open a traversal across all of it.
    fieldReferences = fieldReferences.filter(
      (ref) =>
        !isFieldPath(ref) ||
        ref.every((seg) => caps.canViewEntity(parseResourceFieldId(seg).entityDefinitionId))
    )
  }

  // MAIL enforcement — the def filter above is inert for `thread` / `message`:
  // both are `NON_RECORD_DEF_SLUGS`, so `hasDefPresence` passes them for every
  // member and the resolvers then read the mail tables org-wide. The lens is the
  // authority there, so it is applied here, batched, by {@link resolveMailLensGate}:
  // invisible threads drop out of `recordIds` (row visibility) and values above
  // the viewer's tier — `subject` at `identity`, `body` at `read` — are withheld
  // from the results (field visibility). `null` for every non-mail batch.
  const mailGate = await resolveMailLensGate(ctx, recordIds, fieldReferences)
  if (mailGate) recordIds = mailGate.visibleRecordIds

  if (recordIds.length === 0 || fieldReferences.length === 0) {
    return { values: [] }
  }

  // Validate all field references upfront (fail-fast)
  await validateFieldReferences(ctx.organizationId, fieldReferences)

  // Fast path: if all refs are direct fields (not multi-hop paths), batch into a single query
  const allDirect = fieldReferences.every((ref) => !isFieldPath(ref))

  const results: TypedFieldValueResult[] = []

  if (allDirect) {
    const direct = await batchGetAllDirectFieldValues(
      ctx,
      recordIds,
      fieldReferences as ResourceFieldId[]
    )
    results.push(...direct.values)
  } else {
    // Slow path: sequential per-field resolution (handles relationship traversals)
    for (const ref of fieldReferences) {
      const refResults = await resolveFieldReference(ctx, recordIds, ref)
      results.push(...refResults)
    }
  }

  return { values: mailGate ? mailGate.filterValues(results) : results }
}

/** No grant-only relationship targets in play — the overwhelmingly common case. */
const NO_GRANTED_IDS: ReadonlySet<string> = new Set()

/**
 * The referenced entity-instance ids the member holds a per-record grant on,
 * across every GRANT-ONLY relationship target in this batch (plan v3/03 §5.4).
 *
 * "Grant-only" means: the member cannot view the target def outright
 * (`!canViewEntity`) but does hold ≥1 record grant on it
 * (`hasRecordGrantsOn`) — arm 3 of {@link
 * import('../permissions/capabilities/record-visibility-scope').recordScopeArm}.
 * Any other target is decided without I/O by the caller, so this returns an
 * empty set and issues no query at all.
 *
 * One query for the whole batch, keyed on the referenced instance ids directly.
 * The `entityDefinitionId` is deliberately NOT in the predicate: instance ids
 * are globally-unique cuid2s, so a grant row on another def cannot match — the
 * same argument `instanceListScope` records for its own id lists.
 */
async function resolveGrantedRelatedIds(
  ctx: FieldValueContext,
  rows: Array<{ relatedEntityDefinitionId?: string | null; relatedEntityId?: string | null }>
): Promise<ReadonlySet<string>> {
  const caps = ctx.capabilities
  if (!caps || !ctx.userId) return NO_GRANTED_IDS

  const candidateIds = new Set<string>()
  const decided = new Map<string, boolean>()
  for (const row of rows) {
    const defId = row.relatedEntityDefinitionId
    if (!defId || !row.relatedEntityId) continue
    let grantOnly = decided.get(defId)
    if (grantOnly === undefined) {
      grantOnly = !caps.canViewEntity(defId) && caps.hasRecordGrantsOn(defId)
      decided.set(defId, grantOnly)
    }
    if (grantOnly) candidateIds.add(row.relatedEntityId)
  }
  if (candidateIds.size === 0) return NO_GRANTED_IDS

  const grantees = await resolveResourceAccessGrantees(ctx.organizationId, ctx.userId)
  const granted = await ctx.db
    .selectDistinct({ entityInstanceId: schema.ResourceAccess.entityInstanceId })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, ctx.organizationId),
        inArray(schema.ResourceAccess.entityInstanceId, [...candidateIds]),
        inArray(schema.ResourceAccess.rung, rungsAtOrAbove('read')),
        or(...resourceAccessGranteeConditions(grantees))
      )
    )
  return new Set(granted.map((row) => row.entityInstanceId).filter((id): id is string => !!id))
}

/**
 * Batch fetch all direct field values.
 * Categorizes fields into system table, virtual, FieldValue-backed, and NAME,
 * then delegates to the appropriate resolver.
 */
async function batchGetAllDirectFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldRefs: ResourceFieldId[]
): Promise<BatchFieldValueResult> {
  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  // Build lookup: instanceId → full RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  // Resolve each ref to its canonical field id (DB row id for system fields) and key
  // every lookup by it. This is what lets a static-form ref (`contact:firstName`) and a
  // row-id ref both query FieldValue under the id values are actually stored under.
  // `fieldIdToRef` keeps the *original* ref as its value so the response echoes the form
  // the client requested (its store key agrees).
  const fieldIdToRef = new Map<string, ResourceFieldId>()
  const allFieldIds: string[] = []
  const fieldTypeMap = new Map<string, FieldType>()
  const fieldOptionsMap = new Map<string, FieldOptions | undefined>()
  for (const ref of fieldRefs) {
    const { entityDefinitionId, fieldId: rawFieldId } = parseResourceFieldId(ref)
    const info = await getFieldInfoFromRegistry(ctx.organizationId, entityDefinitionId, rawFieldId)
    const fieldId = info.fieldId // canonical
    fieldIdToRef.set(fieldId, ref)
    allFieldIds.push(fieldId)
    fieldTypeMap.set(fieldId, info.fieldType)
    fieldOptionsMap.set(fieldId, info.fieldOptions)
  }

  // Separate NAME fields
  const nameFieldIds = allFieldIds.filter((fid) => fieldTypeMap.get(fid) === FieldTypeEnum.NAME)

  // Categorize remaining fields into system vs FieldValue-backed
  const { entityDefinitionId } = parseRecordId(recordIds[0]!)
  const categorized = await categorizeFields(
    ctx,
    fieldRefs,
    entityDefinitionId,
    fieldTypeMap,
    fieldOptionsMap
  )

  const results: TypedFieldValueResult[] = []

  // FieldValue-backed fields (custom resource fields + system fields stored in FieldValue)
  if (categorized.fieldValueFieldIds.length > 0) {
    const fvResults = await fetchFieldValueResults(
      ctx,
      entityInstanceIds,
      categorized.fieldValueFieldIds,
      instanceToRecordId,
      fieldIdToRef,
      fieldTypeMap,
      fieldOptionsMap
    )
    results.push(...fvResults)
  }

  // System table fields (Layer 1)
  if (categorized.systemDbFields.length > 0) {
    const systemResults = await resolveSystemTableFields(
      ctx,
      entityDefinitionId as TableId,
      entityInstanceIds,
      categorized.systemDbFields
    )
    results.push(...systemResults)
  }

  // EntityInstance column fields (created_at/updated_at/id on EntityDefinition entities)
  if (categorized.entityInstanceDbFields.length > 0) {
    const entityInstanceResults = await resolveEntityInstanceFields(
      ctx,
      entityDefinitionId,
      entityInstanceIds,
      categorized.entityInstanceDbFields
    )
    results.push(...entityInstanceResults)
  }

  // Virtual fields (Layer 2)
  if (categorized.virtualFields.length > 0) {
    const virtualResults = await fetchVirtualFieldResults(
      ctx,
      entityDefinitionId,
      entityInstanceIds,
      categorized.virtualFields,
      categorized.fieldIdToKeyMap,
      instanceToRecordId
    )
    results.push(...virtualResults)
  }

  // NAME fields
  for (const nameFieldId of nameFieldIds) {
    const nameValues = await resolveNameFieldValues(ctx, recordIds, nameFieldId)
    const ref = fieldIdToRef.get(nameFieldId)!
    const nameFieldType = fieldTypeMap.get(nameFieldId)!
    const nameFieldOptions = fieldOptionsMap.get(nameFieldId)

    for (const [recordId, value] of nameValues) {
      results.push({
        recordId,
        fieldRef: ref,
        value,
        fieldType: nameFieldType,
        fieldOptions: nameFieldOptions,
      })
    }
  }

  return { values: results }
}

// =============================================================================
// FIELD CATEGORIZATION
// =============================================================================

interface CategorizedFields {
  systemDbFields: SystemFieldDescriptor[]
  /**
   * System fields backed by columns on the shared `EntityInstance` table
   * (`id` / `createdAt` / `updatedAt`). EntityDefinition-backed resources
   * (contact, ticket, custom entities) are not `isSystemResourceId`, so these
   * can't go through `systemDbFields` — they resolve from EntityInstance.
   */
  entityInstanceDbFields: SystemFieldDescriptor[]
  virtualFields: Array<{
    fieldKey: string
    fieldId: string
    fieldRef: ResourceFieldId
    fieldType: FieldType
    fieldOptions?: FieldOptions
  }>
  fieldValueFieldIds: string[]
  fieldIdToKeyMap: Map<string, string>
}

/**
 * Whether a dbColumn exists as a real column on the shared EntityInstance table.
 * Used to route EntityDefinition-backed system fields (created_at/updated_at/id)
 * to the EntityInstance resolver instead of the (empty) FieldValue query.
 */
function isEntityInstanceColumn(dbColumn: string): boolean {
  // `dbColumn` holds the drizzle property name (`createdAt`, not `created_at`),
  // which is exactly how columns are keyed on the table object.
  return dbColumn in schema.EntityInstance
}

/**
 * Categorize field refs into system table, virtual, or FieldValue-backed.
 * Uses the org-scoped cached resource to resolve field metadata.
 */
async function categorizeFields(
  ctx: FieldValueContext,
  fieldRefs: ResourceFieldId[],
  entityDefinitionId: string,
  fieldTypeMap: Map<string, FieldType>,
  fieldOptionsMap: Map<string, FieldOptions | undefined>
): Promise<CategorizedFields> {
  // `isSystem` (old system types: thread/user/…) gates the system-table (Layer 1) and
  // virtual (Layer 2) categorization. But canonical-id resolution must run for ANY
  // registered resource — including EntityDefinition-backed ones (contact/ticket), which
  // are NOT `isSystemResourceId` yet still have system fields whose row id ≠ static key.
  // So always load the cached resource to map a static-key ref → its canonical row id.
  const isSystem = isSystemResourceId(entityDefinitionId)
  const cachedResource = await findCachedResource(ctx.organizationId, entityDefinitionId)

  const systemDbFields: SystemFieldDescriptor[] = []
  const entityInstanceDbFields: SystemFieldDescriptor[] = []
  const virtualFields: CategorizedFields['virtualFields'] = []
  const fieldValueFieldIds: string[] = []
  const fieldIdToKeyMap = new Map<string, string>()

  for (const ref of fieldRefs) {
    const { fieldId: rawFieldId } = parseResourceFieldId(ref)
    const cachedField = cachedResource?.fields.find(
      (f) => f.id === rawFieldId || f.key === rawFieldId
    )
    // Canonical id: the DB row id (cachedField.id) where a CustomField row exists, else the
    // parsed id. Static-key refs (e.g. `contact:firstName`) resolve to the row id values are
    // stored under; all maps + the FieldValue query key by it.
    const fieldId = cachedField?.id ?? rawFieldId
    const fieldType = fieldTypeMap.get(fieldId)

    // Skip NAME fields (handled separately)
    if (!fieldType || fieldType === FieldTypeEnum.NAME) continue

    if (isSystem && cachedField?.dbColumn) {
      systemDbFields.push({
        fieldKey: cachedField.key,
        fieldId,
        fieldRef: ref,
        fieldType,
        fieldOptions: fieldOptionsMap.get(fieldId),
        dbColumn: cachedField.dbColumn,
        relationship: cachedField.relationship,
      })
    } else if (isSystem && cachedField && isVirtualField(entityDefinitionId, cachedField.key)) {
      virtualFields.push({
        fieldKey: cachedField.key,
        fieldId,
        fieldRef: ref,
        fieldType,
        fieldOptions: fieldOptionsMap.get(fieldId),
      })
      fieldIdToKeyMap.set(cachedField.key, fieldId)
    } else if (!isSystem && cachedField?.dbColumn && isEntityInstanceColumn(cachedField.dbColumn)) {
      // EntityDefinition-backed resource (contact/ticket/custom): column-backed
      // system fields (created_at/updated_at/id) live on the shared EntityInstance
      // table, not FieldValue. Resolve them directly from EntityInstance.
      entityInstanceDbFields.push({
        fieldKey: cachedField.key,
        fieldId,
        fieldRef: ref,
        fieldType,
        fieldOptions: fieldOptionsMap.get(fieldId),
        dbColumn: cachedField.dbColumn,
        relationship: cachedField.relationship,
      })
    } else {
      // System field stored in FieldValue (e.g. tags), or a custom/non-system field.
      fieldValueFieldIds.push(fieldId)
    }
  }

  return {
    systemDbFields,
    entityInstanceDbFields,
    virtualFields,
    fieldValueFieldIds,
    fieldIdToKeyMap,
  }
}

// =============================================================================
// FIELD VALUE TABLE QUERY
// =============================================================================

/**
 * Explicit FieldValue projection. `valueJson` is the `{ v, meta }` envelope —
 * heavy jsonb (file/address payloads) plus small metadata facts — and is only
 * shipped when `valueJsonWhen` matches; other rows get NULL. Pass `true` to
 * always include it.
 */
function fieldValueColumns(valueJsonWhen: SQL | true) {
  return {
    id: schema.FieldValue.id,
    entityId: schema.FieldValue.entityId,
    fieldId: schema.FieldValue.fieldId,
    sortKey: schema.FieldValue.sortKey,
    createdAt: schema.FieldValue.createdAt,
    updatedAt: schema.FieldValue.updatedAt,
    valueText: schema.FieldValue.valueText,
    valueNumber: schema.FieldValue.valueNumber,
    valueBoolean: schema.FieldValue.valueBoolean,
    valueDate: schema.FieldValue.valueDate,
    valueJson:
      valueJsonWhen === true
        ? schema.FieldValue.valueJson
        : sql<unknown>`CASE WHEN ${valueJsonWhen} THEN ${schema.FieldValue.valueJson} END`,
    optionId: schema.FieldValue.optionId,
    relatedEntityId: schema.FieldValue.relatedEntityId,
    relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
    actorId: schema.FieldValue.actorId,
    aiStatus: schema.FieldValue.aiStatus,
    managedByConnectorId: schema.FieldValue.managedByConnectorId,
  }
}

/**
 * Fetch field values from the FieldValue table and convert to typed results.
 * This is the original FieldValue query, extracted into its own function.
 */
async function fetchFieldValueResults(
  ctx: FieldValueContext,
  entityInstanceIds: string[],
  fieldIds: string[],
  instanceToRecordId: Map<string, RecordId>,
  fieldIdToRef: Map<string, ResourceFieldId>,
  fieldTypeMap: Map<string, FieldType>,
  fieldOptionsMap: Map<string, FieldOptions | undefined>
): Promise<TypedFieldValueResult[]> {
  // `valueJson` is the `{ v, meta }` envelope: the value for json-typed fields,
  // and metadata (AI provenance, a CURRENCY row's ISO code) for any type. Ship
  // it exactly when a row has one.
  //
  // This is NARROWER than the fieldId-membership predicate it replaces — that
  // form selected every row of a json-typed field, payload or not — while also
  // covering the case membership missed: a scalar row carrying `meta` but no
  // `aiStatus`, which is every currency value that asserts its own code.
  const valueJsonWhen = isNotNull(schema.FieldValue.valueJson)

  const rows = await ctx.db
    .select(fieldValueColumns(valueJsonWhen))
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds),
        inArray(schema.FieldValue.entityId, entityInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Group by (entityId, fieldId)
  const grouped = new Map<string, (typeof rows)[number][]>()
  for (const row of rows) {
    const key = `${row.entityId}:${row.fieldId}`
    const existing = grouped.get(key) ?? []
    existing.push(row)
    grouped.set(key, existing)
  }

  // Plan v3/03 §5.4 — relationship chips pointing at a GRANT-ONLY def.
  //
  // Before P5 a relationship whose target def failed `canViewEntity` was
  // redacted WHOLESALE, which under per-record sharing is wrong in the visible
  // direction: a member shared one deal would see "🔒 1 restricted" on the very
  // chip pointing at it. Resolving the granted subset takes ONE extra query, and
  // only for defs the member genuinely reaches by grant alone — a def they can
  // view outright, or one they have no grants on at all, never reaches here.
  const grantedRelatedIds = await resolveGrantedRelatedIds(ctx, rows)

  const results: TypedFieldValueResult[] = []

  for (const [, fieldRows] of grouped) {
    const entityId = fieldRows[0]!.entityId
    const fieldId = fieldRows[0]!.fieldId
    const recordId = instanceToRecordId.get(entityId)
    const fieldRef = fieldIdToRef.get(fieldId)
    const fieldType = fieldTypeMap.get(fieldId)

    if (!recordId || !fieldRef || !fieldType) continue

    const fieldOptions = fieldOptionsMap.get(fieldId)
    const isMulti = isArrayReturnFieldType(fieldType, fieldOptions)

    // Read enforcement (v2 Phase 5 §2) — a relationship pointing at a def the
    // member can't view still returns its target recordIds, which the UI can't
    // hydrate (that path is gated) so they render as broken "Unknown" chips and
    // leak the referenced ids. Strip the non-viewable referenced rows here, at
    // the authoritative server value read, so the ids never reach the client.
    // System-table FK relationships (e.g. thread.inbox) never reach this
    // FieldValue path — they resolve via the system resolvers and are governed
    // by mail visibility — so only entity-def relationships are affected.
    let effectiveRows: typeof fieldRows = fieldRows
    if (fieldType === FieldTypeEnum.RELATIONSHIP && ctx.capabilities) {
      const caps = ctx.capabilities
      effectiveRows = fieldRows.filter((row) => {
        if (!row.relatedEntityDefinitionId) return true
        if (caps.canViewEntity(row.relatedEntityDefinitionId)) return true
        // Grant-only def: keep exactly the referenced rows the member holds a
        // grant on. `grantedRelatedIds` is empty unless such a def is in play,
        // so the common case costs nothing and still redacts.
        return Boolean(row.relatedEntityId && grantedRelatedIds.has(row.relatedEntityId))
      })
    }

    const typedValues = effectiveRows.map((row) =>
      rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )

    // Carry the redaction count (v2 Phase 5 §2) as a trailing marker element so
    // the renderer can show a `🔒 N restricted` chip. The marker has an empty
    // recordId → `extractRelationshipRecordIds` skips it (never keyed/hydrated);
    // only the count survives. redactedCount is 0 for every non-relationship
    // group (effectiveRows === fieldRows) and when nothing was stripped.
    const redactedCount = fieldRows.length - effectiveRows.length
    if (redactedCount > 0) {
      const base = fieldRows[0]! as unknown as FieldValueRow
      typedValues.push({
        id: `${base.id}:redacted`,
        entityId: base.entityId,
        fieldId: base.fieldId,
        sortKey: base.sortKey,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt,
        type: 'relationship',
        recordId: '' as RecordId,
        redactedCount,
      })
    }

    const value = isMulti ? typedValues : (typedValues[0] ?? null)

    // AI marker lives on a single row per (entity, field). Multi-value fields
    // don't carry AI markers today — take the first row's marker for safety.
    // `ai-commit.ts` only ever writes 'generating' | 'result' | 'error', so
    // narrowing the broad DB text column to AiStatus here is safe. Metadata
    // lives in the `valueJson` column (no dedicated column), so we go through
    // `readAiMetadata` — the same helper the write path uses — to keep the
    // storage detail in one place.
    const firstRow = fieldRows[0]!
    const aiStatus = (firstRow.aiStatus ?? null) as AiStatus | null
    const aiMetadata = readAiMetadata(firstRow)
    // Contributing data-connector provenance marker (cell-grained badge). Multi
    // fields stamp ROW-accurately (the connector's own row may not be first), so
    // take ANY row's marker — else the badge vanishes whenever the primary row
    // happens to be user-owned. Scalar fields have one row; same answer.
    const managedByConnectorId =
      fieldRows.find((row) => row.managedByConnectorId != null)?.managedByConnectorId ?? null

    results.push({
      recordId,
      fieldRef,
      value,
      fieldType,
      fieldOptions,
      aiStatus,
      aiMetadata,
      managedByConnectorId,
    })
  }

  return results
}

// =============================================================================
// VIRTUAL FIELD RESOLUTION
// =============================================================================

/**
 * Fetch virtual field values and map them to TypedFieldValueResult[].
 */
async function fetchVirtualFieldResults(
  ctx: FieldValueContext,
  entityDefinitionId: string,
  entityInstanceIds: string[],
  virtualFields: CategorizedFields['virtualFields'],
  fieldIdToKeyMap: Map<string, string>,
  instanceToRecordId: Map<string, RecordId>
): Promise<TypedFieldValueResult[]> {
  const fieldKeys = virtualFields.map((f) => f.fieldKey)
  const virtualValues = await resolveVirtualFields(
    ctx,
    entityDefinitionId,
    entityInstanceIds,
    fieldKeys,
    fieldIdToKeyMap
  )

  const results: TypedFieldValueResult[] = []

  for (const [entityId, fieldMap] of virtualValues) {
    const recordId = instanceToRecordId.get(entityId)
    if (!recordId) continue

    for (const entry of virtualFields) {
      const virtualValue = fieldMap.get(entry.fieldKey)
      if (virtualValue) {
        results.push({
          recordId,
          fieldRef: entry.fieldRef,
          value: virtualValue.value,
          fieldType: entry.fieldType,
          fieldOptions: { ...entry.fieldOptions, ...virtualValue.fieldOptions },
        })
      }
    }
  }

  return results
}

// =============================================================================
// FIELD PATH RESOLUTION
// =============================================================================

/**
 * Resolve a single field reference (direct or path) for multiple source records.
 *
 * - Direct field "product:price": fetch directly
 * - Path ["product:vendor", "vendor:name"]: traverse relationships, then fetch terminal
 *
 * System-aware: handles both FieldValue-backed and system table-backed fields
 * at every hop and at the terminal read.
 */
async function resolveFieldReference(
  ctx: FieldValueContext,
  sourceRecordIds: RecordId[],
  ref: FieldReference
): Promise<TypedFieldValueResult[]> {
  // Normalize to path (direct field becomes single-element path)
  const path: FieldPath = normalizeFieldReference(ref)

  if (path.length === 0) {
    return []
  }

  // Track source → intermediate mappings for final result assembly
  let currentRecordIds = sourceRecordIds
  const traversalMaps: Map<RecordId, RecordId[]>[] = []

  // Process all hops except the last (which is the terminal field)
  for (const resourceFieldId of path.slice(0, -1)) {
    const relationshipMap = await fetchRelationshipHop(ctx, currentRecordIds, resourceFieldId)

    traversalMaps.push(relationshipMap)

    // Collect all related IDs for next depth
    const nextRecordIds: RecordId[] = []
    for (const relatedIds of relationshipMap.values()) {
      nextRecordIds.push(...relatedIds)
    }

    currentRecordIds = [...new Set(nextRecordIds)]

    if (currentRecordIds.length === 0) {
      break
    }
  }

  // Fetch terminal field values. `FieldPath` is a non-empty tuple so the last hop
  // always exists — `path[0]` is the type-level witness (index 0 is required on the
  // tuple, a computed index is not).
  const terminalResourceFieldId = path.at(-1) ?? path[0]
  const { entityDefinitionId: terminalEntityId, fieldId: terminalFieldId } =
    parseResourceFieldId(terminalResourceFieldId)

  const terminalFieldInfo = await getFieldInfoFromRegistry(
    ctx.organizationId,
    terminalEntityId,
    terminalFieldId
  )
  // Canonical id (row id for system fields) — query/compose values under the id they're
  // stored under, even when the ref arrived in static-key form.
  const canonicalTerminalFieldId = terminalFieldInfo.fieldId
  const terminalFieldType = terminalFieldInfo.fieldType
  const terminalFieldOptions = terminalFieldInfo.fieldOptions

  // Handle NAME fields
  if (terminalFieldType === FieldTypeEnum.NAME && currentRecordIds.length > 0) {
    const terminalValues = await resolveNameFieldValues(
      ctx,
      currentRecordIds,
      canonicalTerminalFieldId
    )
    return mapResultsToSources(
      sourceRecordIds,
      traversalMaps,
      terminalValues,
      ref,
      terminalFieldType,
      terminalFieldOptions
    )
  }

  const terminalValues =
    currentRecordIds.length > 0
      ? await fetchTerminalFieldValues(
          ctx,
          currentRecordIds,
          terminalEntityId,
          canonicalTerminalFieldId,
          terminalResourceFieldId,
          terminalFieldType,
          terminalFieldOptions
        )
      : new Map()

  return mapResultsToSources(
    sourceRecordIds,
    traversalMaps,
    terminalValues,
    ref,
    terminalFieldType,
    terminalFieldOptions
  )
}

/**
 * Fetch a single relationship hop — system-aware.
 * For system resources with dbColumn, reads FK from the DB table directly.
 * For FieldValue-backed relationships, uses the existing FieldValue query.
 */
async function fetchRelationshipHop(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  resourceFieldId: ResourceFieldId
): Promise<Map<RecordId, RecordId[]>> {
  const { entityDefinitionId: hopEntityDefId, fieldId: rawFieldId } =
    parseResourceFieldId(resourceFieldId)

  if (isSystemResourceId(hopEntityDefId)) {
    const hopResource = await findCachedResource(ctx.organizationId, hopEntityDefId)
    const cachedField = hopResource?.fields.find((f) => f.id === rawFieldId || f.key === rawFieldId)

    if (cachedField?.dbColumn && cachedField.relationship) {
      return batchFetchSystemRelationships(ctx, recordIds, cachedField, hopEntityDefId)
    }

    // FieldValue-backed system relationship — query by canonical row id so a
    // static-key hop ref still finds the stored relationships.
    return batchFetchRelationships(ctx, recordIds, cachedField?.id ?? rawFieldId)
  }

  return batchFetchRelationships(ctx, recordIds, rawFieldId)
}

/**
 * Fetch terminal field values — system-aware.
 * Delegates to system table resolver, virtual field resolver, or FieldValue query.
 */
async function fetchTerminalFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  terminalEntityId: string,
  terminalFieldId: string,
  terminalResourceFieldId: ResourceFieldId,
  terminalFieldType: FieldType,
  terminalFieldOptions?: FieldOptions
): Promise<Map<RecordId, TypedFieldValue | TypedFieldValue[]>> {
  if (!isSystemResourceId(terminalEntityId)) {
    return batchFetchFieldValues(
      ctx,
      recordIds,
      terminalFieldId,
      terminalFieldType,
      terminalFieldOptions
    )
  }

  const termResource = await findCachedResource(ctx.organizationId, terminalEntityId)
  const cachedField = termResource?.fields.find(
    (f) => f.id === terminalFieldId || f.key === terminalFieldId
  )

  if (cachedField?.dbColumn) {
    // System table field — use Layer 1 resolver
    const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)
    const systemResults = await resolveSystemTableFields(
      ctx,
      terminalEntityId as TableId,
      entityInstanceIds,
      [
        {
          fieldKey: cachedField.key,
          fieldId: terminalFieldId,
          fieldRef: terminalResourceFieldId,
          fieldType: terminalFieldType,
          fieldOptions: terminalFieldOptions,
          dbColumn: cachedField.dbColumn,
          relationship: cachedField.relationship,
        },
      ]
    )

    const resultMap = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()
    for (const r of systemResults) {
      resultMap.set(r.recordId, r.value!)
    }
    return resultMap
  }

  if (cachedField && isVirtualField(terminalEntityId, cachedField.key)) {
    // Virtual field — use Layer 2 resolver
    const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)
    const fieldIdMap = new Map([[cachedField.key, terminalFieldId]])
    const virtualValues = await resolveVirtualFields(
      ctx,
      terminalEntityId,
      entityInstanceIds,
      [cachedField.key],
      fieldIdMap
    )

    // Build instanceId → RecordId lookup
    const instanceToRecordId = new Map<string, RecordId>()
    for (const rid of recordIds) {
      const { entityInstanceId } = parseRecordId(rid)
      instanceToRecordId.set(entityInstanceId, rid)
    }

    const resultMap = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()
    for (const [entityId, fieldMap] of virtualValues) {
      const rid = instanceToRecordId.get(entityId)
      if (!rid) continue
      const virtualValue = fieldMap.get(cachedField.key)
      if (virtualValue) resultMap.set(rid, virtualValue.value)
    }
    return resultMap
  }

  // FieldValue-backed — existing path
  return batchFetchFieldValues(
    ctx,
    recordIds,
    terminalFieldId,
    terminalFieldType,
    terminalFieldOptions
  )
}

/**
 * Batch fetch relationship field values.
 * Returns Map: entityId → RecordId[] of related entities
 */
async function batchFetchRelationships(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldId: string
): Promise<Map<RecordId, RecordId[]>> {
  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  const rows = await ctx.db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, entityInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Group by source entityId → related RecordIds
  const result = new Map<RecordId, RecordId[]>()

  // Build lookup: instanceId → full RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  for (const row of rows) {
    const sourceRecordId = instanceToRecordId.get(row.entityId)
    if (!sourceRecordId || !row.relatedEntityId || !row.relatedEntityDefinitionId) continue

    const relatedRecordId = toRecordId(row.relatedEntityDefinitionId, row.relatedEntityId)

    const existing = result.get(sourceRecordId) ?? []
    existing.push(relatedRecordId)
    result.set(sourceRecordId, existing)
  }

  return result
}

/**
 * Batch fetch terminal (non-relationship) field values.
 */
async function batchFetchFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldId: string,
  fieldType: FieldType,
  fieldOptions?: FieldOptions
): Promise<Map<RecordId, TypedFieldValue | TypedFieldValue[]>> {
  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  // No AI-metadata read on this path — valueJson only matters for json-typed fields.
  const rows = await ctx.db
    .select(fieldValueColumns(getValueType(fieldType) === 'json' ? true : sql`false`))
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, entityInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Build lookup: instanceId → full RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  // Group rows by record
  const rowsByRecord = new Map<RecordId, typeof rows>()
  for (const row of rows) {
    const recordId = instanceToRecordId.get(row.entityId)
    if (!recordId) continue

    const existing = rowsByRecord.get(recordId) ?? []
    existing.push(row)
    rowsByRecord.set(recordId, existing)
  }

  // Convert to typed values
  const result = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()
  const isMulti = isArrayReturnFieldType(fieldType, fieldOptions)

  for (const [recordId, fieldRows] of rowsByRecord) {
    const typedValues = fieldRows.map((row) =>
      rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )
    result.set(recordId, isMulti ? typedValues : typedValues[0]!)
  }

  return result
}

/**
 * Map terminal field values back through the traversal chain to source records.
 *
 * This handles the case where:
 * - Source A → Related B1, B2
 * - B1 → value "X", B2 → value "Y"
 * - Result: A → ["X", "Y"] (if any has_many in chain) or A → "X" (if all single)
 */
function mapResultsToSources(
  sourceRecordIds: RecordId[],
  traversalMaps: Map<RecordId, RecordId[]>[],
  terminalValues: Map<RecordId, TypedFieldValue | TypedFieldValue[]>,
  fieldRef: FieldReference,
  terminalFieldType: FieldType,
  terminalFieldOptions?: FieldOptions
): TypedFieldValueResult[] {
  const results: TypedFieldValueResult[] = []

  // Direct field (no traversal) - just map terminalValues directly
  if (traversalMaps.length === 0) {
    for (const sourceRecordId of sourceRecordIds) {
      const value = terminalValues.get(sourceRecordId)
      if (value !== undefined) {
        results.push({
          recordId: sourceRecordId,
          fieldRef,
          value,
          fieldType: terminalFieldType,
          fieldOptions: terminalFieldOptions,
        })
      }
    }
    return results
  }

  // Path with traversal - walk through maps
  for (const sourceRecordId of sourceRecordIds) {
    // Walk the traversal maps to collect all terminal record IDs reachable from source
    let currentIds: RecordId[] = [sourceRecordId]
    let hasMultiHop = false

    for (const map of traversalMaps) {
      const nextIds: RecordId[] = []
      for (const id of currentIds) {
        const related = map.get(id) ?? []
        nextIds.push(...related)
        if (related.length > 1) hasMultiHop = true
      }
      currentIds = nextIds
      if (currentIds.length === 0) break
    }

    // Collect terminal values for all reachable terminal records
    const values: TypedFieldValue[] = []
    for (const terminalId of currentIds) {
      const value = terminalValues.get(terminalId)
      if (value) {
        if (Array.isArray(value)) {
          values.push(...value)
        } else {
          values.push(value)
        }
      }
    }

    // Determine result shape based on traversal cardinality
    // If any hop produced multiple results, or terminal field is multi-value, return array
    // Otherwise, return single value or null
    if (values.length > 0) {
      const isMultiValueField = isArrayReturnFieldType(terminalFieldType, terminalFieldOptions)
      const shouldBeArray = hasMultiHop || values.length > 1 || isMultiValueField

      results.push({
        recordId: sourceRecordId,
        fieldRef,
        value: shouldBeArray ? values : (values[0] ?? null),
        fieldType: terminalFieldType,
        fieldOptions: terminalFieldOptions,
      })
    }
  }

  return results
}

// =============================================================================
// COMPUTED FIELD RESOLUTION
// =============================================================================

/**
 * Resolve NAME field values by fetching source fields (firstName, lastName)
 * and composing a TypedFieldValue with type NAME.
 *
 * Falls back to empty map if the NAME field's options.name is not linked.
 */
async function resolveNameFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  nameFieldId: string
): Promise<Map<RecordId, TypedFieldValue | TypedFieldValue[]>> {
  // Look up the NAME field to get source field IDs
  const nameField = await getField(ctx, nameFieldId)
  const nameOptions = (nameField.options as Record<string, any>)?.name as
    | NameFieldOptions
    | undefined

  if (!nameOptions?.firstNameFieldId || !nameOptions?.lastNameFieldId) {
    return new Map()
  }

  // Fetch both source fields in parallel
  const [firstNameValues, lastNameValues] = await Promise.all([
    batchFetchFieldValues(
      ctx,
      recordIds,
      nameOptions.firstNameFieldId,
      FieldTypeEnum.TEXT as FieldType
    ),
    batchFetchFieldValues(
      ctx,
      recordIds,
      nameOptions.lastNameFieldId,
      FieldTypeEnum.TEXT as FieldType
    ),
  ])

  // Compose NAME values from source fields
  const result = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()

  for (const recordId of recordIds) {
    const firstNameTyped = firstNameValues.get(recordId)
    const lastNameTyped = lastNameValues.get(recordId)

    // Both sources were fetched as TEXT above, so anything else is a misconfigured
    // NAME field rather than a value to coerce.
    const firstName =
      firstNameTyped && !Array.isArray(firstNameTyped) && firstNameTyped.type === 'text'
        ? firstNameTyped.value
        : ''
    const lastName =
      lastNameTyped && !Array.isArray(lastNameTyped) && lastNameTyped.type === 'text'
        ? lastNameTyped.value
        : ''

    if (firstName || lastName) {
      // NAME is composed, not stored — there is no FieldValue row behind it, so the
      // row identity/timestamps every other TypedFieldValue carries are synthesised
      // from the NAME field itself.
      result.set(recordId, {
        id: '',
        entityId: parseRecordId(recordId).entityInstanceId,
        fieldId: nameFieldId,
        sortKey: '',
        createdAt: '',
        updatedAt: '',
        type: 'json',
        value: { firstName, lastName },
      })
    }
  }

  return result
}
