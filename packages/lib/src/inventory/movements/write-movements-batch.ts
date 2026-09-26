// packages/lib/src/inventory/movements/write-movements-batch.ts

/**
 * `writeStockMovementsBatch` - `writeStockMovements` for many legs in a handful of statements, on
 * the quiet lane only. It runs `createEntity`'s steps per record in memory and each write once for
 * all records, so the stored rows match the per-row CRUD path (plans/mrp/10-batched-build-writes.md §2).
 */

import { schema } from '@auxx/database'
import type { TypedFieldValueInput } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { nKeysAfter } from '@auxx/utils/fractional-indexing'
import type { Result } from 'neverthrow'
import { findCachedResource, getCachedCustomFields, getCachedFieldMap } from '../../cache'
import { isBuiltInField } from '../../custom-fields/built-in-fields'
import { UnprocessableEntityError } from '../../errors'
import type { CreateDisplayColumns } from '../../field-values/create-values'
import {
  type CachedField,
  canonicalizeRelationshipValue,
  createFieldValueContext,
  type FieldValueContext,
  formatDisplayColumnText,
  getInverseInfoFromField,
  maybeUpdateDisplayValue,
  preBatchValidateRelationships,
  resolveFieldIds,
  validateAndConvertValue,
} from '../../field-values/field-value-helpers'
import { flushInstancesDerived } from '../../field-values/instance-derived'
import {
  type BulkRelationshipUpdate,
  type InverseFieldInfo,
  syncInverseRelationshipsBulk,
} from '../../field-values/relationship-sync'
import { toFieldType } from '../../field-values/stored-field-type'
import { assertOriginMayWriteFields } from '../../field-values/write-guard'
import { runWithDirtyParents } from '../../reconcilers/dirty-parents'
import { applyDefaults, assertRequiredFieldsPresent } from '../../resources/crud/create-defaults'
import type { WriteSession } from '../../resources/crud/write-origin'
import { runWithWriteDb, runWithWriteSession } from '../../resources/crud/write-session-als'
import { getModelType, parseRecordId, toRecordId } from '../../resources/resource-id'
import { movementFactFromInput } from './fact/live'
import { insertMovementFacts } from './fact/writes'
import { guard } from './guard'
import type {
  StockMovementInput,
  StockMovementsCtx,
  WriteStockMovementsResult,
  WrittenStockMovement,
} from './types'
import { assertNoServiceParts, movementValues } from './write-movements'

type FieldValueInsert = typeof schema.FieldValue.$inferInsert

/** Lazy: the hook and field-write graph is heavy, and the movements barrel is imported widely. */
async function loadWriteDeps() {
  const [registry, createValues, mutations, hooks] = await Promise.all([
    import('../../field-hooks/registry'),
    import('../../field-values/create-values'),
    import('../../field-values/field-value-mutations'),
    import('../../resources/hooks'),
  ])
  return {
    getEntityPreCreateHooks: registry.getEntityPreCreateHooks,
    computeCreateDisplayColumns: createValues.computeCreateDisplayColumns,
    settleInsertedDisplay: createValues.settleInsertedDisplay,
    buildFieldValueRow: mutations.buildFieldValueRow,
    fieldFeedsSearchCorpus: mutations.fieldFeedsSearchCorpus,
    fireFieldPreHooks: mutations.fireFieldPreHooks,
    validateRelationshipValue: mutations.validateRelationshipValue,
    runSystemPreHooks: hooks.runSystemPreHooks,
  }
}

type WriteDeps = Awaited<ReturnType<typeof loadWriteDeps>>

/** Rows per `FieldValue` insert; ~15 bound columns a row keeps a statement far below pg's 65535. */
const VALUE_INSERT_CHUNK = 2000

/** One record between its instance insert and its value insert. */
interface PendingRecord {
  id: string
  recordId: RecordId
  display: CreateDisplayColumns
  /** fieldId -> raw value, after defaults and system hooks; the last key for a field wins. */
  writes: Map<string, unknown>
  /** fieldId -> typed values to store, in write order; a field with none is left empty. */
  typed: Map<string, TypedFieldValueInput[]>
}

/**
 * Write `stock_movement` rows for every input in one pass, inside the caller's transaction.
 *
 * Refuses what it does not replicate - a non-quiet lane, reversals, parent links,
 * `adjustSubparts: true` - rather than writing it differently; use `writeStockMovements` for those.
 * Unlike a CRUD create, a field that fails to convert fails the whole batch instead of being dropped.
 */
export async function writeStockMovementsBatch(
  ctx: StockMovementsCtx,
  inputs: StockMovementInput[]
): Promise<Result<WriteStockMovementsResult, Error>> {
  return guard(
    async () => {
      if (inputs.length === 0) return { records: [], affectedPartIds: [] }
      const session = requireQuietSession(ctx)
      assertBatchableInputs(inputs)
      await assertNoServiceParts(ctx, inputs)

      const bags: Record<string, unknown>[] = []
      for (const input of inputs) bags.push(await movementValues(ctx, input))

      // The ambient scope `UnifiedCrudHandler` wraps each write in: the inverse announce and
      // any handler a hook builds read the session and connection from it.
      const created = await runWithDirtyParents(ctx.organizationId, ctx.userId, () =>
        runWithWriteSession(session, () =>
          runWithWriteDb(ctx.db, () => createFreshRecords(ctx, session, bags))
        )
      )

      await insertMovementFacts(
        ctx.db,
        ctx.organizationId,
        inputs.map((input, index) =>
          movementFactFromInput(created[index]!.id, created[index]!.createdAt, input, new Map())
        )
      )

      const records: WrittenStockMovement[] = inputs.map((input, index) => ({
        movementId: created[index]!.id,
        recordId: toRecordId(ctx.movementDefId, created[index]!.id),
        partInstanceId: input.partInstanceId,
        quantity: input.quantity,
        unitCost: input.unitCost,
        extendedCost: (bags[index]!.stock_movement_extended_cost as number | undefined) ?? null,
        glAccount: input.glAccount ?? null,
        occurredAt: input.occurredAt,
      }))
      return {
        records,
        affectedPartIds: [...new Set(inputs.map((input) => input.partInstanceId))],
      }
    },
    'Failed to write stock movements',
    { organizationId: ctx.organizationId, count: inputs.length }
  )
}

/** A quiet, non-sync session: the lane whose create publishes nothing this writer must replay. */
function requireQuietSession(ctx: StockMovementsCtx): WriteSession {
  const session = ctx.lane.kind === 'quiet' ? ctx.lane.session : null
  if (!session || session.mode?.kind !== 'quiet' || session.origin.kind === 'sync') {
    throw new UnprocessableEntityError('The batched movement writer runs on a quiet session only')
  }
  return session
}

function assertBatchableInputs(inputs: readonly StockMovementInput[]): void {
  for (const input of inputs) {
    if (input.links?.reversesMovementId || input.links?.parentMovementId) {
      throw new UnprocessableEntityError(
        'The batched movement writer does not write reversals or exploded child movements'
      )
    }
    if (input.adjustSubparts) {
      throw new UnprocessableEntityError(
        'The batched movement writer does not write movements that adjust subparts'
      )
    }
  }
}

/**
 * `createEntity` + `writeFreshValues` for N records of one definition, in call order: instances,
 * values, display columns, inverse rows, derived columns. Returns the instances in input order.
 */
async function createFreshRecords(
  ctx: StockMovementsCtx,
  session: WriteSession,
  bags: Record<string, unknown>[]
): Promise<Array<{ id: string; createdAt: Date }>> {
  const { db, organizationId, userId } = ctx
  const deps = await loadWriteDeps()
  const resource = await findCachedResource(organizationId, ctx.movementDefId)
  if (!resource) throw new Error(`Entity definition not found: ${ctx.movementDefId}`)
  const entityDef = {
    id: resource.entityDefinitionId ?? resource.id,
    entityType: resource.entityType ?? null,
    apiSlug: resource.apiSlug,
  }
  const resourceFields = resource.fields ?? []
  const fields = await getCachedCustomFields(organizationId, entityDef.id)
  const keyToId = new Map(fields.map((f) => [f.systemAttribute ?? f.name, f.id]))
  const preCreateHooks = deps.getEntityPreCreateHooks(entityDef.apiSlug)
  const displayIds = {
    primaryDisplayFieldId: resource.display?.primaryDisplayField?.id,
    secondaryDisplayFieldId: resource.display?.secondaryDisplayField?.id,
  }

  const fieldMap = await getCachedFieldMap(organizationId, entityDef.id)
  const fvCtx = createFieldValueContext(organizationId, userId, db, undefined, {
    bypassFieldGuards: ctx.lane.kind === 'quiet' ? ctx.lane.bypassFieldGuards : undefined,
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
  const primary = entityDefinition.primaryDisplayFieldId
    ? cachedField(entityDefinition.primaryDisplayFieldId)
    : undefined
  if (primary?.type === 'NAME') {
    throw new UnprocessableEntityError('The batched writer does not compose NAME display names')
  }

  // createEntity's steps before the insert, per record.
  const prepared: Array<Pick<PendingRecord, 'display' | 'writes'>> = []
  for (const bag of bags) {
    assertOriginMayWriteFields(session.origin, resourceFields, Object.keys(bag), 'create')
    const defaulted = applyDefaults(bag, resourceFields)
    assertRequiredFieldsPresent(fields, defaulted)
    const processed = await deps.runSystemPreHooks({
      operation: 'create',
      entityDef,
      values: defaulted,
      organizationId,
      userId,
      allFields: fields,
    })
    for (const hook of preCreateHooks) {
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
      displayIds,
      fields,
      processed
    )
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
        throw new UnprocessableEntityError(`The batched writer cannot write field ${fieldId}`)
      }
      if (field?.isUnique && value !== null && value !== '') {
        throw new UnprocessableEntityError(
          `The batched writer cannot check unique field ${fieldId}`
        )
      }
      writes.set(fieldId, value)
    }
    prepared.push({ display, writes })
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
    throw new Error('Stock movement instance insert returned the wrong number of rows')
  }
  const records: PendingRecord[] = prepared.map((p, index) => ({
    ...p,
    id: inserted[index]!.id,
    recordId: toRecordId(entityDef.id, inserted[index]!.id),
    typed: new Map(),
  }))

  // Relationship targets, validated once for every record.
  const relationshipValues: unknown[] = []
  for (const record of records) {
    for (const [fieldId, value] of record.writes) {
      if (cachedField(fieldId)?.type === 'RELATIONSHIP' && value != null) {
        relationshipValues.push(value)
      }
    }
  }
  if (relationshipValues.length > 0) {
    await preBatchValidateRelationships(
      fvCtx,
      relationshipValues,
      relationshipValues.map(() => 'RELATIONSHIP' as const)
    )
  }

  for (const record of records) await convertValues(deps, fvCtx, entityDef, record, cachedField)

  const rows: FieldValueInsert[] = []
  for (const record of records) {
    for (const [fieldId, values] of record.typed) {
      const field = cachedField(fieldId)!
      const sortKeys = nKeysAfter(null, values.length)
      values.forEach((value, index) => {
        rows.push(
          deps.buildFieldValueRow({
            organizationId,
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
  for (let start = 0; start < rows.length; start += VALUE_INSERT_CHUNK) {
    await db.insert(schema.FieldValue).values(rows.slice(start, start + VALUE_INSERT_CHUNK))
  }

  for (const record of records) {
    await settleDisplay(deps, fvCtx, entityDef.entityType, record, cachedField)
  }
  await syncInverseRows(fvCtx, records, cachedField)
  await flushDerived(deps, ctx, records, cachedField)

  return inserted
}

/** `writeFreshValues`' per-field loop for one record: convert, field pre-hooks, relationship checks. */
async function convertValues(
  deps: WriteDeps,
  fvCtx: FieldValueContext,
  entityDef: { id: string; entityType: string | null; apiSlug: string },
  record: PendingRecord,
  cachedField: (fieldId: string) => CachedField | undefined
): Promise<void> {
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

/** The display columns the insert carried, checked against what was stored, as `writeFreshValues` does. */
async function settleDisplay(
  deps: WriteDeps,
  fvCtx: FieldValueContext,
  entityType: string | null,
  record: PendingRecord,
  cachedField: (fieldId: string) => CachedField | undefined
): Promise<void> {
  const kept: Array<string | null> = []
  for (const [fieldId, values] of record.typed) {
    const field = cachedField(fieldId)!
    const value = values.length === 1 ? values[0]! : values
    const precomputed = record.display.byFieldId.get(fieldId)
    if (
      precomputed !== undefined &&
      precomputed === (await formatDisplayColumnText(fvCtx.organizationId, field, value))
    ) {
      kept.push(precomputed)
    } else {
      await maybeUpdateDisplayValue(fvCtx, record.recordId, field, value, {
        skipSearchTextRefresh: true,
      })
    }
  }
  await deps.settleInsertedDisplay(fvCtx, record.recordId, entityType, record.display.byFieldId, {
    kept,
    written: [...record.typed.keys()],
    cachedField,
  })
}

/** One `syncInverseRelationshipsBulk` per relationship field with an inverse, over every record. */
async function syncInverseRows(
  fvCtx: FieldValueContext,
  records: readonly PendingRecord[],
  cachedField: (fieldId: string) => CachedField | undefined
): Promise<void> {
  const byField = new Map<string, { info: InverseFieldInfo; updates: BulkRelationshipUpdate[] }>()
  for (const record of records) {
    for (const [fieldId, values] of record.typed) {
      const field = cachedField(fieldId)!
      if (field.type !== 'RELATIONSHIP') continue
      let entry = byField.get(fieldId)
      if (!entry) {
        const info = await getInverseInfoFromField(fvCtx, field)
        if (!info) continue
        entry = { info, updates: [] }
        byField.set(fieldId, entry)
      }
      entry.updates.push({
        entityId: record.id,
        oldRelatedIds: [],
        newRelatedIds: values.flatMap((v) =>
          v.type === 'relationship' && v.recordId
            ? [parseRecordId(v.recordId).entityInstanceId]
            : []
        ),
      })
    }
  }
  const createdIds = new Set(records.map((record) => record.id))
  for (const { info, updates } of byField.values()) {
    await syncInverseRelationshipsBulk(
      { db: fvCtx.db, organizationId: fvCtx.organizationId },
      { updates, inverseInfo: info, createdIds }
    )
  }
}

/** `flushInstanceDerived`'s per-record flags, one UPDATE per distinct combination. */
async function flushDerived(
  deps: WriteDeps,
  ctx: StockMovementsCtx,
  records: readonly PendingRecord[],
  cachedField: (fieldId: string) => CachedField | undefined
): Promise<void> {
  const groups = new Map<string, string[]>()
  for (const record of records) {
    const written = [...record.typed.keys()].map((fieldId) => cachedField(fieldId)!)
    if (written.length === 0) continue
    const refresh = written.some((field) => deps.fieldFeedsSearchCorpus(field))
    const key = refresh ? 'refresh' : 'stamp'
    groups.set(key, [...(groups.get(key) ?? []), record.id])
  }
  for (const [key, ids] of groups) {
    await flushInstancesDerived(ctx.db, ctx.organizationId, ids, {
      stampUpdatedAt: true,
      refreshSearchText: key === 'refresh',
    })
  }
}
