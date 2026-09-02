// packages/lib/src/field-values/create-values.ts
//
// The create-only field write (plans/field-values/create-path-batching.md
// option A). `createEntity` inserts an `EntityInstance` row and then writes
// every field of it; through `setValuesForEntity` each field pays the full
// per-field machinery (advisory lock, in-lock re-read, savepoint, positional
// diff), every step of which is vacuous on a row no other session can see
// yet (section 2a): the stored row set is empty, provably, so the only plan
// is "insert all".
//
// This path keeps everything ABOVE the per-field loop (field resolution,
// relationship pre-validation, typed conversion, pre-hooks, uniqueness, NAME
// decomposition) and replaces the loop with ONE multi-row INSERT, then the
// derived work once per record: display columns, inverse sync, sync capture,
// one realtime frame, post-hooks, native triggers, and one derived-column
// flush. Per record that is 1 insert + 1 flush (+ display writes and inverse
// syncs the record actually needs) instead of ~5 statements per field.
//
// Hazard (section 6): it is only sound for an instance whose FieldValue set
// is EMPTY. The precondition is asserted, not assumed: one indexed probe, and
// any stored row sends the write to `writeValuesForEntity` unchanged. It is a
// separate entry point on purpose; no flag on the update path can select it.

import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import {
  isArrayReturnFieldType,
  type TypedFieldValue,
  type TypedFieldValueInput,
} from '@auxx/types'
import type { FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { nKeysAfter } from '@auxx/utils/fractional-indexing'
import { and, eq } from 'drizzle-orm'
import { getCachedFieldMap, getCachedResource } from '../cache'
import {
  getBuiltInFieldHandler,
  getBuiltInFieldType,
  isBuiltInField,
} from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { fieldTouchesActivity } from '../field-hooks/activity-touch'
import {
  collectTriggeredFields,
  deduplicateBySystemAttribute,
} from '../field-hooks/collect-triggers'
import { publishFieldTriggerEvents } from '../field-hooks/publish'
import {
  getEntityFieldChangeHooks,
  getFieldTypeChangeHooks,
  hasEntityFieldChangeHooks,
  hasFieldTypeChangeHooks,
} from '../field-hooks/registry'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { getAmbientTxWriteScope, isTxWriteCreated } from '../resources/crud/tx-write-scope'
import { isDeclaredSilent } from '../resources/crud/write-origin'
import { getModelType, parseRecordId, toRecordId } from '../resources/resource-id'
import {
  type CachedField,
  canonicalizeRelationshipValue,
  type FieldValueContext,
  getInverseInfoFromField,
  maybeUpdateDisplayValue,
  preBatchValidateRelationships,
  recomposeNameDisplayFromParts,
  resolveFieldIds,
  rowToTypedValue,
  validateAndConvertValue,
} from './field-value-helpers'
import {
  buildFieldValueRow,
  buildPublishEntry,
  captureSyncFieldWrite,
  fieldFeedsSearchCorpus,
  fireFieldPreHooks,
  isDeltaSubscribed,
  syncCollectorOf,
  validateRelationshipValue,
  type WriteValuesForEntityResult,
  writeValuesForEntity,
} from './field-value-mutations'
import { formatToTypedInput } from './formatter'
import { flushInstanceDerived } from './instance-derived'
import { coerceNameInput, readNameParts } from './name-parts'
import { syncInverseRelationships } from './relationship-sync'
import { toFieldType } from './stored-field-type'
import { resolveFieldChangeSnapshotPair } from './timeline-snapshot'
import type { FieldValueRow, SetValuesForEntityInput, SetValuesResult } from './types'

const logger = createScopedLogger('field-values:create')

type InsertRow = typeof schema.FieldValue.$inferInsert

/** One custom field of the create, after conversion and pre-hooks. */
interface PreparedField {
  fieldId: string
  field: CachedField
  /** Typed values to store; empty when the field is being left empty. */
  values: TypedFieldValueInput[]
  /** `true` when a pre-hook dropped the write (reported `changed: false`). */
  dropped: boolean
}

/**
 * Write the fields of an instance `createEntity` inserted in this same call,
 * with one multi-row INSERT. Takes the update path (`writeValuesForEntity`)
 * whenever the precondition does not hold: the instance already has stored
 * values, or the write runs inside a buffered transaction scope that did not
 * register this record as created.
 */
export async function createValuesForEntity(
  ctx: FieldValueContext,
  params: SetValuesForEntityInput
): Promise<WriteValuesForEntityResult> {
  const { recordId } = params
  const { entityInstanceId } = parseRecordId(recordId)

  const requestedPublish = params.publishEvents ?? !isDeclaredSilent(ctx.session)
  const bufferedScope = requestedPublish ? getAmbientTxWriteScope(ctx.session) : undefined
  if (bufferedScope && !isTxWriteCreated(bufferedScope, recordId)) {
    return writeValuesForEntity(ctx, params)
  }

  // The precondition, asserted: a fresh instance has no rows. Anything else
  // (a caller handing us an existing record, a retry after a partial write)
  // is an UPDATE and goes through the reconcile.
  const [existing] = await ctx.db
    .select({ id: schema.FieldValue.id })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .limit(1)
  if (existing) {
    logger.warn('createValuesForEntity called for an instance with stored values; reconciling', {
      recordId,
    })
    return writeValuesForEntity(ctx, params)
  }

  return writeFreshValues(ctx, { ...params, publishEvents: requestedPublish && !bufferedScope })
}

async function writeFreshValues(
  ctx: FieldValueContext,
  params: SetValuesForEntityInput & { publishEvents: boolean }
): Promise<WriteValuesForEntityResult> {
  const {
    recordId,
    values,
    publishEvents,
    skipInverseSync = false,
    skipSearchTextRefresh = false,
    skipInstanceStamp = false,
  } = params
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const modelType = getModelType(entityDefinitionId)
  const announce = publishEvents && ctx.userId !== undefined

  const validValues = await resolveFieldIds(
    ctx.organizationId,
    values.filter((v) => v.value !== undefined)
  )
  if (validValues.length === 0) return { results: [], instance: null }

  const results: SetValuesResult[] = []
  const performedAt = new Date().toISOString()

  // ---- built-in fields: same handler dispatch as the update path --------
  const customs: typeof validValues = []
  for (const v of validValues) {
    if (!isBuiltInField(v.fieldId, modelType)) {
      customs.push(v)
      continue
    }
    const handler = getBuiltInFieldHandler(v.fieldId, modelType)
    if (handler) await handler(ctx.db, entityInstanceId, v.value, ctx.organizationId)
    syncCollectorOf(ctx.session)?.recordTouched(recordId, [v.fieldId])
    const builtInFieldType = getBuiltInFieldType(v.fieldId, modelType)
    const typedInput =
      v.value !== null && builtInFieldType ? formatToTypedInput(v.value, builtInFieldType) : null
    results.push({
      fieldId: v.fieldId,
      state: 'complete',
      performedAt,
      values: typedInput
        ? [
            {
              id: `builtin-${v.fieldId}-${entityInstanceId}`,
              entityId: entityInstanceId,
              fieldId: v.fieldId,
              sortKey: '',
              createdAt: performedAt,
              updatedAt: performedAt,
              ...typedInput,
            } as TypedFieldValue,
          ]
        : [],
      changed: !!handler,
    })
  }
  if (customs.length === 0) return { results, instance: null }

  // ---- metadata, once per record ----------------------------------------
  const fieldMap = await getCachedFieldMap(ctx.organizationId, entityDefinitionId)
  const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)
  const entityDefinition = resource
    ? {
        id: resource.entityDefinitionId ?? resource.id,
        primaryDisplayFieldId: resource.display.primaryDisplayField?.id ?? null,
        secondaryDisplayFieldId: resource.display.secondaryDisplayField?.id ?? null,
        avatarFieldId: resource.display.avatarField?.id ?? null,
      }
    : null
  const entitySlug = resource?.apiSlug ?? ''
  const entityType = resource?.entityType ?? null
  const cachedField = (fieldId: string): CachedField | undefined => {
    const hit = ctx.fieldCache.get(fieldId)
    if (hit) return hit
    const f = fieldMap.get(fieldId)
    if (!f) return undefined
    const withDef = { ...f, entityDefinition } as CachedField
    ctx.fieldCache.set(fieldId, withDef)
    return withDef
  }
  for (const v of customs) cachedField(v.fieldId)

  // ---- NAME decomposition (name-field-writes.md section 4) --------------
  // A NAME field owns no storage: its value fans out to its two TEXT parts.
  // Composite entries resolve first so an explicit part in the same write
  // wins over the split (section 4b), exactly as the update path orders them.
  const writes = new Map<string, unknown>()
  const nameResults: Array<{ fieldId: string; parts: [string, string] }> = []
  const composite = customs.filter((c) => {
    const f = cachedField(c.fieldId)
    return f?.type === 'NAME' && readNameParts(f) !== null
  })
  for (const c of composite) {
    const parts = readNameParts(cachedField(c.fieldId)!)!
    const coerced = coerceNameInput(c.value)
    writes.set(parts.firstNameFieldId, coerced?.firstName ?? null)
    writes.set(parts.lastNameFieldId, coerced?.lastName ?? null)
    nameResults.push({ fieldId: c.fieldId, parts: [parts.firstNameFieldId, parts.lastNameFieldId] })
  }
  for (const c of customs) {
    if (composite.includes(c)) continue
    writes.set(c.fieldId, c.value)
  }

  // ---- relationship pre-validation, once for every id in the write -----
  const relationshipValues: unknown[] = []
  const relationshipTypes: FieldType[] = []
  for (const [fieldId, value] of writes) {
    const f = cachedField(fieldId)
    if (f?.type === 'RELATIONSHIP' && value !== null && value !== undefined) {
      relationshipValues.push(value)
      relationshipTypes.push('RELATIONSHIP')
    }
  }
  if (relationshipValues.length > 0) {
    await preBatchValidateRelationships(ctx, relationshipValues, relationshipTypes)
  }

  // ---- per field: convert, pre-hook, uniqueness, rows ------------------
  const prepared: PreparedField[] = []
  const failed = new Set<string>()
  const allValues = new Map<string, unknown>(writes)
  for (const [fieldId, rawValue] of writes) {
    const field = cachedField(fieldId)
    if (!field) {
      failed.add(fieldId)
      results.push({
        fieldId,
        state: 'failed',
        performedAt,
        values: [],
        changed: false,
        error: `Field ${fieldId} not found`,
      })
      continue
    }
    try {
      const fieldType = toFieldType(field.type)
      const coerced = await validateAndConvertValue(ctx, rawValue, fieldType, field)
      const outcome = await fireFieldPreHooks(ctx, {
        recordId,
        field,
        typedValue: coerced,
        existingValue: undefined,
        allValues,
        entitySlug,
        entityType,
      })
      if (outcome.kind === 'drop') {
        prepared.push({ fieldId, field, values: [], dropped: true })
        continue
      }
      let typed = outcome.value
      if (typed === null) {
        prepared.push({ fieldId, field, values: [], dropped: false })
        continue
      }
      if (fieldType === 'RELATIONSHIP') {
        typed = await canonicalizeRelationshipValue(ctx, typed)
        await validateRelationshipValue(ctx, {
          entityId: entityInstanceId,
          entityDefinitionId,
          fieldId,
          field,
          newValue: typed,
        })
      }
      if (field.isUnique) {
        await checkUniqueValueTyped(
          {
            fieldId,
            value: typed,
            organizationId: ctx.organizationId,
            excludeEntityId: entityInstanceId,
          },
          ctx.db
        )
      }
      prepared.push({
        fieldId,
        field,
        values: (Array.isArray(typed) ? typed : [typed]).filter(
          (v): v is TypedFieldValueInput => v !== null
        ),
        dropped: false,
      })
    } catch (error) {
      failed.add(fieldId)
      logger.error(`Failed to prepare field ${fieldId} for create`, {
        recordId,
        error: error instanceof Error ? error.message : String(error),
      })
      results.push({
        fieldId,
        state: 'failed',
        performedAt,
        values: [],
        changed: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ---- ONE insert for every value of the record -------------------------
  const insertRows: InsertRow[] = []
  for (const p of prepared) {
    if (p.values.length === 0) continue
    const sortKeys = nKeysAfter(null, p.values.length)
    p.values.forEach((value, index) => {
      insertRows.push(
        buildFieldValueRow({
          organizationId: ctx.organizationId,
          entityId: entityInstanceId,
          entityDefinitionId,
          fieldId: p.fieldId,
          fieldType: toFieldType(p.field.type),
          value,
          sortKey: sortKeys[index]!,
          currencyOptions: p.field.options as never,
        })
      )
    })
  }

  let inserted: FieldValueRow[] = []
  if (insertRows.length > 0) {
    try {
      inserted = (await ctx.db
        .insert(schema.FieldValue)
        .values(insertRows)
        .returning()) as unknown as FieldValueRow[]
    } catch (error) {
      // The statement is all-or-nothing: every prepared field failed.
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Create-time field insert failed', { recordId, error: message })
      for (const p of prepared) {
        if (p.values.length === 0) continue
        failed.add(p.fieldId)
        results.push({
          fieldId: p.fieldId,
          state: 'failed',
          performedAt,
          values: [],
          changed: false,
          error: message,
        })
      }
      prepared.splice(0, prepared.length, ...prepared.filter((p) => p.values.length === 0))
    }
  }
  const rowsByField = new Map<string, FieldValueRow[]>()
  for (const row of inserted) {
    const list = rowsByField.get(row.fieldId) ?? []
    list.push(row)
    rowsByField.set(row.fieldId, list)
  }

  // ---- derived work, per record ----------------------------------------
  const collector = syncCollectorOf(ctx.session)
  const realtimeEntries: FieldValueUpdateEntry[] = []
  const writtenFieldIds: string[] = []
  const typedByField = new Map<string, TypedFieldValue[]>()

  // The NAME-composed displayName, once, from the strings in hand: on a
  // fresh record the sibling part IS this write (or empty), so no sibling
  // read is ever needed. Parts are then told not to recompose it themselves.
  const primaryField = entityDefinition?.primaryDisplayFieldId
    ? cachedField(entityDefinition.primaryDisplayFieldId)
    : undefined
  const primaryParts = primaryField ? readNameParts(primaryField) : null
  const composedPartIds = new Set<string>()
  if (primaryField && primaryParts) {
    const first = prepared.find((p) => p.fieldId === primaryParts.firstNameFieldId)
    const last = prepared.find((p) => p.fieldId === primaryParts.lastNameFieldId)
    if (first || last) {
      const text = (p: PreparedField | undefined) => {
        const v = p?.values[0]
        return v && v.type === 'text' ? String(v.value ?? '') : ''
      }
      await recomposeNameDisplayFromParts(
        ctx,
        recordId,
        primaryField,
        { firstName: text(first), lastName: text(last) },
        { skipSearchTextRefresh: true }
      )
      composedPartIds.add(primaryParts.firstNameFieldId)
      composedPartIds.add(primaryParts.lastNameFieldId)
    }
  }

  for (const p of prepared) {
    const { fieldId, field } = p
    const fieldType = toFieldType(field.type)
    const rows = rowsByField.get(fieldId) ?? []
    const typed = rows
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map((row) => rowToTypedValue(row, fieldType))
    typedByField.set(fieldId, typed)

    if (p.dropped || p.values.length === 0) {
      // A dropped write or an explicit empty is a no-op on a fresh record
      // (B-14): nothing stored, nothing to announce.
      continue
    }
    writtenFieldIds.push(fieldId)

    // Display columns (skipping the NAME recompose handled above).
    const value: TypedFieldValueInput | TypedFieldValueInput[] =
      p.values.length === 1 ? p.values[0]! : p.values
    await maybeUpdateDisplayValue(ctx, recordId, field, value, {
      skipSearchTextRefresh: true,
      skipNameCompose: composedPartIds.has(fieldId),
    })

    // Inverse relationships: a fresh record removes nothing, only adds.
    if (fieldType === 'RELATIONSHIP' && !skipInverseSync) {
      const inverseInfo = await getInverseInfoFromField(ctx, field)
      if (inverseInfo) {
        const newRelatedIds = p.values
          .filter(
            (v): v is { type: 'relationship'; recordId: RecordId } =>
              v.type === 'relationship' && !!(v as { recordId?: RecordId }).recordId
          )
          .map((v) => parseRecordId(v.recordId).entityInstanceId)
        await syncInverseRelationships(
          { db: ctx.db, organizationId: ctx.organizationId },
          { entityId: entityInstanceId, oldRelatedIds: [], newRelatedIds, inverseInfo }
        )
      }
    }

    // Sync capture (plan 07 section 4): the record is in the collector's
    // created set, so this lands as `{n}` with no `o`.
    if (collector) {
      const subscribed = isDeltaSubscribed(collector, field, fieldId, entityDefinitionId)
      captureSyncFieldWrite({
        collector,
        subscribed,
        recordId,
        field,
        fieldId,
        oldValues: subscribed ? [] : null,
        newValues: typed,
      })
    }

    if (publishEvents && typed.length > 0) {
      const publishRecordId = field.entityDefinitionId
        ? toRecordId(field.entityDefinitionId, entityInstanceId)
        : recordId
      realtimeEntries.push({
        ...buildPublishEntry({
          publishRecordId,
          fieldId: fieldId as FieldId,
          field,
          values: typed,
        }),
        aiStatus: null,
        aiMetadata: null,
      })
    }
  }

  // Results, one per input entry: composite NAME entries report under the
  // NAME fieldId with no values (section 4c); their parts are not separate
  // inputs unless the caller also named them.
  const inputIds = new Set(customs.map((c) => c.fieldId))
  for (const nr of nameResults) {
    const changed = nr.parts.some((id) => writtenFieldIds.includes(id))
    const partFailed = nr.parts.some((id) => failed.has(id))
    results.push({
      fieldId: nr.fieldId,
      state: partFailed ? 'failed' : 'complete',
      performedAt,
      values: [],
      changed,
      ...(partFailed ? { error: 'A name part failed to write' } : {}),
    })
  }
  for (const p of prepared) {
    if (!inputIds.has(p.fieldId)) continue
    results.push({
      fieldId: p.fieldId,
      state: 'complete',
      performedAt,
      values: typedByField.get(p.fieldId) ?? [],
      changed: writtenFieldIds.includes(p.fieldId),
    })
  }

  // ---- announce: one realtime frame, post-hooks, native triggers --------
  // No per-field bus events on a create: the `:created` lifecycle event
  // announces the whole record, so a caller's `collectFieldChanges` stays
  // empty by design.
  if (realtimeEntries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, realtimeEntries, {
      excludeSocketId: ctx.socketId,
    }).catch(() => {})
  }

  if (announce) {
    for (const p of prepared) {
      if (!writtenFieldIds.includes(p.fieldId)) continue
      const { field } = p
      const fieldType = field.type as FieldType
      if (!hasEntityFieldChangeHooks(entitySlug) && !hasFieldTypeChangeHooks(fieldType)) continue
      const handlers = [
        ...getEntityFieldChangeHooks(entitySlug),
        ...getFieldTypeChangeHooks(fieldType),
      ]
      if (handlers.length === 0) continue
      const typed = typedByField.get(p.fieldId) ?? []
      const fieldOptions = field.options as
        | { actor?: { multiple?: boolean }; multi?: boolean }
        | undefined
      const newValue: TypedFieldValue | TypedFieldValue[] | null = isArrayReturnFieldType(
        fieldType,
        fieldOptions
      )
        ? typed
        : (typed[0] ?? null)
      const { oldDisplay, newDisplay } = await resolveFieldChangeSnapshotPair(
        { db: ctx.db, organizationId: ctx.organizationId },
        field,
        null,
        newValue
      )
      for (const handler of handlers) {
        try {
          await handler({
            recordId,
            entityDefinitionId,
            entityType,
            entitySlug,
            field,
            oldValue: null,
            newValue,
            oldDisplay,
            newDisplay,
            organizationId: ctx.organizationId,
            userId: ctx.userId!,
            isCreate: true,
          })
        } catch (error) {
          logger.error(`Field-change handler failed for ${entitySlug}`, {
            fieldId: field.id,
            recordId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // Native field triggers, once for the whole record. Rules declared
    // `skipOnCreate` are left to the def's lifecycle `created` rule.
    if (writtenFieldIds.length > 0) {
      const triggered = deduplicateBySystemAttribute(
        await collectTriggeredFields(ctx.organizationId, writtenFieldIds, { isCreate: true })
      )
      if (triggered.length > 0) {
        await publishFieldTriggerEvents(
          { organizationId: ctx.organizationId, userId: ctx.userId! },
          triggered,
          recordId
        )
      }
    }
  }

  // ---- ONE derived-column flush, RETURNING the row -----------------------
  const changedFields = prepared.filter((p) => writtenFieldIds.includes(p.fieldId))
  const instance = await flushInstanceDerived(ctx.db, ctx.organizationId, entityInstanceId, {
    stampUpdatedAt: !skipInstanceStamp && changedFields.length > 0,
    touchActivity:
      !skipInstanceStamp && announce && changedFields.some((p) => fieldTouchesActivity(p.field)),
    refreshSearchText:
      !skipSearchTextRefresh && changedFields.some((p) => fieldFeedsSearchCorpus(p.field)),
  })

  return { results, instance }
}
