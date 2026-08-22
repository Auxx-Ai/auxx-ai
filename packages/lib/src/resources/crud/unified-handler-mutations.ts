// packages/lib/src/resources/crud/unified-handler-mutations.ts

import type { Database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { findCachedResource } from '../../cache'
import { CommentService } from '../../comments'
import { enqueueDuplicateScan } from '../../dedup/enqueue-scan'
import { deleteOpenPairsForRecord } from '../../dedup/pairs'
import {
  createEntityInstance,
  deleteEntityInstance,
  getEntityInstance,
  updateEntityInstance,
} from '../../entity-instances'
import { UnprocessableEntityError } from '../../errors'
import { getEntityPostDeleteHooks, getEntityPreDeleteHooks } from '../../field-hooks/registry'
import type { FieldValueService } from '../../field-values'
// Leaf path on purpose (not the field-values barrel): the one shared narrowing
// helper for tier-1 sync capture, so this file's lifecycle seams and the field
// seams apply the identical sync-origin policy (plan 07 §4).
import { syncCollectorOf } from '../../field-values/field-value-mutations'
import {
  getRealtimeService,
  publishRecordsChanged,
  type RecordChangedEntry,
  rooms,
} from '../../realtime'
import {
  captureEventData,
  extractEventData,
  findRelatedRecordId,
} from '../events/extract-event-data'
import type { MergeEntitiesResult } from '../merge'
import { EntityMergeService } from '../merge'
import type { ResourceField } from '../registry/field-types'
import { parseRecordId, type RecordId, toRecordId } from '../resource-id'
import { publishRecordLifecycleEvent } from './publish-record-event'
import {
  getAmbientTxWriteScope,
  recordTxWriteArchive,
  recordTxWriteCreate,
  type TxWriteScope,
} from './tx-write-scope'
import type { ResolvedEntityDefinition } from './types'
import { sessionLane, type WriteSession } from './write-origin'

const logger = createScopedLogger('unified-handler-mutations')

type EntityInstanceEntity = typeof schema.EntityInstance.$inferSelect

/**
 * Options for CRUD operations
 */
export interface CrudOptions {
  /**
   * Skip the per-write event fan-out: the bus event, realtime publish, timeline entry,
   * and per-field-change hooks. Used by bulk writers (connector sink, CSV import).
   *
   * B2 CONTRACT, discharged by the engine (plan 07): suppression and delivery are two
   * halves of one contract. A `sync`-origin session's collector is fed automatically at
   * the engine seams — membership unconditionally, `{o,n}` deltas for rule-subscribed
   * fields — so bulk writers no longer capture anything themselves. Seed writers stay
   * silent forever (the one documented exemption). "Silent skipEvents" therefore means
   * seed-only — anything else is a bug.
   *
   * @deprecated Construct the handler with a `session` instead
   * (`UnifiedCrudHandlerOptions.session`, plan 03 §4b S1); this alias maps to
   * silent-lane behavior and will be removed once every §3 writer declares its
   * origin. `skipEvents: true` still wins over the session-derived lane.
   */
  skipEvents?: boolean
  /**
   * Skip post-delete hooks for this delete. Only for cleanup flows that delete child rows on
   * behalf of a parent operation which guarantees its own projection sync afterward (e.g. the
   * invoice pre-delete guard removing the invoice's own line copies) — running the child-level
   * hooks there would recompute a parent that is about to be deleted, once per child.
   */
  suppressPostDeleteHooks?: boolean
  /**
   * T-1b (plan 04 §4). Declares this create STRUCTURAL to the named parent: the
   * parent's own `record:created` announces it, so no separate create door opens
   * for this record.
   *
   * Honoured ONLY inside a buffered write scope AND only when that parent is
   * itself being created in the same scope. Outside one there is no `created`
   * set to check against, so a stray `absorbInto` is inert and the record
   * announces itself as normal — deliberately, so this can never silence a
   * record on the inline path. Nothing is inferred from the def or the
   * relationship graph; the composing site says so or it does not happen.
   */
  absorbInto?: RecordId
}

/** Inferred type for CustomField select */
type CustomFieldEntity = typeof schema.CustomField.$inferSelect

/**
 * Context for mutation operations
 * Provides access to common services and organization context
 */
export interface MutationContext {
  db: Database
  organizationId: string
  userId: string
  /** Pusher socket ID of the originating client — used for self-event exclusion in realtime sync. */
  socketId?: string
  /**
   * The write session this mutation runs under (plan 03 §4b S3). The
   * per-write event fan-out (`publishEvents`) is derived from its lane via
   * {@link derivePublishEvents} — the deprecated `skipEvents` alias still wins.
   */
  session: WriteSession
  fieldValueService: FieldValueService
  resolveEntityDefinition: (entityDefinitionId: string) => Promise<ResolvedEntityDefinition>
  getFields: (entityDefinitionId: string) => Promise<CustomFieldEntity[]>
  runPreHooks: (
    operation: 'create' | 'update',
    entityDef: ResolvedEntityDefinition,
    values: Record<string, unknown>,
    existingInstance?: EntityInstanceEntity
  ) => Promise<Record<string, unknown>>
  validateUniqueFields: (
    entityDefinitionId: string,
    values: Record<string, unknown>,
    excludeEntityId?: string
  ) => Promise<void>
  setFieldValues: (
    recordId: RecordId,
    values: Record<string, unknown>,
    modes?: Record<string, 'set' | 'add' | 'remove'>,
    opts?: { publishEvents?: boolean }
  ) => Promise<void>
}

/**
 * Result type for entity creation
 */
export interface CreateEntityResult {
  instance: EntityInstanceEntity
  recordId: RecordId
  values: Record<string, unknown>
}

/**
 * Helper to unwrap neverthrow Result and throw on error.
 *
 * Typed against `Result`, not structurally: an `Err` carries no `value` and an
 * `Ok` carries no `error`, so a `{ isErr, error, value }` parameter matches
 * neither arm and silently degraded `T` to `unknown`.
 */
function unwrapResult<T>(result: Result<T, { message: string; cause?: unknown }>): T {
  if (result.isErr()) {
    // Preserve `cause` so route-level logs can see the underlying DB error
    // (constraint violation, missing column, etc.) instead of the generic
    // `Database operation "create-entity-instance" failed` wrapper.
    throw new Error(result.error.message, { cause: result.error.cause })
  }
  return result.value
}

/**
 * The S3 conversion seam (plan 03 §4b): ONE derived boolean per mutation call
 * gates the whole per-write fan-out (bus event, realtime frames, dedup
 * enqueue, event-data capture). The deprecated `skipEvents: true` alias still
 * wins — behavior preserving; otherwise the session's lane decides:
 * interactive/api/automation → publish, sync/seed → silent (exactly today's
 * `skipEvents` semantics until the Phase 4 batch lane lands).
 */
function derivePublishEvents(ctx: MutationContext, options: CrudOptions): boolean {
  if (options.skipEvents === true) return false
  return sessionLane(ctx.session) === 'inline'
}

/**
 * The buffered scope this mutation should capture into, or undefined when its
 * doors fire inline (or are suppressed outright). `'buffered'` differs from
 * `'silent'` only here: a live collector keeps what `'silent'` throws away, so
 * `flushTxWriteScope` can replay it once the transaction commits (plan 04 §6.2).
 */
function deriveTxWriteScope(ctx: MutationContext, options: CrudOptions): TxWriteScope | undefined {
  if (options.skipEvents === true) return undefined
  return sessionLane(ctx.session) === 'buffered' ? getAmbientTxWriteScope(ctx.session) : undefined
}

/**
 * True if a value is considered present for required-field validation.
 * Null, undefined, empty string, and empty arrays count as missing.
 */
function isValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

/**
 * Coerce a stored `defaultValue` (typically `text` in the DB, or typed primitive
 * from the static registry) into the shape the downstream field-value pipeline
 * expects. String inputs are parsed for NUMBER/CURRENCY/CHECKBOX/MULTI_SELECT;
 * everything else passes through. Returns `undefined` when a numeric string
 * can't be parsed so the default is silently skipped instead of throwing.
 */
function coerceDefault(raw: unknown, fieldType: FieldType | undefined): unknown {
  if (typeof raw !== 'string') return raw
  switch (fieldType) {
    case FieldTypeEnum.NUMBER:
    case FieldTypeEnum.CURRENCY: {
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) ? n : undefined
    }
    case FieldTypeEnum.CHECKBOX:
      return raw === 'true' || raw === '1'
    case FieldTypeEnum.MULTI_SELECT:
    case FieldTypeEnum.TAGS:
      return [raw]
    default:
      return raw
  }
}

/**
 * Fill missing keys in `values` with each field's configured `defaultValue`.
 * Only applies to `capabilities.creatable` fields (hook-owned fields like
 * `ticket_number` / `created_by_id` are skipped). Respects explicit `null` as
 * "caller is clearing" — does not overwrite. Runs before `runPreHooks` so the
 * required-field check and hooks see the defaulted values uniformly.
 *
 * Source of fields is the cached `Resource` — it merges static-registry
 * defaults (e.g. `ticket_type: 'GENERAL'`) with DB `CustomField.defaultValue`
 * for custom entity fields.
 */
function applyDefaults(
  values: Record<string, unknown>,
  fields: ResourceField[]
): Record<string, unknown> {
  const out = { ...values }
  for (const f of fields) {
    if (!f.capabilities?.creatable) continue
    if (f.defaultValue === undefined || f.defaultValue === null) continue
    if (typeof f.defaultValue === 'string' && f.defaultValue === '') continue
    const keys = [f.systemAttribute, f.key, f.id].filter(Boolean) as string[]
    const alreadySet = keys.some((k) => k in values)
    if (alreadySet) continue
    const coerced = coerceDefault(f.defaultValue, f.fieldType)
    if (coerced === undefined) continue
    // Canonical key — matches the id list_entity_fields returns and the lookup
    // setFieldValues uses (`systemAttribute ?? name`).
    const canonical = f.systemAttribute ?? f.key
    out[canonical] = coerced
  }
  return out
}

/**
 * Validate that all creatable+required fields are present in the input map.
 * Runs BEFORE any pre-hook with DB side effects (e.g. ticket number allocation)
 * so a missing field never leaves orphaned state behind.
 *
 * Keys in `values` can be the field's `systemAttribute`, `name`, or UUID.
 * Fields with `isCreatable === false` are skipped — those are auto-populated
 * by hooks (e.g. ticket_number, created_by_id).
 */
function assertRequiredFieldsPresent(
  fields: CustomFieldEntity[],
  values: Record<string, unknown>
): void {
  const missing = fields.filter((f) => {
    if (!f.required || !f.isCreatable) return false
    const keys = [f.systemAttribute, f.name, f.id].filter(Boolean) as string[]
    return !keys.some((k) => k in values && isValuePresent(values[k]))
  })

  if (missing.length === 0) return

  const labels = missing.map((f) => f.name)
  throw new UnprocessableEntityError(`Missing required fields: ${labels.join(', ')}`, {
    missingFields: missing.map((f) => f.systemAttribute ?? f.name),
    missingFieldLabels: labels,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE RECORD MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create entity instance with field values and system hooks.
 * Returns the created instance, recordId, and all processed values
 * (including auto-generated values like ticket_number).
 *
 * @param ctx - Mutation context
 * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
 * @param values - Field values to set (map of fieldId -> value)
 * @param options - Optional CRUD options (skipEvents)
 * @returns CreateEntityResult with instance, recordId, and all field values
 */
export async function createEntity(
  ctx: MutationContext,
  entityDefinitionId: string,
  values: Record<string, unknown>,
  options: CrudOptions = {}
): Promise<CreateEntityResult> {
  // S3: one derived boolean per call gates the whole per-write fan-out below.
  const publishEvents = derivePublishEvents(ctx, options)
  const txScope = deriveTxWriteScope(ctx, options)
  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Apply configured defaults for any creatable field the caller omitted.
  // Source is the cached Resource — merges static-registry defaults
  // (e.g. ticket_type = 'GENERAL') with CustomField.defaultValue for custom
  // entity fields. Runs before the required check so defaults satisfy it.
  const resource = await findCachedResource(ctx.organizationId, entityDef.id)
  const resourceFields = resource?.fields ?? []
  const defaultedValues = applyDefaults(values, resourceFields)
  if (Object.keys(defaultedValues).length > Object.keys(values).length) {
    logger.debug('Applied field defaults', {
      entityDefinitionId: entityDef.id,
      appliedKeys: Object.keys(defaultedValues).filter((k) => !(k in values)),
    })
  }

  // Required-field check BEFORE any side-effect hook (e.g. ticket number allocation).
  // Validates user-scope required fields only (capabilities.required && isCreatable).
  const entityFields = await ctx.getFields(entityDef.id)
  assertRequiredFieldsPresent(entityFields, defaultedValues)

  // Run pre-create hooks (validation, normalization, auto-generation)
  const processedValues = await ctx.runPreHooks('create', entityDef, defaultedValues)

  // Check uniqueness constraints
  await ctx.validateUniqueFields(entityDef.id, processedValues)

  // Create EntityInstance. Connector-minted provenance now lives on
  // `DataConnectorItem.mintedInstance`, not on the instance row.
  // Pass ctx.db so a transaction-scoped handler (billing invoice builders) creates the row
  // INSIDE its transaction — a global-pool insert here is invisible to the transaction's
  // serializable FK checks, so allocation rows referencing the new instance would 23503.
  const instanceResult = await createEntityInstance(
    {
      entityDefinitionId: entityDef.id,
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
    },
    ctx.db
  )

  const instance = unwrapResult(instanceResult)

  // Build RecordId for field value operations
  const recordId = toRecordId(entityDef.id, instance.id)

  // Sync capture (plan 07 §4 / PR 2): unconditional lifecycle membership for
  // sync sessions, registered BEFORE the field writes below run — the field
  // seams probe `hasCreated` so a create's own field writes emit `{n}` with no
  // `o` (the manifest's created-this-run marker). `createdValues` now rides
  // this seam too: the raw systemAttribute-keyed written values, the exact
  // shape `extractEventData` produces on the interactive door, gated on a
  // lifecycle `created` subscription exactly as the producer capture was (no
  // rules means no handler reads them — zero work). Producers that also call
  // recordCreated are fine: the collector dedupes on the entity instance id,
  // first call (this one) wins, values included.
  const createCollector = syncCollectorOf(ctx.session)
  if (createCollector) {
    let createdValues: Record<string, unknown> | undefined
    if (createCollector.subscriptionsFor(entityDef.id)?.lifecycle.created) {
      const extracted = extractEventData(entityDef.entityType, entityFields, processedValues)
      if (Object.keys(extracted).length > 0) createdValues = extracted
    }
    createCollector.recordCreated(recordId, createdValues)
  }

  // Buffered lane: register the create BEFORE its own field writes run. The
  // ordering is load-bearing — a record in the scope's `created` set absorbs its
  // own field changes (T-1), so the field-value layer can see it is already
  // there and skip the old-value read and the realtime shaping entirely instead
  // of buffering ~12 frames per copied line that the flush would only drop.
  // `eventData` is the write's own values, so it needs no live handle (T-4).
  if (txScope) {
    recordTxWriteCreate(txScope, {
      recordId,
      entityDefinitionId: entityDef.id,
      entityType: entityDef.entityType,
      entitySlug: entityDef.apiSlug,
      values: extractEventData(entityDef.entityType, entityFields, processedValues),
      absorbInto: options.absorbInto,
    })
  }

  // Set field values using RecordId. Silent-lane writes (sync/seed sessions,
  // or the deprecated skipEvents alias) also suppress the field-value
  // realtime + triggers end-to-end via publishEvents:false. The BUFFERED lane
  // passes `true` here on purpose: the field-value layer resolves the scope
  // itself and captures instead of publishing, so a `false` would be read as
  // the C3 "an aggregator announces this" escape hatch and lose the writes.
  await ctx.setFieldValues(recordId, processedValues, undefined, {
    publishEvents: publishEvents || txScope !== undefined,
  })

  // Re-read the instance so displayName / secondaryDisplayValue / avatarUrl
  // reflect what setFieldValues' maybeUpdateDisplayValue just wrote. The
  // in-memory `instance` captured above was snapshotted before those columns
  // were populated, so using it for the realtime event would poison other
  // tabs' record store with stale nulls.
  const freshResult = await getEntityInstance({
    id: instance.id,
    organizationId: ctx.organizationId,
  })
  const freshInstance = freshResult.isOk() ? freshResult.value : instance

  // Publish event (unless suppressed by the silent lane)
  if (publishEvents) {
    const fields = await ctx.getFields(entityDef.id)
    const eventData = extractEventData(entityDef.entityType, fields, processedValues)
    const relatedRecordId = findRelatedRecordId(entityDef.entityType, eventData)

    publishRecordLifecycleEvent({
      recordId,
      entityType: entityDef.entityType,
      entityDefinitionId: entityDef.id,
      entitySlug: entityDef.apiSlug,
      action: 'created',
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      eventData,
      relatedRecordId,
    })
  }

  // Publish record:created realtime event
  if (publishEvents) {
    getRealtimeService()
      .publish(
        rooms.orgRecords(ctx.organizationId, entityDef.id),
        'record:created',
        {
          entityDefinitionId: entityDef.id,
          record: {
            id: freshInstance.id,
            recordId,
            displayName: freshInstance.displayName,
            avatarUrl: freshInstance.avatarUrl,
            secondaryDisplayValue: freshInstance.secondaryDisplayValue,
            createdAt: freshInstance.createdAt,
            updatedAt: freshInstance.updatedAt,
          },
        },
        { excludeSocketId: ctx.socketId }
      )
      .catch(() => {})

    // Duplicate scan, coalesced per (org, definition). Fire-and-forget: a scan
    // must never be able to fail a write. NO recordId is passed — the handler is
    // watermark-driven, so a burst of creates (a first-connect mailbox sync going
    // through `findOrCreate` fires this seam live, hundreds of times) collapses
    // onto ONE delayed job under the shared jobId.
    enqueueDuplicateScan(ctx.organizationId, entityDef.id).catch(() => {})
  }

  // Return the fresh instance so callers (e.g. the create_entity tool) have a
  // post-setFieldValues view with the populated displayName.
  return {
    instance: freshInstance,
    recordId,
    values: processedValues,
  }
}

/**
 * Update entity instance field values
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param values - Field values to update (map of fieldId -> value)
 * @param options - Optional CRUD options (skipEvents)
 */
export async function updateEntity(
  ctx: MutationContext,
  recordId: RecordId,
  values: Record<string, unknown>,
  modes?: Record<string, 'set' | 'add' | 'remove'>,
  options: CrudOptions = {}
) {
  // S3: one derived boolean per call gates the whole per-write fan-out below.
  const publishEvents = derivePublishEvents(ctx, options)
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Single fetch to verify existence
  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Rebuild RecordId with resolved UUID so cache lookups in setFieldValues work
  // (input recordId may use entityType string like "inbox:xxx" instead of UUID)
  const resolvedRecordId = toRecordId(entityDef.id, entityInstanceId)

  // Run pre-update hooks
  const processedValues = await ctx.runPreHooks('update', entityDef, values, instance)

  // Check uniqueness (excluding current entity)
  await ctx.validateUniqueFields(entityDef.id, processedValues, entityInstanceId)

  // Set field values using resolved RecordId. Per-field modes default to
  // 'set' when missing — today's behavior for every caller that omits modes.
  // Silent-lane writes suppress the field-value realtime + triggers too; the
  // buffered lane passes `true` so the field-value layer captures rather than
  // reading `false` as the C3 escape hatch (see the same note in createEntity).
  await ctx.setFieldValues(resolvedRecordId, processedValues, modes, {
    publishEvents: publishEvents || deriveTxWriteScope(ctx, options) !== undefined,
  })

  // Re-read so displayName / secondaryDisplayValue / avatarUrl / updatedAt
  // reflect what setFieldValues just wrote. The `instance` captured at the
  // top is now stale for any denormalized display column the update touched.
  const freshResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const freshInstance = freshResult.isOk() ? freshResult.value : instance

  // Publish event (unless suppressed by the silent lane)
  if (publishEvents) {
    const fields = await ctx.getFields(entityDef.id)
    const eventData = extractEventData(entityDef.entityType, fields, processedValues)
    const relatedRecordId = findRelatedRecordId(entityDef.entityType, eventData)

    publishRecordLifecycleEvent({
      recordId,
      entityType: entityDef.entityType,
      entityDefinitionId: entityDef.id,
      entitySlug: entityDef.apiSlug,
      action: 'updated',
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      eventData,
      relatedRecordId,
    })
  }

  // Publish record:updated realtime event so other tabs can refresh the row's
  // denormalized metadata (displayName, etc). Field-value changes ride on
  // fieldValues:updated; this event is only for the record-level columns.
  if (publishEvents) {
    getRealtimeService()
      .publish(
        rooms.orgRecords(ctx.organizationId, entityDef.id),
        'record:updated',
        {
          entityDefinitionId: entityDef.id,
          record: {
            id: freshInstance.id,
            recordId: resolvedRecordId,
            displayName: freshInstance.displayName,
            avatarUrl: freshInstance.avatarUrl,
            secondaryDisplayValue: freshInstance.secondaryDisplayValue,
            createdAt: freshInstance.createdAt,
            updatedAt: freshInstance.updatedAt,
          },
        },
        { excludeSocketId: ctx.socketId }
      )
      .catch(() => {})

    // Coalesced duplicate scan — see the note on the create path.
    enqueueDuplicateScan(ctx.organizationId, entityDef.id).catch(() => {})
  }

  // Return the fresh instance so callers see the post-update denormalized columns.
  return freshInstance
}

/**
 * Archive entity instance (soft delete)
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param options - Optional CRUD options (skipEvents). The extra
 *   `suppressRealtimeFrame` flag is INTERNAL to this module: it exists only so
 *   `bulkArchiveEntities` can swap the per-record tier-1 `record:archived`
 *   frame for one tier-2 `records:changed` delta frame per def (plan events/03
 *   §7b / D-17). It suppresses the realtime frame and NOTHING else — the bus
 *   event, dedup-pair cleanup, and every other per-record door fire exactly as
 *   on a single archive. Do not add it to `CrudOptions` and do not let it
 *   spread to other mutations.
 */
export async function archiveEntity(
  ctx: MutationContext,
  recordId: RecordId,
  options: CrudOptions & { suppressRealtimeFrame?: boolean } = {}
) {
  // S3: one derived boolean per call gates the whole per-write fan-out below.
  const publishEvents = derivePublishEvents(ctx, options)
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  const updateResult = await updateEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
    data: { archivedAt: new Date() },
  })

  unwrapResult(updateResult)

  // Tier-1 sync capture (plan 07 §4): unconditional lifecycle membership for
  // sync sessions (`bulkArchiveEntities` delegates here, so it is covered too).
  syncCollectorOf(ctx.session)?.recordArchived(recordId)

  if (publishEvents) {
    publishRecordLifecycleEvent({
      recordId,
      entityType: entityDef.entityType,
      entityDefinitionId: entityDef.id,
      entitySlug: entityDef.apiSlug,
      action: 'deleted',
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      eventData: { hardDelete: false },
    })
  }

  // Publish record:archived realtime event (skipped when the caller is a bulk
  // archive — it publishes one tier-2 `records:changed` frame per def instead).
  if (publishEvents && !options.suppressRealtimeFrame) {
    getRealtimeService()
      .publish(
        rooms.orgRecords(ctx.organizationId, entityDef.id),
        'record:archived',
        { recordId, entityDefinitionId: entityDef.id },
        { excludeSocketId: ctx.socketId }
      )
      .catch(() => {})
  }

  // Buffered lane: replayed post-commit by `flushTxWriteScope`.
  const txScope = deriveTxWriteScope(ctx, options)
  if (txScope && !options.suppressRealtimeFrame) {
    recordTxWriteArchive(txScope, {
      recordId,
      entityDefinitionId: entityDef.id,
      entityType: entityDef.entityType,
      entitySlug: entityDef.apiSlug,
      realtimeEvent: 'record:archived',
      eventData: { hardDelete: false },
    })
  }

  // Duplicate-suggestion cleanup — deliberately OUTSIDE the `publishEvents`
  // guard. Pair cleanup is data hygiene, not an event: a silent-lane bulk
  // archive must still clean up after itself. Only `open` rows go; `dismissed` carries the
  // band that governs reopen and `merged` is the audit trail.
  // (`bulkArchiveEntities` delegates here per record, so it is covered too.)
  try {
    await deleteOpenPairsForRecord(ctx.db, ctx.organizationId, entityInstanceId)
  } catch (error) {
    logger.warn('Duplicate-pair cleanup failed on archive', {
      recordId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Return the instance we already fetched (archivedAt is the only change)
  return { ...instance, archivedAt: new Date() }
}

/**
 * Restore archived entity instance
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param options - Optional CRUD options (skipEvents)
 */
export async function restoreEntity(
  ctx: MutationContext,
  recordId: RecordId,
  options: CrudOptions = {}
) {
  // S3: one derived boolean per call gates the whole per-write fan-out below.
  const publishEvents = derivePublishEvents(ctx, options)
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  const updateResult = await updateEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
    data: { archivedAt: null },
  })

  unwrapResult(updateResult)

  if (publishEvents) {
    publishRecordLifecycleEvent({
      recordId,
      entityType: entityDef.entityType,
      entityDefinitionId: entityDef.id,
      entitySlug: entityDef.apiSlug,
      action: 'updated',
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      eventData: { restored: true },
    })
  }

  // Return the instance we already fetched with archivedAt cleared
  return { ...instance, archivedAt: null }
}

/**
 * Permanently delete entity instance
 *
 * @param ctx - Mutation context
 * @param recordId - RecordId in format "entityDefinitionId:instanceId"
 * @param options - Optional CRUD options (skipEvents)
 */
export async function deleteEntity(
  ctx: MutationContext,
  recordId: RecordId,
  options: CrudOptions = {}
): Promise<void> {
  // S3: one derived boolean per call gates the whole per-write fan-out below.
  const publishEvents = derivePublishEvents(ctx, options)
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })
  const instance = instanceResult.isOk() ? instanceResult.value : null
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Capture field values before deletion so:
  //   1. The deleted event carries relationship data (entity triggers like
  //      BOM cost recalculation depend on this)
  //   2. Any registered pre-delete hooks can inspect the record's current
  //      state to decide whether to reject the delete
  // Pre-delete hooks are orthogonal to event publishing — capture is
  // required whenever either consumer is active.
  const preDeleteHooks = entityDef.apiSlug ? getEntityPreDeleteHooks(entityDef.apiSlug) : []
  const postDeleteHooks =
    entityDef.apiSlug && !options.suppressPostDeleteHooks
      ? getEntityPostDeleteHooks(entityDef.apiSlug)
      : []
  const txScope = deriveTxWriteScope(ctx, options)
  let eventData: Record<string, unknown> = { hardDelete: true }
  if (publishEvents || txScope || preDeleteHooks.length > 0 || postDeleteHooks.length > 0) {
    const fields = await ctx.getFields(entityDef.id)
    const captured = await captureEventData(ctx.fieldValueService, recordId, fields)
    eventData = { hardDelete: true, ...captured }
  }

  // Pre-delete hooks: throw to reject the delete (4xx surfaced by caller).
  if (preDeleteHooks.length > 0 && entityDef.apiSlug) {
    for (const hook of preDeleteHooks) {
      await hook({
        recordId,
        entityDefinitionId: entityDef.id,
        entityType: entityDef.entityType,
        entitySlug: entityDef.apiSlug,
        values: eventData,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        bypass: ctx.fieldValueService.ctx.bypassFieldGuards,
      })
    }
  }

  // Delete comments using RecordId
  const commentService = new CommentService(ctx.organizationId, ctx.userId, ctx.db, null)
  await commentService.deleteCommentsByRecordId(recordId)

  const deleteResult = await deleteEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
  })

  unwrapResult(deleteResult)

  // Tier-1 sync capture (plan 07 §4): a hard delete is membership too — the
  // manifest has one archived set for both (`bulkDeleteEntities` delegates
  // here, so it is covered too).
  syncCollectorOf(ctx.session)?.recordArchived(recordId)

  // Post-delete hooks: deletes never fire field-change post-hooks, so this is where
  // projections that depend on the deleted record refresh (log-and-swallow, matching
  // field-change post-hook semantics — the delete itself has already committed).
  for (const hook of postDeleteHooks) {
    try {
      await hook({
        recordId,
        entityDefinitionId: entityDef.id,
        entityType: entityDef.entityType,
        entitySlug: entityDef.apiSlug ?? '',
        values: eventData,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      })
    } catch (error) {
      logger.error('Post-delete hook failed', {
        recordId,
        entitySlug: entityDef.apiSlug,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (publishEvents) {
    publishRecordLifecycleEvent({
      recordId,
      entityType: entityDef.entityType,
      entityDefinitionId: entityDef.id,
      entitySlug: entityDef.apiSlug,
      action: 'deleted',
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      eventData,
    })

    // Publish record:deleted realtime event
    getRealtimeService()
      .publish(
        rooms.orgRecords(ctx.organizationId, entityDef.id),
        'record:deleted',
        { recordId, entityDefinitionId: entityDef.id },
        { excludeSocketId: ctx.socketId }
      )
      .catch(() => {})
  }

  // Buffered lane: replayed post-commit by `flushTxWriteScope`.
  if (txScope) {
    recordTxWriteArchive(txScope, {
      recordId,
      entityDefinitionId: entityDef.id,
      entityType: entityDef.entityType,
      entitySlug: entityDef.apiSlug,
      realtimeEvent: 'record:deleted',
      eventData,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bulk create entities
 *
 * @param ctx - Mutation context
 * @param entityDefinitionId - 'contact', 'ticket', or UUID for custom entities
 * @param items - Array of field value maps to create
 * @param options - Optional CRUD options (skipEvents)
 */
export async function bulkCreateEntities(
  ctx: MutationContext,
  entityDefinitionId: string,
  items: Record<string, unknown>[],
  options: CrudOptions = {}
): Promise<{ created: EntityInstanceEntity[]; errors: Array<{ index: number; error: string }> }> {
  if (items.length === 0) return { created: [], errors: [] }

  const created: EntityInstanceEntity[] = []
  const errors: Array<{ index: number; error: string }> = []

  for (let i = 0; i < items.length; i++) {
    try {
      const result = await createEntity(ctx, entityDefinitionId, items[i]!, {
        skipEvents: options.skipEvents,
      })
      created.push(result.instance)
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : 'Unknown error' })
    }
  }

  return { created, errors }
}

/**
 * Bulk update entities
 *
 * @param ctx - Mutation context
 * @param updates - Array of { recordId, values } to update
 * @param options - Optional CRUD options (skipEvents)
 */
export async function bulkUpdateEntities(
  ctx: MutationContext,
  updates: Array<{ recordId: RecordId; values: Record<string, unknown> }>,
  options: CrudOptions = {}
): Promise<{ updated: number; errors: Array<{ recordId: RecordId; error: string }> }> {
  if (updates.length === 0) return { updated: 0, errors: [] }

  let updated = 0
  const errors: Array<{ recordId: RecordId; error: string }> = []

  for (const { recordId, values } of updates) {
    try {
      // `updateEntity` takes `modes` fourth and `options` fifth — the options object
      // was landing in the `modes` slot, so `skipEvents` was silently dropped and a
      // bulk update published per-record events regardless.
      await updateEntity(ctx, recordId, values, undefined, {
        skipEvents: options.skipEvents,
      })
      updated++
    } catch (e) {
      errors.push({ recordId, error: e instanceof Error ? e.message : 'Unknown error' })
    }
  }

  return { updated, errors }
}

/**
 * Bulk archive entities (soft delete)
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to archive
 * @param options - Optional CRUD options (skipEvents)
 */
export async function bulkArchiveEntities(
  ctx: MutationContext,
  recordIds: RecordId[],
  options: CrudOptions = {}
): Promise<{ count: number }> {
  if (recordIds.length === 0) return { count: 0 }

  // D-17/§7b: origin decides policy, SIZE decides execution shape. A bulk
  // archive is bulk-shaped, so its realtime door is tier 2 — one
  // `records:changed` delta frame per def (ids only per D-18, chunked at 100
  // by the publisher) instead of N per-record `record:archived` frames. This
  // is a realtime-SHAPE change ONLY: client-side the per-record frame drives
  // just a per-def list invalidate (`handleRecordArchived` in
  // use-resource-sync — no in-place row removal, unlike `record:deleted`),
  // and the `records:changed` handler runs the same coalesced list invalidate
  // plus a targeted cached-row catch-up — behavior-equivalent for the UI while
  // removing the N-frame fan-out. `bulkDeleteEntities` deliberately KEEPS its
  // per-record `record:deleted` frames: the client removes those rows from
  // the record store in place, which a delta frame would regress.
  const publishEvents = derivePublishEvents(ctx, options)

  let count = 0
  // Archived instance ids grouped by (possibly slug-keyed) def id — the
  // publisher canonicalizes def keys itself.
  const archivedByDef = new Map<string, RecordChangedEntry[]>()
  for (const recordId of recordIds) {
    try {
      // Delegates per record, so `archiveEntity`'s duplicate-pair cleanup covers
      // the bulk path too — including under `skipEvents`, where it sits outside
      // the event guard precisely so this loop still cleans up. Every other
      // per-record door (bus event → timeline/rules/workflows, pair cleanup)
      // fires exactly as on a single archive; only the tier-1 realtime frame is
      // suppressed in favor of the tier-2 delta below.
      await archiveEntity(ctx, recordId, {
        skipEvents: options.skipEvents,
        suppressRealtimeFrame: true,
      })
      count++
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const entries = archivedByDef.get(entityDefinitionId) ?? []
      entries.push({ recordId: entityInstanceId })
      archivedByDef.set(entityDefinitionId, entries)
    } catch {
      // Skip failures
    }
  }

  // Under a silent lane (sync/seed, or the deprecated `skipEvents` alias) the
  // per-record frames were already suppressed before this change — emit no
  // tier-2 frame there either: the finalize pass owns sync realtime.
  if (publishEvents && count > 0) {
    const realtimeService = getRealtimeService()
    for (const [entityDefinitionId, entries] of archivedByDef) {
      // Same self-echo exclusion the per-record frames carried. Fire-and-forget
      // inside the publisher; a realtime hiccup never fails the archive.
      await publishRecordsChanged(
        realtimeService,
        ctx.organizationId,
        { entityDefinitionId, entries },
        { excludeSocketId: ctx.socketId }
      )
    }
  }

  return { count }
}

/**
 * Bulk delete entities (hard delete)
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to delete
 * @param options - Optional CRUD options (skipEvents)
 */
export async function bulkDeleteEntities(
  ctx: MutationContext,
  recordIds: RecordId[],
  options: CrudOptions = {}
): Promise<{ count: number; errors: Array<{ recordId: RecordId; message: string }> }> {
  if (recordIds.length === 0) return { count: 0, errors: [] }

  let count = 0
  const errors: Array<{ recordId: RecordId; message: string }> = []

  for (const recordId of recordIds) {
    try {
      await deleteEntity(ctx, recordId, {
        skipEvents: options.skipEvents,
      })
      count++
    } catch (error) {
      errors.push({
        recordId,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { count, errors }
}

/**
 * Bulk set field value across multiple entities
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to update
 * @param fieldId - Field ID to set
 * @param value - Value to set
 */
export async function bulkSetFieldValue(
  ctx: MutationContext,
  recordIds: RecordId[],
  fieldId: string,
  value: unknown
): Promise<{ count: number }> {
  if (recordIds.length === 0) return { count: 0 }

  // Use FieldValueService.setBulkValues for efficient bulk operation
  const result = await ctx.fieldValueService.setBulkValues({
    recordIds,
    values: [{ fieldId, value }],
  })

  return { count: result.count }
}

// ═══════════════════════════════════════════════════════════════════════════
// MERGE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge multiple entity instances into a single target
 * Delegates to EntityMergeService for actual merge logic
 *
 * @param ctx - Mutation context
 * @param targetRecordId - RecordId of the target instance
 * @param sourceRecordIds - RecordIds of instances to merge into target
 */
export async function mergeEntities(
  ctx: MutationContext,
  targetRecordId: RecordId,
  sourceRecordIds: RecordId[]
): Promise<MergeEntitiesResult> {
  const mergeService = new EntityMergeService(ctx.db, ctx.organizationId, ctx.userId)
  return mergeService.merge({ targetRecordId, sourceRecordIds })
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW-COMPATIBLE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create entity instance with field values (workflow-compatible)
 * Wraps createEntity() to match EntityInstanceService.createWithValues() signature
 *
 * @param ctx - Mutation context
 * @param entityDefinitionId - Entity definition ID
 * @param values - Field values (fieldId -> value)
 */
export async function createWithValues(
  ctx: MutationContext,
  entityDefinitionId: string,
  values: Record<string, unknown>
): Promise<{ entityInstance: EntityInstanceEntity; id: string }> {
  const result = await createEntity(ctx, entityDefinitionId, values)
  return { entityInstance: result.instance, id: result.instance.id }
}

/**
 * Update entity instance field values (workflow-compatible)
 * Wraps updateEntity() to match EntityInstanceService.updateValues() signature
 *
 * @param ctx - Mutation context
 * @param instanceId - Entity instance ID (not RecordId)
 * @param values - Field values to update (fieldId -> value)
 */
export async function updateValues(
  ctx: MutationContext,
  instanceId: string,
  values: Record<string, unknown>
): Promise<{ entityInstance: EntityInstanceEntity; id: string }> {
  // Need entityDefinitionId - fetch from instance first
  const instanceResult = await getEntityInstance({
    id: instanceId,
    organizationId: ctx.organizationId,
  })
  if (instanceResult.isErr()) {
    throw new Error(`Entity not found: ${instanceId}`)
  }

  const recordId = toRecordId(instanceResult.value.entityDefinitionId, instanceId)
  const updated = await updateEntity(ctx, recordId, values)
  return { entityInstance: updated, id: updated.id }
}
