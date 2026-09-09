// packages/lib/src/resources/crud/unified-handler-mutations.ts

import type { Database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { findCachedResource } from '../../cache'
import { CommentService } from '../../comments'
import { enqueueDuplicateScan } from '../../dedup/enqueue-scan'
import { deleteOpenPairsForRecord, deleteOpenPairsForRecords } from '../../dedup/pairs'
import {
  archiveEntityInstances,
  createEntityInstance,
  deleteEntityInstance,
  deleteEntityInstances,
  type EntityInstanceRow,
  getEntityInstance,
  getEntityInstanceRow,
  updateEntityInstance,
} from '../../entity-instances'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import type { RecordFieldChange } from '../../events/types'
import {
  getEntityPostDeleteHooks,
  getEntityPreCreateHooks,
  getEntityPreDeleteHooks,
} from '../../field-hooks/registry'
import type { EntityPostDeleteHandler, EntityPreDeleteHandler } from '../../field-hooks/types'
import type { FieldValueService } from '../../field-values'
// Leaf path on purpose (not the field-values barrel): the one shared narrowing
// helper for tier-1 sync capture, so this file's lifecycle seams and the field
// seams apply the identical sync-origin policy (plan 07 §4).
import { syncCollectorOf } from '../../field-values/field-value-mutations'
// Leaf path on purpose, same reasoning as `syncCollectorOf` above: the Phase 3
// server-side read-only guard for app/connector-owned fields
// (plans/apps/app-fields-and-entities-plan.md §5).
import { assertOriginMayWriteFields } from '../../field-values/write-guard'
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
import {
  collectDeleteClosure,
  type DeleteClosureGroup,
  type DeleteClosureRecord,
  findRestrictViolations,
} from './delete-closure'
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
   * Skip the post-delete hooks for the REQUESTED records of this delete. For a
   * command that performs the post-delete follow-up itself (`deleteInvoiceLine`
   * in `money/gather.ts` runs the recompute and projection sync right after),
   * so the engine's re-projection would be a second, redundant pass.
   *
   * Never needed for a cascade: cascaded records already skip post-delete
   * hooks in the engine, because their parent is in the closure and dying
   * with them (see `deleteRecords`, phase 3).
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
  /**
   * Write a record's values. Resolves to what the write produced: the
   * SET-lane writes that failed (the field-value layer swallows a per-field
   * throw and continues), whether anything changed, the per-field changes
   * for the record-level event, and the fresh row. See {@link FieldWriteOutcome}.
   */
  setFieldValues: (
    recordId: RecordId,
    values: Record<string, unknown>,
    modes?: Record<string, 'set' | 'add' | 'remove'>,
    opts?: { publishEvents?: boolean; isCreate?: boolean }
  ) => Promise<FieldWriteOutcome>
}

/** What one record's field write produced, as `createEntity` / `updateEntity` read it. */
export interface FieldWriteOutcome {
  /** SET-lane writes that were refused and swallowed. See {@link FieldWriteFailure}. */
  failures: FieldWriteFailure[]
  /** At least one field performed a real change (D-6 no-ops do not count). */
  changed: boolean
  /**
   * One entry per SET-lane field that actually changed, with old/new values
   * and resolved snapshots: the payload of the record-level `:updated`
   * event. Empty on a create (the `:created` event carries the values).
   */
  changes: RecordFieldChange[]
  /**
   * The `EntityInstance` row as the write's own derived-column flush returned
   * it, or `null` when no flush ran. Saves the callers their post-write
   * re-read (which loaded every FieldValue with it).
   */
  instance: EntityInstanceRow | null
}

/**
 * One field whose write was refused and swallowed by `setValuesForEntity`.
 *
 * On an EDIT this is the lenient behaviour every caller relies on: the other
 * fields still land and the record stays whole. On a CREATE it is how a
 * record ends up existing without a required field, because the required
 * check ran on presence before the coercion that refused the value. The
 * importer produced 232 supplier offers with no supplier this way: the
 * relation materializer handed it a bare instance id, `recordIdSchema`
 * refused it, and the create kept going.
 */
export interface FieldWriteFailure {
  /** `CustomField.id` of the field that did not land */
  fieldId: string
  /** The message the field-value layer swallowed */
  error: string
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

  // Phase 3 server-side read-only guard (plan app-fields-and-entities §5):
  // an interactive/api write may not set an app- or connector-owned field
  // whose declared capability refuses it. Every other origin (sync,
  // automation, seed) is exempt — see `write-guard.ts` for the full table.
  assertOriginMayWriteFields(ctx.session.origin, resourceFields, Object.keys(values), 'create')

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

  // Entity pre-create hooks: throw to refuse the create outright. Fired HERE,
  // after defaults/validation and BEFORE `createEntityInstance`, so a rejection
  // leaves nothing behind at all.
  //
  // 🛑 A field pre-hook cannot serve this purpose. `setValuesForEntity` catches
  // per-field throws, logs `Failed to set field <id>` and continues, so a guard
  // that rejects there still gets a record - just one missing the field it
  // objected to. `validateUniqueFields` above only covers SINGLE unique fields;
  // a composite key like `tariff_code (code, country)` has no other seam.
  const preCreateHooks = entityDef.apiSlug ? getEntityPreCreateHooks(entityDef.apiSlug) : []
  for (const hook of preCreateHooks) {
    await hook({
      entityDefinitionId: entityDef.id,
      entityType: entityDef.entityType,
      entitySlug: entityDef.apiSlug as string,
      values: processedValues,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    })
  }

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
  const outcome = await ctx.setFieldValues(recordId, processedValues, undefined, {
    publishEvents: publishEvents || txScope !== undefined,
    isCreate: true,
  })
  const failures = outcome.failures

  // A create that lost a REQUIRED field is not a record, it is a stub that
  // reads as complete and is not. `assertRequiredFieldsPresent` above cannot
  // catch this: it checks presence, and the value WAS present, just refused by
  // coercion (a relationship handed a bare instance id, a select handed a
  // label). Roll the instance back and surface the reason, so the caller (an
  // import row, a form) sees an error where it would otherwise see a success.
  // Optional fields keep the lenient behaviour every edit path relies on.
  if (failures.length > 0) {
    const requiredById = new Map(
      entityFields.filter((f) => f.required && f.isCreatable).map((f) => [f.id, f] as const)
    )
    const fatal = failures.filter((f) => requiredById.has(f.fieldId))
    if (fatal.length > 0) {
      // `deleteEntityInstance` sweeps the values already written for the row
      // inside its own transaction, so nothing is left behind.
      unwrapResult(
        await deleteEntityInstance({
          id: instance.id,
          organizationId: ctx.organizationId,
          db: ctx.db,
        })
      )
      syncCollectorOf(ctx.session)?.recordArchived(recordId)
      const detail = fatal
        .map((f) => `${requiredById.get(f.fieldId)?.name ?? f.fieldId}: ${f.error}`)
        .join('; ')
      throw new UnprocessableEntityError(`Could not write required field ${detail}`, {
        failedFields: fatal.map((f) => {
          const field = requiredById.get(f.fieldId)
          return field?.systemAttribute ?? field?.name ?? f.fieldId
        }),
      })
    }
  }

  // The row as the field write left it: displayName / secondaryDisplayValue
  // / avatarUrl / updatedAt come back on the write's own derived-column
  // flush (`RETURNING`), on the same connection as the write, so no re-read.
  // The in-memory `instance` from the insert predates those columns and is
  // only the fallback for a write that flushed nothing (no custom fields).
  // A re-read here used to run on the POOL connection: inside a
  // transaction-scoped handler it could not see the uncommitted row at all,
  // and it was one of the two connections one create held at once
  // (plans/field-values/create-path-batching.md section 2b).
  const freshInstance = outcome.instance ?? instance

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

  // Existence check: the bare row, on the write's own connection. This used
  // to be `getEntityInstance`, which joins every FieldValue and its field for
  // a row the pre-hooks only read `id` and `metadata` from.
  const instance = await getEntityInstanceRow(
    { id: entityInstanceId, organizationId: ctx.organizationId },
    ctx.db
  )
  if (!instance) throw new Error(`Entity not found: ${entityInstanceId}`)

  const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

  // Rebuild RecordId with resolved UUID so cache lookups in setFieldValues work
  // (input recordId may use entityType string like "inbox:xxx" instead of UUID)
  const resolvedRecordId = toRecordId(entityDef.id, entityInstanceId)

  // Phase 3 server-side read-only guard (plan app-fields-and-entities §5):
  // an interactive/api write may not update an app- or connector-owned field
  // whose declared capability refuses it. Every other origin (sync,
  // automation, seed) is exempt — see `write-guard.ts` for the full table.
  const resource = await findCachedResource(ctx.organizationId, entityDef.id)
  assertOriginMayWriteFields(
    ctx.session.origin,
    resource?.fields ?? [],
    Object.keys(values),
    'update'
  )

  // Run pre-update hooks
  const processedValues = await ctx.runPreHooks('update', entityDef, values, instance)

  // Check uniqueness (excluding current entity)
  await ctx.validateUniqueFields(entityDef.id, processedValues, entityInstanceId)

  // Set field values using resolved RecordId. Per-field modes default to
  // 'set' when missing — today's behavior for every caller that omits modes.
  // Silent-lane writes suppress the field-value realtime + triggers too; the
  // buffered lane passes `true` so the field-value layer captures rather than
  // reading `false` as the C3 escape hatch (see the same note in createEntity).
  const outcome = await ctx.setFieldValues(resolvedRecordId, processedValues, modes, {
    publishEvents: publishEvents || deriveTxWriteScope(ctx, options) !== undefined,
  })

  // The row as the write left it (displayName / secondaryDisplayValue /
  // avatarUrl / updatedAt) comes back on the write's own flush; the row
  // loaded above is only the fallback for a write that changed nothing.
  const freshInstance = outcome.instance ?? instance

  // A write that changed nothing announces nothing: no bus event, no
  // timeline row, no realtime frame, no duplicate scan. Before this gate an
  // idempotent re-save still produced all four
  // (plans/field-values/update-path-and-events.md section 1b).
  if (!outcome.changed) return freshInstance

  // Publish event (unless suppressed by the silent lane). ONE record-level
  // event carrying every field change; the per-field `<prefix>:field:updated`
  // events were collected into it instead of being published (section 1a).
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
      changes: outcome.changes,
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

  // 🛑 `includeArchived` — an archived row is the ONLY kind this function is
  // ever called for, and without it the loader excluded every one of them.
  const instanceResult = await getEntityInstance({
    id: entityInstanceId,
    organizationId: ctx.organizationId,
    includeArchived: true,
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
 * Permanently delete one entity instance.
 *
 * A thin wrapper over the same three phases as {@link bulkDeleteEntities}
 * with a one-element request (plans/records/bulk-delete-followups.md D-A1:
 * one implementation, so the single-record path cannot drift from the bulk
 * one). The only difference is how a failure surfaces: this THROWS the
 * original error object, `AuxxError` instance and `statusCode` intact, so the
 * router's error formatter and every `instanceof` guard keep working exactly
 * as they did when this function ran the delete itself.
 *
 * A hard delete reaches an archived row, or archive would be a one-way door:
 * a guard telling the caller to "delete the bills first" would be asking for
 * something the API refused to do. The closure resolves the request without
 * an `archivedAt` filter for that reason.
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
  const { errors } = await deleteRecords(ctx, [recordId], options)
  const failure = errors[0]
  if (failure) throw failure.error
}

// ═══════════════════════════════════════════════════════════════════════════
// BULK MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How many records one batched bulk transaction covers. Matches the chunking
 * inside `deleteEntityInstances`, so a chunk here is a chunk there. Shared by
 * the delete's write phase and the bulk archive.
 */
const BULK_CHUNK = 500

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

  // Archive carries NO hooks — there is no `registerEntityPreArchiveHooks` and
  // never has been — so unlike delete this path needs no per-definition lane
  // split. Its three per-record statements (read, update, pair cleanup) collapse
  // to two per chunk (plans/records/bulk-delete-at-scale.md §5.5).
  let count = 0
  // Archived instance ids grouped by (possibly slug-keyed) def id — the
  // publisher canonicalizes def keys itself.
  const archivedByDef = new Map<string, RecordChangedEntry[]>()

  // Grouped by def so the tier-2 frames below and the per-record bus events can
  // both be driven from the ids that ACTUALLY moved.
  const byDef = new Map<string, RecordId[]>()
  for (const recordId of recordIds) {
    const { entityDefinitionId } = parseRecordId(recordId)
    const items = byDef.get(entityDefinitionId) ?? []
    items.push(recordId)
    byDef.set(entityDefinitionId, items)
  }

  for (const [entityDefinitionId, items] of byDef) {
    const entityDef = await ctx.resolveEntityDefinition(entityDefinitionId)

    for (let offset = 0; offset < items.length; offset += BULK_CHUNK) {
      const chunk = items.slice(offset, offset + BULK_CHUNK)
      const instanceIds = chunk.map((recordId) => parseRecordId(recordId).entityInstanceId)

      // Returns only the rows that were not already archived — the same set the
      // per-record loop used to count, since `archiveEntity` threw for an
      // archived row and this loop swallowed it.
      const archived = await archiveEntityInstances({
        ids: instanceIds,
        organizationId: ctx.organizationId,
        db: ctx.db,
      })
      if (archived.isErr()) {
        logger.error('Bulk archive chunk failed', {
          entityDefinitionId,
          error: archived.error.message,
        })
        continue
      }
      const archivedIds: Set<string> = new Set(archived.value)
      if (archivedIds.size === 0) continue

      // Duplicate-suggestion cleanup — OUTSIDE the event guard, exactly as in
      // `archiveEntity`: pair cleanup is data hygiene, not an event, so a
      // silent-lane bulk archive must still clean up after itself.
      const pairs = await deleteOpenPairsForRecords(ctx.db, ctx.organizationId, [...archivedIds])
      if (pairs.isErr()) {
        logger.warn('Duplicate-pair cleanup failed on bulk archive', {
          entityDefinitionId,
          error: pairs.error.message,
        })
      }

      count += archivedIds.size
      const entries = archivedByDef.get(entityDefinitionId) ?? []

      for (const recordId of chunk) {
        const { entityInstanceId } = parseRecordId(recordId)
        if (!archivedIds.has(entityInstanceId)) continue
        entries.push({ recordId: entityInstanceId })

        // In-process, no round trip. The tier-1 `record:archived` frame stays
        // suppressed in favour of the tier-2 delta below (D-17/§7b); the bus
        // event is NOT a realtime frame and still fires per record, exactly as
        // when this loop delegated to `archiveEntity`.
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
        syncCollectorOf(ctx.session)?.recordArchived(recordId)
      }

      archivedByDef.set(entityDefinitionId, entries)
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
 * One record's failure inside a bulk delete.
 *
 * `statusCode` is the HTTP status of the `AuxxError` a restrict relationship
 * or a pre-delete hook raised: 409 for "this purchase order has 1 vendor bill",
 * 400/403/… for a hook's own refusal, `undefined` for anything unexpected.
 * `bulkDeleteEntities` flattens the error to a string, so this is the ONLY
 * thing left telling the router whether `message` is safe to show the user:
 * `record.bulkDelete`'s errorFormatter masks every `INTERNAL_SERVER_ERROR`
 * message as "Internal server error", which is what a guard rejection used to
 * surface as.
 */
export type BulkDeleteError = { recordId: RecordId; message: string; statusCode?: number }

export type BulkDeleteResult = { count: number; errors: BulkDeleteError[] }

/** HTTP status of an `AuxxError`, or `undefined` for an unexpected error. */
function auxxStatusCode(error: unknown): number | undefined {
  if (error instanceof AuxxError) return error.statusCode
  // Duck-type fallback: `@auxx/lib` is transpiled per consumer, so a hook thrown
  // from another copy of the module fails `instanceof` (see `isAuxxError` in
  // apps/web/src/server/api/trpc.ts).
  if (error instanceof Error && typeof (error as AuxxError).statusCode === 'number') {
    return (error as AuxxError).statusCode
  }
  return undefined
}

/**
 * Bulk delete entities (hard delete).
 *
 * Three phases, and nothing is written before the last one
 * (plans/records/bulk-delete-followups.md A.2, generalized over the
 * relationship graph per plans/relationships/01-delete-semantics.md):
 *
 *   1. **collect** the closure: every requested record plus everything its
 *      `onDelete: 'cascade'` relationships own, transitively
 *      ({@link collectDeleteClosure});
 *   2. **refuse**, over the whole closure, requested and cascaded alike:
 *      `onDelete: 'restrict'` relationships, then the per-record pre-delete
 *      hooks. A refusal keeps the requested root's entire tree and reports
 *      the root, so a refused child aborts its parent the way the thrown
 *      error inside the old hook-driven cascade did;
 *   3. **write**, survivors only, deepest group first, set-based per chunk.
 *
 * `count` is the number of REQUESTED records removed. Cascaded records are
 * not counted, exactly as the hook-driven cascades never were, so it stays
 * bounded by `recordIds.length`. `errors` is keyed on the caller's ids: a
 * cascaded record's failure is attributed to the requested root it was
 * collected under, and a record pruned as collateral is not an error itself.
 *
 * @param ctx - Mutation context
 * @param recordIds - Array of RecordIds to delete
 * @param options - Optional CRUD options (skipEvents)
 */
export async function bulkDeleteEntities(
  ctx: MutationContext,
  recordIds: RecordId[],
  options: CrudOptions = {}
): Promise<BulkDeleteResult> {
  if (recordIds.length === 0) return { count: 0, errors: [] }

  const { count, errors } = await deleteRecords(ctx, recordIds, options)
  return {
    count,
    errors: errors.map(({ recordId, error }) => ({
      recordId,
      message: error instanceof Error ? error.message : 'Unknown error',
      statusCode: auxxStatusCode(error),
    })),
  }
}

/** One requested record's failure, with the error object intact. */
interface DeleteFailure {
  recordId: RecordId
  error: unknown
}

/** What phase 2 resolves once per definition in the closure. */
interface DeleteGroupRuntime {
  entityDef: ResolvedEntityDefinition
  fields: CustomFieldEntity[]
  preDeleteHooks: EntityPreDeleteHandler[]
  postDeleteHooks: EntityPostDeleteHandler[]
}

/**
 * Resolve a closure group's definition, hooks and (when anything will read
 * them) its fields. Once per definition, not once per record.
 */
async function resolveDeleteGroup(
  ctx: MutationContext,
  group: DeleteClosureGroup,
  publishEvents: boolean,
  txScope: TxWriteScope | undefined
): Promise<DeleteGroupRuntime> {
  const entityDef = await ctx.resolveEntityDefinition(group.entityDefinitionId)
  const preDeleteHooks = getEntityPreDeleteHooks(entityDef.apiSlug)
  const postDeleteHooks = getEntityPostDeleteHooks(entityDef.apiSlug)
  const needsFields =
    publishEvents ||
    txScope !== undefined ||
    preDeleteHooks.length > 0 ||
    postDeleteHooks.length > 0
  const fields = needsFields ? await ctx.getFields(entityDef.id) : []
  return { entityDef, fields, preDeleteHooks, postDeleteHooks }
}

/**
 * The one delete implementation behind {@link deleteEntity} and
 * {@link bulkDeleteEntities}.
 *
 * The invariant the phase split rests on: **phase 2 reads nothing that phase 3
 * has already deleted**, because phase 3 has not started. Every pre-delete
 * hook and every restrict count runs against the intact database, so a hook
 * asking "does anything still depend on this record" gets a true answer, and
 * a refused record keeps its comments, its duplicate pairs and its children,
 * because none of them were touched yet (followups A.2, "survivors only").
 *
 * What it deliberately does NOT batch: the per-record `captureEventData`
 * read, on the lanes that need it. `getValues` composes linked NAME fields
 * and applies the mail-host gate, so a hand-rolled batched read would change
 * the payload shape of every `entity:deleted` event (followups A.4). On a
 * QUIET lane with no hooks nothing is captured at all, and the whole delete
 * is four statements per 500 records plus the closure reads.
 */
async function deleteRecords(
  ctx: MutationContext,
  recordIds: readonly RecordId[],
  options: CrudOptions
): Promise<{ count: number; errors: DeleteFailure[] }> {
  const publishEvents = derivePublishEvents(ctx, options)
  const txScope = deriveTxWriteScope(ctx, options)

  // Keyed on the requested root. The first failure reported for a root wins.
  const failures = new Map<RecordId, unknown>()
  const fail = (recordId: RecordId, error: unknown) => {
    if (!failures.has(recordId)) failures.set(recordId, error)
  }
  const errors = () => [...failures].map(([recordId, error]) => ({ recordId, error }))

  // ── Phase 1: collect ──
  const closure = await collectDeleteClosure(ctx.db, {
    organizationId: ctx.organizationId,
    recordIds,
  })
  if (closure.isErr()) {
    for (const recordId of new Set(recordIds)) fail(recordId, closure.error)
    return { count: 0, errors: errors() }
  }
  for (const recordId of closure.value.notFound) {
    fail(recordId, new Error(`Entity not found: ${parseRecordId(recordId).entityInstanceId}`))
  }
  const { groups } = closure.value

  // The tree the closure recorded, inverted: parent -> children, so a refusal
  // can prune a whole subtree, and child -> root, so it can be attributed.
  const parentOf = new Map<RecordId, RecordId | null>()
  const childrenOf = new Map<RecordId, RecordId[]>()
  for (const group of groups) {
    for (const record of group.records) {
      parentOf.set(record.recordId, record.requestedBy)
      if (record.requestedBy === null) continue
      const siblings = childrenOf.get(record.requestedBy) ?? []
      siblings.push(record.recordId)
      childrenOf.set(record.requestedBy, siblings)
    }
  }
  const rootOf = (recordId: RecordId): RecordId => {
    let current = recordId
    for (let parent = parentOf.get(current); parent; parent = parentOf.get(current))
      current = parent
    return current
  }
  const pruned = new Set<RecordId>()
  // A refusal anywhere in a tree keeps the WHOLE tree: the refused record
  // survives, so its descendants are still owned by a living record; its
  // ancestors cannot go without stranding it; and their other descendants
  // are still owned by those surviving ancestors.
  const refuse = (record: DeleteClosureRecord, error: unknown) => {
    const root = rootOf(record.recordId)
    fail(root, error)
    const stack = [root]
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (pruned.has(next)) continue
      pruned.add(next)
      stack.push(...(childrenOf.get(next) ?? []))
    }
  }

  // ── Phase 2: refuse, before ANY write ──
  const restrict = await findRestrictViolations(ctx.db, {
    organizationId: ctx.organizationId,
    groups,
  })
  if (restrict.isErr()) {
    for (const group of groups) {
      for (const record of group.records) {
        if (record.requestedBy === null) fail(record.recordId, restrict.error)
      }
    }
    return { count: 0, errors: errors() }
  }

  const runtimes = new Map<string, DeleteGroupRuntime>()
  const captured = new Map<RecordId, Record<string, unknown>>()

  // Shallowest first, so a requested root's own refusal is the one reported
  // and its subtree is pruned before any hook below it has to run.
  for (const group of [...groups].reverse()) {
    let runtime: DeleteGroupRuntime
    try {
      runtime = await resolveDeleteGroup(ctx, group, publishEvents, txScope)
    } catch (error) {
      for (const record of group.records) {
        if (!pruned.has(record.recordId)) refuse(record, error)
      }
      continue
    }
    runtimes.set(group.entityDefinitionId, runtime)
    const { entityDef, fields, preDeleteHooks, postDeleteHooks } = runtime

    for (const record of group.records) {
      if (pruned.has(record.recordId)) continue

      const violation = restrict.value.get(record.recordId)
      if (violation) {
        refuse(record, violation.error)
        continue
      }

      const requested = record.requestedBy === null
      // Capture field values before deletion so:
      //   1. the deleted event carries relationship data (entity triggers like
      //      BOM cost recalculation depend on this);
      //   2. the pre-delete hooks can inspect the record's current state.
      // Post-delete hooks read the same capture, but only run for requested
      // records (see phase 3), so a cascaded record does not pay for them.
      const needsCapture =
        publishEvents ||
        txScope !== undefined ||
        preDeleteHooks.length > 0 ||
        (requested && postDeleteHooks.length > 0)

      try {
        let eventData: Record<string, unknown> = { hardDelete: true }
        if (needsCapture) {
          eventData = {
            hardDelete: true,
            ...(await captureEventData(ctx.fieldValueService, record.recordId, fields)),
          }
        }
        // Pre-delete hooks: throw to reject the delete (4xx surfaced by caller).
        for (const hook of preDeleteHooks) {
          await hook({
            recordId: record.recordId,
            entityDefinitionId: entityDef.id,
            entityType: entityDef.entityType,
            entitySlug: entityDef.apiSlug,
            values: eventData,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            bypass: ctx.fieldValueService.ctx.bypassFieldGuards,
          })
        }
        captured.set(record.recordId, eventData)
      } catch (error) {
        refuse(record, error)
      }
    }
  }

  // ── Phase 3: write, survivors only, deepest group first ──
  let count = 0
  const commentService = new CommentService(ctx.organizationId, ctx.userId, ctx.db, null)

  for (const group of groups) {
    const runtime = runtimes.get(group.entityDefinitionId)
    if (!runtime) continue
    const { entityDef, postDeleteHooks } = runtime
    const survivors = group.records.filter((record) => !pruned.has(record.recordId))

    // One transaction per chunk, not per group (followups D-A3): a group of
    // 10,000 records would otherwise hold one transaction open across the
    // whole phase.
    for (let offset = 0; offset < survivors.length; offset += BULK_CHUNK) {
      const chunk = survivors.slice(offset, offset + BULK_CHUNK)
      const instanceIds = chunk.map((record) => record.entityInstanceId)

      try {
        await commentService.deleteCommentsForDefinition(group.entityDefinitionId, instanceIds)

        unwrapResult(
          await deleteEntityInstances({
            ids: instanceIds,
            organizationId: ctx.organizationId,
            db: ctx.db,
          })
        )

        // Duplicate-suggestion cleanup, matching `archiveEntity` and OUTSIDE
        // the event guard for the same reason: an open pair pointing at a
        // record that no longer exists is worse than one pointing at an
        // archived record.
        const pairs = await deleteOpenPairsForRecords(ctx.db, ctx.organizationId, instanceIds)
        if (pairs.isErr()) {
          logger.warn('Duplicate-pair cleanup failed on delete', {
            entityDefinitionId: group.entityDefinitionId,
            error: pairs.error.message,
          })
        }
      } catch (error) {
        // A chunk fails whole: the transaction inside `deleteEntityInstances`
        // rolled back, so no record in it was removed. Attribute the failure
        // to each record's requested root and keep that root's tree, so a
        // parent is not deleted over children that are still there.
        for (const record of chunk) refuse(record, error)
        continue
      }

      // In-process doors, per record from the ids just removed. No round
      // trips, so these stay per record: `record:deleted` in particular must
      // stay tier 1, because the client removes those rows from the record
      // store in place and a tier-2 delta frame would regress that.
      for (const record of chunk) {
        const requested = record.requestedBy === null
        if (requested) count++

        // Tier-1 sync capture (plan 07 §4): a hard delete is membership too.
        syncCollectorOf(ctx.session)?.recordArchived(record.recordId)

        const eventData = captured.get(record.recordId) ?? { hardDelete: true }

        // Post-delete hooks run for REQUESTED records only. Every registered
        // post-delete hook re-projects the record's parent document (billing
        // totals on the order or work order, the bill's match state, the
        // contact's rollups), and a cascaded record's parent is in the closure
        // and dying with it. Skipping that re-projection once per child is
        // what the guards used to do by hand with `suppressPostDeleteHooks`
        // for orders, invoices, work orders and vendor bills; the closure
        // knows. The option survives for a command that runs the follow-up
        // itself. Log-and-swallow, matching field-change post-hook semantics:
        // the delete itself has already committed.
        if (requested && !options.suppressPostDeleteHooks) {
          for (const hook of postDeleteHooks) {
            try {
              await hook({
                recordId: record.recordId,
                entityDefinitionId: entityDef.id,
                entityType: entityDef.entityType,
                entitySlug: entityDef.apiSlug,
                values: eventData,
                organizationId: ctx.organizationId,
                userId: ctx.userId,
              })
            } catch (error) {
              logger.error('Post-delete hook failed', {
                recordId: record.recordId,
                entitySlug: entityDef.apiSlug,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }

        if (publishEvents) {
          publishRecordLifecycleEvent({
            recordId: record.recordId,
            entityType: entityDef.entityType,
            entityDefinitionId: entityDef.id,
            entitySlug: entityDef.apiSlug,
            action: 'deleted',
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            eventData,
          })
          getRealtimeService()
            .publish(
              rooms.orgRecords(ctx.organizationId, entityDef.id),
              'record:deleted',
              { recordId: record.recordId, entityDefinitionId: entityDef.id },
              { excludeSocketId: ctx.socketId }
            )
            .catch(() => {})
        }

        // Buffered lane: replayed post-commit by `flushTxWriteScope`.
        if (txScope) {
          recordTxWriteArchive(txScope, {
            recordId: record.recordId,
            entityDefinitionId: entityDef.id,
            entityType: entityDef.entityType,
            entitySlug: entityDef.apiSlug,
            realtimeEvent: 'record:deleted',
            eventData,
          })
        }
      }
    }
  }

  return { count, errors: errors() }
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
