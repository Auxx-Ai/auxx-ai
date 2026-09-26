// packages/lib/src/resources/crud/create-entities-batch.ts

/**
 * `createEntitiesBatch` - `createEntity` for N records of one definition in a handful of
 * statements: each step runs per record in memory and each write once for all records, so the
 * stored rows match the per-record path (plans/mrp/12-slice-batched-backflush.md §2).
 */

import { type Database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import type { TypedFieldValue, TypedFieldValueInput } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { nKeysAfter } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { findCachedResource, getCachedCustomFields, getCachedFieldMap } from '../../cache'
import { isBuiltInField } from '../../custom-fields/built-in-fields'
import { NotFoundError, UnprocessableEntityError } from '../../errors'
import type { CreateDisplayColumns } from '../../field-values/create-values'
import {
  batchGetRelatedDisplayNames,
  type CachedField,
  canonicalizeRelationshipValue,
  createFieldValueContext,
  type FieldValueContext,
  formatDisplayColumnText,
  getInverseInfoFromField,
  maybeUpdateDisplayValue,
  preBatchValidateRelationships,
  resolveFieldIds,
  rowToTypedValue,
  validateAndConvertValue,
} from '../../field-values/field-value-helpers'
import { flushInstancesDerived } from '../../field-values/instance-derived'
import {
  type BulkRelationshipUpdate,
  type InverseFieldInfo,
  syncInverseRelationshipsBulk,
} from '../../field-values/relationship-sync'
import { toFieldType } from '../../field-values/stored-field-type'
import type { FieldValueRow } from '../../field-values/types'
import { assertOriginMayWriteFields } from '../../field-values/write-guard'
import { runWithDirtyParents } from '../../reconcilers/dirty-parents'
import type { ManifestCollector } from '../../record-rules/sync-manifest-collector'
import { recordNumbering } from '../../records/record-numbering'
import { createGuard } from '../../utils/guard'
import { extractEventData } from '../events/extract-event-data'
import { getModelType, parseRecordId, toRecordId } from '../resource-id'
import { applyDefaults, assertRequiredFieldsPresent } from './create-defaults'
import { isCoveredQuiet, type WriteSession } from './write-origin'
import { runWithWriteDb, runWithWriteSession } from './write-session-als'

type FieldValueInsert = typeof schema.FieldValue.$inferInsert

const guard = createGuard('crud:batch-create')

/** Lazy: the hook and field-write graph is heavy, and the movements barrel imports this widely. */
async function loadWriteDeps() {
  const [registry, createValues, mutations, hooks, audit, displayDeps] = await Promise.all([
    import('../../field-hooks/registry'),
    import('../../field-values/create-values'),
    import('../../field-values/field-value-mutations'),
    import('../hooks'),
    import('./batch-create-audit'),
    import('../../field-values/display-field-deps'),
  ])
  return {
    planBatchCreate: audit.planBatchCreate,
    getDisplayFieldDeps: displayDeps.getDisplayFieldDeps,
    getEntityPreCreateHooks: registry.getEntityPreCreateHooks,
    computeCreateDisplayColumns: createValues.computeCreateDisplayColumns,
    settleInsertedDisplay: createValues.settleInsertedDisplay,
    buildFieldValueRow: mutations.buildFieldValueRow,
    captureSyncFieldWrite: mutations.captureSyncFieldWrite,
    fieldFeedsSearchCorpus: mutations.fieldFeedsSearchCorpus,
    fireFieldPreHooks: mutations.fireFieldPreHooks,
    isDeltaSubscribed: mutations.isDeltaSubscribed,
    validateRelationshipValue: mutations.validateRelationshipValue,
    runSystemPreHooks: hooks.runSystemPreHooks,
  }
}

type WriteDeps = Awaited<ReturnType<typeof loadWriteDeps>>

/** Rows per `FieldValue` insert; ~15 bound columns a row keeps a statement far below pg's 65535. */
const VALUE_INSERT_CHUNK = 2000

/** Who writes, on which connection and lane. `db` is the caller's transaction or connection. */
export interface BatchCreateCtx {
  db: Database
  organizationId: string
  userId: string
  session: WriteSession
  bypassFieldGuards?: ReadonlySet<SystemAttribute>
}

/** One record the batch created, in input order. */
export interface BatchCreatedRecord {
  id: string
  recordId: RecordId
  createdAt: Date
  /** The values after defaults and system hooks, as `createEntity` returns them. */
  values: Record<string, unknown>
}

/** One record between its instance insert and its value insert. */
interface PendingRecord {
  id: string
  recordId: RecordId
  display: CreateDisplayColumns
  values: Record<string, unknown>
  /** fieldId -> raw value, after defaults and system hooks; the last key for a field wins. */
  writes: Map<string, unknown>
  /** fieldId -> typed values to store, in write order; a field with none is left empty. */
  typed: Map<string, TypedFieldValueInput[]>
}

/** The resolved definition, its fields and the per-field cache every step shares. */
interface DefContext {
  userId: string
  entityDef: { id: string; entityType: string | null; apiSlug: string }
  fields: CustomFieldEntity[]
  fvCtx: FieldValueContext
  cachedField: (fieldId: string) => CachedField | undefined
  collector: ManifestCollector | null
}

/** The lane a session's creates take here, or null for one the batch does not replicate. */
export function batchCreateLane(session: WriteSession): 'quiet' | 'sync' | null {
  const origin = session.origin.kind
  if (session.mode?.kind === 'quiet') return origin === 'sync' || origin === 'seed' ? null : 'quiet'
  if (origin === 'sync' && (!session.mode || session.mode.kind === 'fanout')) return 'sync'
  return null
}

/** Whether `createEntitiesBatch` accepts this definition (see `batch-create-audit.ts`). */
export async function canBatchCreate(
  organizationId: string,
  entityDefinitionId: string
): Promise<boolean> {
  const resource = await findCachedResource(organizationId, entityDefinitionId)
  if (!resource || resource.type !== 'custom') return false
  const fields = await getCachedCustomFields(organizationId, resource.entityDefinitionId)
  const { planBatchCreate } = await import('./batch-create-audit')
  return planBatchCreate(resource, fields).ok
}

/**
 * Create every item as a record of one definition, inside the caller's transaction. Refuses an
 * ineligible definition, a lane other than quiet or sync, and any item it would write differently
 * from `createEntity`; a field that fails to convert fails the batch instead of being dropped.
 * On a sync session each record is captured in the collector exactly as `createEntity` captures it.
 */
export async function createEntitiesBatch(
  ctx: BatchCreateCtx,
  entityDefinitionId: string,
  items: Record<string, unknown>[]
): Promise<Result<BatchCreatedRecord[], Error>> {
  return guard(
    async () => {
      if (items.length === 0) return []
      if (!batchCreateLane(ctx.session)) {
        throw new UnprocessableEntityError(
          'The batched create runs on a quiet or sync session only'
        )
      }
      // The ambient scope `UnifiedCrudHandler` wraps each write in: the inverse announce and any
      // handler a hook builds read the session and connection from it.
      return runWithDirtyParents(ctx.organizationId, ctx.userId, () =>
        runWithWriteSession(ctx.session, () =>
          runWithWriteDb(ctx.db, () => createRecords(ctx, entityDefinitionId, items))
        )
      )
    },
    'Batched create failed',
    { organizationId: ctx.organizationId, entityDefinitionId, count: items.length }
  )
}

async function createRecords(
  ctx: BatchCreateCtx,
  entityDefinitionId: string,
  items: Record<string, unknown>[]
): Promise<BatchCreatedRecord[]> {
  const { db, organizationId, userId, session } = ctx
  const deps = await loadWriteDeps()
  const resource = await findCachedResource(organizationId, entityDefinitionId)
  if (!resource) throw new NotFoundError(`Entity definition not found: ${entityDefinitionId}`)
  const entityDef = {
    id: resource.entityDefinitionId ?? resource.id,
    entityType: resource.entityType ?? null,
    apiSlug: resource.apiSlug,
  }
  const resourceFields = resource.fields ?? []
  const fields = await getCachedCustomFields(organizationId, entityDef.id)
  const plan = deps.planBatchCreate(resource, fields)
  if (!plan.ok) throw new UnprocessableEntityError(`Cannot batch this create: ${plan.reason}`)

  const fieldMap = await getCachedFieldMap(organizationId, entityDef.id)
  const fvCtx = createFieldValueContext(organizationId, userId, db, undefined, {
    bypassFieldGuards: ctx.bypassFieldGuards,
    session,
  })
  const entityDefinition = {
    id: entityDef.id,
    primaryDisplayFieldId: resource.display?.primaryDisplayField?.id ?? null,
    secondaryDisplayFieldId: resource.display?.secondaryDisplayField?.id ?? null,
    avatarFieldId: resource.display?.avatarField?.id ?? null,
  }
  const cachedField = (fieldId: string): CachedField | undefined => {
    const hit = fvCtx.fieldCache.get(fieldId)
    if (hit) return hit
    const f = fieldMap.get(fieldId)
    if (!f) return undefined
    const withDef = { ...f, entityDefinition } as CachedField
    fvCtx.fieldCache.set(fieldId, withDef)
    return withDef
  }
  const def: DefContext = {
    userId,
    entityDef,
    fields,
    fvCtx,
    cachedField,
    collector: session.origin.kind === 'sync' ? session.origin.collector : null,
  }

  // createEntity's steps before its insert. Numbers come after the required check, as the hook does.
  const defaulted = items.map((item) => {
    assertOriginMayWriteFields(session.origin, resourceFields, Object.keys(item), 'create')
    const values = applyDefaults(item, resourceFields)
    assertRequiredFieldsPresent(fields, values)
    return values
  })
  const preassigned = await allocateRanges(organizationId, plan.ranges, fields, items.length)
  const prepared: Array<Pick<PendingRecord, 'display' | 'writes' | 'values'>> = []
  for (const [index, values] of defaulted.entries()) {
    prepared.push(
      await prepareRecord(deps, def, resource, values, preassignedAt(preassigned, index))
    )
  }

  // One instance insert; pg returns RETURNING rows in VALUES order.
  const now = new Date()
  const inserted = await db
    .insert(schema.EntityInstance)
    .values(
      prepared.map(({ display }) => ({
        entityDefinitionId: entityDef.id,
        organizationId,
        createdById: userId || null,
        displayName: display.columns.displayName ?? null,
        secondaryDisplayValue: display.columns.secondaryDisplayValue ?? null,
        avatarUrl: null,
        metadata: null,
        lastActivityAt: now,
        updatedAt: now,
      }))
    )
    .returning({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
  if (inserted.length !== prepared.length) {
    throw new Error('The batched instance insert returned the wrong number of rows')
  }
  const records: PendingRecord[] = prepared.map((p, index) => ({
    ...p,
    id: inserted[index]!.id,
    recordId: toRecordId(entityDef.id, inserted[index]!.id),
    typed: new Map(),
  }))

  // Sync capture before any field write, as `createEntity` registers the create first.
  if (def.collector) {
    const wantsValues = def.collector.subscriptionsFor(entityDef.id)?.lifecycle.created
    for (const record of records) {
      let createdValues: Record<string, unknown> | undefined
      if (wantsValues) {
        const extracted = extractEventData(entityDef.entityType, fields, record.values)
        if (Object.keys(extracted).length > 0) createdValues = extracted
      }
      def.collector.recordCreated(record.recordId, createdValues)
    }
  }

  await validateRelationshipTargets(def, records)
  for (const record of records) await convertValues(deps, def, record)

  const stored = await insertValues(deps, def, records)
  await settleDisplay(deps, def, records)
  await syncInverseRows(def, records)
  if (def.collector) captureSyncWrites(deps, def, records, stored)
  await flushDerived(deps, def, records)

  return records.map((record, index) => ({
    id: record.id,
    recordId: record.recordId,
    createdAt: inserted[index]!.createdAt,
    values: record.values,
  }))
}

/** One range per audited autonumber the org has a field for, allocated once for the whole batch. */
async function allocateRanges(
  organizationId: string,
  ranges: ReadonlyArray<{
    systemAttribute: string
    scope: Parameters<typeof recordNumbering.createRange>[1]
  }>,
  fields: readonly CustomFieldEntity[],
  count: number
): Promise<Map<string, string[]>> {
  const numbers = new Map<string, string[]>()
  for (const { systemAttribute, scope } of ranges) {
    if (!fields.some((field) => field.systemAttribute === systemAttribute)) continue
    const { recordNumbers } = await recordNumbering.createRange(organizationId, scope, count)
    numbers.set(systemAttribute, recordNumbers)
  }
  return numbers
}

function preassignedAt(ranges: Map<string, string[]>, index: number): Map<string, unknown> {
  return new Map([...ranges].map(([attr, numbers]) => [attr, numbers[index]]))
}

/** One item through the system and entity pre-create hooks, its display columns and its writes. */
async function prepareRecord(
  deps: WriteDeps,
  def: DefContext,
  resource: NonNullable<Awaited<ReturnType<typeof findCachedResource>>>,
  values: Record<string, unknown>,
  preassigned: Map<string, unknown>
): Promise<Pick<PendingRecord, 'display' | 'writes' | 'values'>> {
  const { entityDef, fields, fvCtx, cachedField } = def
  const { organizationId } = fvCtx
  const { userId } = def
  const processed = await deps.runSystemPreHooks(
    { operation: 'create', entityDef, values, organizationId, userId, allFields: fields },
    preassigned
  )
  for (const hook of deps.getEntityPreCreateHooks(entityDef.apiSlug)) {
    await hook({
      entityDefinitionId: entityDef.id,
      entityType: entityDef.entityType,
      entitySlug: entityDef.apiSlug,
      values: processed,
      organizationId,
      userId,
    })
  }
  const display = await deps.computeCreateDisplayColumns(
    organizationId,
    {
      primaryDisplayFieldId: resource.display?.primaryDisplayField?.id,
      secondaryDisplayFieldId: resource.display?.secondaryDisplayField?.id,
    },
    fields,
    processed
  )
  const keyToId = new Map(fields.map((f) => [f.systemAttribute ?? f.name, f.id]))
  const resolved = await resolveFieldIds(
    organizationId,
    Object.entries(processed)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({ fieldId: keyToId.get(key) ?? key, value }))
  )
  const writes = new Map<string, unknown>()
  for (const { fieldId, value } of resolved) {
    const field = cachedField(fieldId)
    if (isBuiltInField(fieldId, getModelType(entityDef.id)) || field?.type === 'NAME') {
      throw new UnprocessableEntityError(`The batched create cannot write field ${fieldId}`)
    }
    writes.set(fieldId, value)
  }
  return { display, writes, values: processed }
}

/** Relationship targets, validated once for every record. */
async function validateRelationshipTargets(
  def: DefContext,
  records: readonly PendingRecord[]
): Promise<void> {
  const values: unknown[] = []
  for (const record of records) {
    for (const [fieldId, value] of record.writes) {
      if (def.cachedField(fieldId)?.type === 'RELATIONSHIP' && value != null) values.push(value)
    }
  }
  if (values.length === 0) return
  await preBatchValidateRelationships(
    def.fvCtx,
    values,
    values.map(() => 'RELATIONSHIP' as const)
  )
}

/** `writeFreshValues`' per-field loop for one record: convert, field pre-hooks, relationship checks. */
async function convertValues(
  deps: WriteDeps,
  def: DefContext,
  record: PendingRecord
): Promise<void> {
  const { entityDef, fvCtx, cachedField } = def
  for (const [fieldId, rawValue] of record.writes) {
    const field = cachedField(fieldId)
    if (!field) throw new UnprocessableEntityError(`Field ${fieldId} not found`)
    const fieldType = toFieldType(field.type)
    const coerced = await validateAndConvertValue(fvCtx, rawValue, fieldType, field)
    const outcome = await deps.fireFieldPreHooks(fvCtx, {
      recordId: record.recordId,
      field,
      typedValue: coerced,
      existingValue: undefined,
      allValues: record.writes,
      entitySlug: entityDef.apiSlug,
      entityType: entityDef.entityType,
    })
    if (outcome.kind === 'drop' || outcome.value === null) continue
    let typed: TypedFieldValueInput | TypedFieldValueInput[] | null = outcome.value
    if (fieldType === 'RELATIONSHIP') {
      typed = await canonicalizeRelationshipValue(fvCtx, typed)
      await deps.validateRelationshipValue(fvCtx, {
        entityId: record.id,
        entityDefinitionId: entityDef.id,
        fieldId,
        field,
        newValue: typed,
      })
    }
    if (typed === null) continue
    const values = (Array.isArray(typed) ? typed : [typed]).filter(
      (v): v is TypedFieldValueInput => v !== null
    )
    if (values.length > 0) record.typed.set(fieldId, values)
  }
}

function relatedIds(values: readonly TypedFieldValueInput[]): string[] {
  return values.flatMap((v) =>
    v.type === 'relationship' && v.recordId ? [parseRecordId(v.recordId).entityInstanceId] : []
  )
}

/** One `FieldValue` insert per chunk; the stored rows come back only when a sync capture needs them. */
async function insertValues(
  deps: WriteDeps,
  def: DefContext,
  records: readonly PendingRecord[]
): Promise<FieldValueRow[]> {
  const { entityDef, fvCtx, cachedField } = def
  const rows: FieldValueInsert[] = []
  for (const record of records) {
    for (const [fieldId, values] of record.typed) {
      const field = cachedField(fieldId)!
      const sortKeys = nKeysAfter(null, values.length)
      values.forEach((value, index) => {
        rows.push(
          deps.buildFieldValueRow({
            organizationId: fvCtx.organizationId,
            entityId: record.id,
            entityDefinitionId: entityDef.id,
            fieldId,
            fieldType: toFieldType(field.type),
            value,
            sortKey: sortKeys[index]!,
            currencyOptions: field.options as never,
          })
        )
      })
    }
  }
  const stored: FieldValueRow[] = []
  for (let start = 0; start < rows.length; start += VALUE_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + VALUE_INSERT_CHUNK)
    if (def.collector) {
      const returned = await fvCtx.db.insert(schema.FieldValue).values(chunk).returning()
      stored.push(...(returned as unknown as FieldValueRow[]))
    } else {
      await fvCtx.db.insert(schema.FieldValue).values(chunk)
    }
  }
  return stored
}

/**
 * The display columns the insert carried, checked against what was stored, as `writeFreshValues`
 * does. A relationship display column is resolved for every record in one read and one update
 * when the lane sends no per-record column frame and nothing cascades from it.
 */
async function settleDisplay(
  deps: WriteDeps,
  def: DefContext,
  records: readonly PendingRecord[]
): Promise<void> {
  const { entityDef, fvCtx, cachedField } = def
  const session = fvCtx.session
  const deferRelationships =
    (session?.origin.kind === 'sync' || isCoveredQuiet(session)) &&
    (await deps.getDisplayFieldDeps(fvCtx.organizationId, entityDef.entityType ?? entityDef.id))
      .length === 0
  const deferred: Array<{ record: PendingRecord; column: DisplayColumn; target: RecordId | null }> =
    []

  for (const record of records) {
    const kept: Array<string | null> = []
    for (const [fieldId, values] of record.typed) {
      const field = cachedField(fieldId)!
      const value = values.length === 1 ? values[0]! : values
      const precomputed = record.display.byFieldId.get(fieldId)
      const column = displayColumnOf(field)
      if (
        precomputed !== undefined &&
        precomputed === (await formatDisplayColumnText(fvCtx.organizationId, field, value))
      ) {
        kept.push(precomputed)
      } else if (deferRelationships && column && field.type === 'RELATIONSHIP') {
        const first = values[0]
        const target = first?.type === 'relationship' && first.recordId ? first.recordId : null
        deferred.push({ record, column, target })
      } else {
        await maybeUpdateDisplayValue(fvCtx, record.recordId, field, value, {
          skipSearchTextRefresh: true,
        })
      }
    }
    await deps.settleInsertedDisplay(
      fvCtx,
      record.recordId,
      entityDef.entityType,
      record.display.byFieldId,
      {
        kept,
        written: [...record.typed.keys()],
        cachedField,
      }
    )
  }
  await writeRelationshipDisplay(fvCtx, deferred)
}

type DisplayColumn = 'displayName' | 'secondaryDisplayValue'

function displayColumnOf(field: CachedField): DisplayColumn | null {
  const def = field.entityDefinition
  if (def?.primaryDisplayFieldId === field.id) return 'displayName'
  if (def?.secondaryDisplayFieldId === field.id) return 'secondaryDisplayValue'
  return null
}

/** `maybeUpdateDisplayValue`'s relationship branch for many records: the targets' names, one UPDATE. */
async function writeRelationshipDisplay(
  fvCtx: FieldValueContext,
  deferred: ReadonlyArray<{ record: PendingRecord; column: DisplayColumn; target: RecordId | null }>
): Promise<void> {
  if (deferred.length === 0) return
  const targets = [...new Set(deferred.flatMap((d) => (d.target ? [d.target] : [])))]
  const names = await batchGetRelatedDisplayNames(fvCtx.db, fvCtx.organizationId, targets)
  const now = new Date()
  for (const column of ['displayName', 'secondaryDisplayValue'] as const) {
    const rows = deferred.filter((d) => d.column === column)
    if (rows.length === 0) continue
    const pairs = rows.map((d) => {
      const text = d.target ? (names.get(parseRecordId(d.target).entityInstanceId) ?? null) : null
      return sql`(${d.record.id}::text, ${text}::text)`
    })
    await fvCtx.db.execute(sql`
      UPDATE "EntityInstance" AS ei
      SET ${sql.identifier(column)} = v.text, "updatedAt" = ${now}
      FROM (VALUES ${sql.join(pairs, sql`, `)}) AS v(id, text)
      WHERE ei.id = v.id AND ei."organizationId" = ${fvCtx.organizationId}
    `)
  }
}

/**
 * One `syncInverseRelationshipsBulk` per relationship field with an inverse, over every record.
 * Two records claiming one target through a single-valued inverse would re-parent it one after
 * the other on the per-record path, and keep both claims here: refused.
 */
async function syncInverseRows(def: DefContext, records: readonly PendingRecord[]): Promise<void> {
  const byField = new Map<string, { info: InverseFieldInfo; updates: BulkRelationshipUpdate[] }>()
  for (const record of records) {
    for (const [fieldId, values] of record.typed) {
      const field = def.cachedField(fieldId)!
      if (field.type !== 'RELATIONSHIP') continue
      let entry = byField.get(fieldId)
      if (!entry) {
        const info = await getInverseInfoFromField(def.fvCtx, field)
        if (!info) continue
        entry = { info, updates: [] }
        byField.set(fieldId, entry)
      }
      entry.updates.push({
        entityId: record.id,
        oldRelatedIds: [],
        newRelatedIds: relatedIds(values),
      })
    }
  }
  for (const { info, updates } of byField.values()) {
    if (
      info.inverseRelationshipType !== 'belongs_to' &&
      info.inverseRelationshipType !== 'has_one'
    ) {
      continue
    }
    const targets = updates.flatMap((update) => update.newRelatedIds)
    if (new Set(targets).size !== targets.length) {
      throw new UnprocessableEntityError(
        'Two records in one batch claim one target of a single-valued inverse'
      )
    }
  }
  const createdIds = new Set(records.map((record) => record.id))
  for (const { info, updates } of byField.values()) {
    await syncInverseRelationshipsBulk(
      { db: def.fvCtx.db, organizationId: def.fvCtx.organizationId },
      { updates, inverseInfo: info, createdIds }
    )
  }
}

/** `writeFreshValues`' sync capture per written field: `{n}` with no `o`, from the stored rows. */
function captureSyncWrites(
  deps: WriteDeps,
  def: DefContext,
  records: readonly PendingRecord[],
  stored: readonly FieldValueRow[]
): void {
  const collector = def.collector!
  const byKey = new Map<string, FieldValueRow[]>()
  for (const row of stored) {
    const key = `${row.entityId}:${row.fieldId}`
    byKey.set(key, [...(byKey.get(key) ?? []), row])
  }
  for (const record of records) {
    for (const fieldId of record.typed.keys()) {
      const field = def.cachedField(fieldId)!
      const fieldType = toFieldType(field.type)
      const typed: TypedFieldValue[] = (byKey.get(`${record.id}:${fieldId}`) ?? [])
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
        .map((row) => rowToTypedValue(row, fieldType))
      const subscribed = deps.isDeltaSubscribed(collector, field, fieldId, def.entityDef.id)
      deps.captureSyncFieldWrite({
        collector,
        subscribed,
        recordId: record.recordId,
        field,
        fieldId,
        oldValues: subscribed ? [] : null,
        newValues: typed,
      })
    }
  }
}

/** `flushInstanceDerived`'s per-record flags, one UPDATE per distinct combination. */
async function flushDerived(
  deps: WriteDeps,
  def: DefContext,
  records: readonly PendingRecord[]
): Promise<void> {
  const groups = new Map<string, string[]>()
  for (const record of records) {
    const written = [...record.typed.keys()].map((fieldId) => def.cachedField(fieldId)!)
    if (written.length === 0) continue
    const key = written.some((field) => deps.fieldFeedsSearchCorpus(field)) ? 'refresh' : 'stamp'
    groups.set(key, [...(groups.get(key) ?? []), record.id])
  }
  for (const [key, ids] of groups) {
    await flushInstancesDerived(def.fvCtx.db, def.fvCtx.organizationId, ids, {
      stampUpdatedAt: true,
      refreshSearchText: key === 'refresh',
    })
  }
}

/**
 * A sync session whose collector holds this batch's captures until `commit`, so a batch that
 * rolls back leaves nothing in the manifest. Any other session passes through.
 */
export function stageSyncCaptures(session: WriteSession): {
  session: WriteSession
  commit: () => void
} {
  const origin = session.origin
  if (origin.kind !== 'sync') return { session, commit: () => {} }
  const real = origin.collector
  const ops: Array<(collector: ManifestCollector) => void> = []
  const created = new Set<string>()
  const staged: ManifestCollector = {
    subscriptionsFor: (defId) => real.subscriptionsFor(defId),
    recordTouched: (recordId, keys) => ops.push((c) => c.recordTouched(recordId, keys)),
    recordChange: (recordId, entries) => ops.push((c) => c.recordChange(recordId, entries)),
    recordCreated: (recordId, values) => {
      created.add(parseRecordId(recordId).entityInstanceId)
      ops.push((c) => c.recordCreated(recordId, values))
    },
    hasCreated: (recordId) =>
      created.has(parseRecordId(recordId).entityInstanceId) || real.hasCreated(recordId),
    recordArchived: (recordId) => ops.push((c) => c.recordArchived(recordId)),
    recordMirrorTouched: (recordId, keys) => ops.push((c) => c.recordMirrorTouched(recordId, keys)),
    toJson: () => real.toJson(),
  }
  return {
    session: { ...session, origin: { ...origin, collector: staged } },
    commit: () => {
      for (const op of ops) op(real)
      ops.length = 0
    },
  }
}

/** The instance rows a batch wrote, as `createEntity` returns its own after the flush. */
export async function readCreatedInstances(
  db: Database,
  organizationId: string,
  ids: readonly string[]
): Promise<Array<typeof schema.EntityInstance.$inferSelect>> {
  if (ids.length === 0) return []
  const rows = await db
    .select()
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, ids as string[]),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}
