// packages/lib/src/jobs/import/execute-plan-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'
import { toRecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { canonicalizeEntityDefinitionId, findCachedResource } from '../../cache'
import {
  createEventPublisher,
  createRelationTargetWriter,
  executePlan,
  getAllJobResolutions,
  markJobCompleted,
  markJobExecuting,
  markJobFailed,
  materializeRelationCreates,
  materializeSelectCreates,
  parseResolutionConfig,
  relationFieldWriteMode,
} from '../../import'
import type { FieldWriteModes, ImportMappingProperty, ImportPlan } from '../../import/types'
import { getRealtimeService, publishRecordsInvalidated, publishRunCompleted } from '../../realtime'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { WriteSession } from '../../resources/crud/write-origin'
import { runWithWriteSession } from '../../resources/crud/write-session-als'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import type { JobContext } from '../types'

const logger = createScopedLogger('execute-plan-job')

/**
 * Minimum gap between the coarse `records:invalidated` frames published while
 * rows land. Progress fires once per 50-row batch, so an unthrottled publish
 * would put hundreds of frames on the def channel for a large file — the same
 * firehose the silent `sync` write session exists to avoid.
 */
const INVALIDATE_THROTTLE_MS = 2_000

/** Job payload for executing an import plan */
export interface ExecutePlanJobProps {
  jobId: string
  planId: string
  organizationId: string
  userId: string
}

/**
 * Job handler for executing an import plan.
 * Creates/updates records based on the plan.
 */
export async function executePlanJob(ctx: JobContext<ExecutePlanJobProps>): Promise<void> {
  const job = ctx.job
  const { jobId, planId, organizationId, userId } = job.data

  logger.info('Starting plan execution', { jobId, planId, organizationId })

  // Get Redis for event publishing
  const redis = await getPublishingClient()
  if (!redis) {
    throw new Error('Redis publishing client not available')
  }
  const publishEvent = createEventPublisher(redis, jobId)

  try {
    // Fetch the import job
    const importJob = await db.query.ImportJob.findFirst({
      where: eq(schema.ImportJob.id, jobId),
      with: {
        importMapping: {
          with: {
            properties: true,
          },
        },
      },
    })

    if (!importJob) {
      throw new Error(`Import job not found: ${jobId}`)
    }

    // Verify organization
    if (importJob.organizationId !== organizationId) {
      throw new Error('Import job does not belong to organization')
    }

    // Fetch the plan
    const plan = await db.query.ImportPlan.findFirst({
      where: eq(schema.ImportPlan.id, planId),
    })

    if (!plan) {
      throw new Error(`Import plan not found: ${planId}`)
    }

    // Mark job as executing
    await markJobExecuting(db, jobId)
    await publishEvent({ type: 'job:status', status: 'executing' })

    // Get mappings
    const mappings = importJob.importMapping.properties.map((p) => ({
      id: p.id,
      importMappingId: p.importMappingId,
      sourceColumnIndex: p.sourceColumnIndex,
      sourceColumnName: p.sourceColumnName ?? undefined,
      targetType: p.targetType as 'particle' | 'relation' | 'skip',
      targetFieldKey: p.targetFieldKey,
      customFieldId: p.customFieldId,
      resolutionType: p.resolutionType as ImportMappingProperty['resolutionType'],
      resolutionConfig: p.resolutionConfig ?? undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))

    // B2: the import writes on the silent `sync` lane (below), so build a manifest
    // collector. Always real (plan 07): tier-1 membership AND tier-2 `{o, n}` deltas
    // are captured at the engine seams, keyed off the session's collector — the job
    // itself never captures; it only folds, persists, and publishes the manifest.
    const { loadManifestCollector } = await import('../../record-rules/sync-manifest-collector')
    const manifest = await loadManifestCollector(organizationId)

    // Plan 03 §3.4/§4b S1: one `sync` session for the whole import — its silent
    // lane is what `skipEvents: true` used to declare per call. The plan
    // execution below also runs inside `runWithWriteSession(session, …)` so
    // handlers constructed downstream (the relation-target writer) inherit it
    // ambiently.
    const session: WriteSession = {
      origin: { kind: 'sync', source: 'import', ref: jobId, collector: manifest },
      depth: 0,
    }

    // Create CRUD handler and pre-warm caches
    const crudHandler = new UnifiedCrudHandler(organizationId, userId, db, undefined, { session })
    const entityDefinitionId = importJob.importMapping.entityDefinitionId

    // Pre-warm caches once for entire import (avoids N queries for N records)
    await crudHandler.warmCache(entityDefinitionId)
    logger.debug('Cache warmed for import', { entityDefinitionId })

    // B3: multi-value scalar targets (`options.multi`) get write mode 'add' —
    // matched rows APPEND new values instead of whole-field-setting (which
    // would wipe the record's alias list). Keys mirror how buildRecordData
    // keys the data: customFieldId for custom fields, targetFieldKey otherwise.
    // Tolerant lookup for the same reason `generatePlan` uses one: this id may be
    // an entityType slug, and `getCachedResource` only ever matches the CUID. A miss
    // here empties `fieldModes`, so multi-value scalars whole-field-set instead of
    // appending and `has_many` relations silently drop every unmentioned link.
    const resource = await findCachedResource(organizationId, entityDefinitionId)
    const fieldModes: FieldWriteModes = {}
    for (const mapping of mappings) {
      if (!mapping.targetFieldKey || mapping.targetType === 'skip') continue
      const field = resource?.fields.find((f) =>
        mapping.customFieldId
          ? f.id === mapping.customFieldId
          : getFieldOutputKey(f) === mapping.targetFieldKey
      )
      if (!field) continue
      if (!field.relationship && field.options?.multi === true) {
        fieldModes[mapping.customFieldId ?? mapping.targetFieldKey] = 'add'
        continue
      }
      // Relations get the same treatment via their own `linkMode`. Without this
      // arm a `has_many` relation on an UPDATE row falls through to `'set'` and
      // silently DROPS every link the file did not mention, a CSV column
      // carrying one supplier is not a statement that the part has only that
      // supplier. Defaults to `'add'`; `'set'` is the explicit opt-in.
      if (field.relationship) {
        const linkMode = parseResolutionConfig(mapping.resolutionConfig).relationConfig?.linkMode
        const mode = relationFieldWriteMode(field.relationship.relationshipType, linkMode)
        if (mode) fieldModes[mapping.customFieldId ?? mapping.targetFieldKey] = mode
      }
    }

    // Data keys of the identifier mapping, a uniqueness conflict on one of
    // these during a `create` degrades the row to update-by-append on the record
    // that owns the value (in-file duplicate identifiers, planning misses).
    // Keys mirror how `buildRecordData` keys the payload: `customFieldId` for
    // custom fields, `targetFieldKey` otherwise.
    //
    // This list being empty is what kept the degrade-to-update arm dead: the
    // fallback arm then STRIPS the identifier and retries, and
    // `UnifiedCrudHandler.create` validates no required fields, so a duplicate
    // SKU imported as a part with no SKU at all.
    const identifierFieldKeys = importJob.importMapping.identifierFieldKeys ?? []
    const identifierKeys = mappings
      .filter((m) => !!m.targetFieldKey && identifierFieldKeys.includes(m.targetFieldKey))
      .map((m) => m.customFieldId ?? m.targetFieldKey!)

    // Relation auto-create (`onNoMatch: 'create'`) is a TWO-PHASE design:
    // planning only records the intent, so abandoning the wizard at the preview
    // leaves no orphan records behind. This is phase two, mint the targets and
    // rewrite their resolutions to real record ids, BEFORE the resolutions are
    // read below. Distinct values are deduped, so 500 rows naming "Acme" (or
    // "ACME") produce exactly one company.
    // Wrapped in the session so the writer's lazily constructed handler inherits
    // it ambiently (S1 resolution) — that inheritance is what keeps auto-created
    // targets on the silent lane now that the writer passes no `skipEvents`.
    const relationCreates = await runWithWriteSession(session, () =>
      materializeRelationCreates(db, {
        organizationId,
        jobId,
        userId,
        // Auto-created targets reach record rules the same way imported rows do:
        // the writer's handler inherits the ambient sync session, so the engine's
        // create seam captures them (per-def subscriptions included).
        createRecord: createRelationTargetWriter({ organizationId, userId, db }),
      })
    )
    if (relationCreates.created > 0 || relationCreates.failures.length > 0) {
      logger.info('Materialized relation auto-creates', {
        jobId,
        created: relationCreates.created,
        byEntityDefinition: relationCreates.byEntityDefinition,
        failures: relationCreates.failures.length,
      })
    }

    // Select-option auto-create (`select:create`) is the same two-phase design
    // on the OPTION side: planning only records the intent, so abandoning the
    // wizard leaves the field's taxonomy untouched. This is phase two — append
    // what genuinely does not exist and rewrite those resolutions to real option
    // keys, BEFORE the resolutions are read below. Without it the raw LABEL was
    // written straight through as an `optionId` no option owns.
    // Order relative to the relation materializer is irrelevant: the two
    // partition the `status: 'create'` rows and touch disjoint resolutions.
    const selectCreates = await runWithWriteSession(session, () =>
      materializeSelectCreates(db, { organizationId, jobId })
    )
    if (selectCreates.created > 0 || selectCreates.failures.length > 0) {
      logger.info('Materialized select option auto-creates', {
        jobId,
        created: selectCreates.created,
        byField: selectCreates.byField,
        failures: selectCreates.failures.length,
      })
    }

    // Load resolutions AFTER materialization, the rewritten rows are the ones
    // execution must read.
    const resolutions = await getAllJobResolutions(db, jobId)
    logger.debug('Loaded resolutions', { jobId, count: resolutions.size })

    // The import writes on the silent `sync` lane, so no `record:created` /
    // `record:updated` / `fieldValues:updated` frame ever reaches an open grid.
    // Publish the same coarse signal the connector sync path uses instead — one
    // `records:invalidated` per def, which the client turns into a single list
    // refetch. Without it the grid stays stale until a manual reload.
    //
    // This import's def is NOT the only one touched any more. Relation
    // auto-create (`onNoMatch: 'create'`) mints records on the TARGET def, a
    // parts import naming new suppliers writes `company` rows, so every def
    // that received a write has to be invalidated, or an open companies grid
    // stays stale until a manual reload.
    //
    // The room key MUST be canonicalized. `ImportMapping.entityDefinitionId` holds
    // either keyspace — for a def-backed system type it is the bare entityType slug
    // (`part`), while the client subscribes with `Resource.entityDefinitionId`, which
    // is always the org's EntityDefinition CUID. `crudHandler` hides the difference
    // because it resolves the def and publishes with `entityDef.id`; publishing the
    // raw mapping value here addressed `…-records-part` while every browser sat on
    // `…-records-<cuid>`, so the frame was delivered to nobody.
    const roomDefId = await canonicalizeEntityDefinitionId(organizationId, entityDefinitionId)

    // Canonicalize the auto-create targets the same way, and de-duplicate: a
    // target may well BE this import's def.
    const touchedDefIds = [
      ...new Set([
        roomDefId,
        ...(await Promise.all(
          Object.keys(relationCreates.byEntityDefinition).map((defId) =>
            canonicalizeEntityDefinitionId(organizationId, defId)
          )
        )),
      ]),
    ]

    let lastInvalidateAt = 0
    const invalidateRecords = async (force = false) => {
      const now = Date.now()
      if (!force && now - lastInvalidateAt < INVALIDATE_THROTTLE_MS) return
      lastInvalidateAt = now
      await publishRecordsInvalidated(getRealtimeService(), organizationId, {
        entityDefinitionIds: touchedDefIds,
      }).catch(() => {})
    }

    const createRecord = async (data: {
      standardFields: Record<string, unknown>
      customFields: Record<string, unknown>
      modes?: FieldWriteModes
    }) => {
      logger.debug('createRecord called', { entityDefinitionId })

      // Merge fields - UnifiedCrudHandler handles field routing internally
      const mergedData: Record<string, unknown> = {
        ...data.standardFields,
        ...data.customFields,
      }

      // Event suppression comes from the handler's silent `sync` session
      // (plan 03 §3.4), not a per-call flag. Lifecycle-created membership, raw
      // created values, and the create's `{n}`-only deltas are captured at the
      // engine's create seam (plan 07 PR 2).
      const created = await crudHandler.create(entityDefinitionId, mergedData)

      logger.debug('Created record', { id: created.instance.id, entityDefinitionId })
      return { id: created.instance.id }
    }

    const updateRecord = async (
      id: string,
      data: {
        standardFields: Record<string, unknown>
        customFields: Record<string, unknown>
        modes?: FieldWriteModes
      }
    ) => {
      logger.debug('updateRecord called', { id, entityDefinitionId, hasId: !!id })

      if (!id) {
        throw new Error(`updateRecord called with invalid id: ${id}`)
      }

      const mergedData: Record<string, unknown> = {
        ...data.standardFields,
        ...data.customFields,
      }

      const recordId = toRecordId(entityDefinitionId, id)
      logger.debug('Calling crudHandler.update', { recordId, entityDefinitionId, id })

      // Event suppression comes from the handler's silent `sync` session
      // (plan 03 §3.4). `data.modes` routes multi-value scalar fields through
      // the 'add' bucket (append + server-side dedup); unlisted fields fall
      // through to 'set' as before. Manifest capture (tier-1 membership +
      // tier-2 `{o, n}` deltas) happens at the engine seams (plan 07 PR 2).
      const instance = await crudHandler.update(recordId, mergedData, data.modes)

      logger.debug('Updated record', { recordId, entityDefinitionId })
      return { id: instance.id }
    }

    // Execute the plan
    const planData: ImportPlan = {
      id: plan.id,
      importJobId: plan.importJobId,
      status: plan.status as ImportPlan['status'],
      completedAt: plan.completedAt ?? undefined,
      createdAt: plan.createdAt,
    }

    // Ambient session for the whole plan execution (plan 03 §4b S1): any handler
    // constructed downstream without an explicit session inherits this one.
    const result = await runWithWriteSession(session, () =>
      executePlan({
        db,
        organizationId,
        userId,
        jobId,
        plan: planData,
        entityDefinitionId: importJob.importMapping.entityDefinitionId,
        mappings,
        resolutions,
        fieldModes,
        identifierKeys,
        createRecord,
        updateRecord,
        onRowWarning: async (rowIndex, message) => {
          await publishEvent({ type: 'row:warning', rowIndex, message })
        },
        onProgress: async (progress) => {
          const percentage = Math.round((progress.processed / progress.total) * 100)
          await job.updateProgress(percentage)

          await publishEvent({
            type: 'execution:progress',
            strategyId: progress.strategyId,
            strategy: progress.strategy,
            processed: progress.processed,
            total: progress.total,
            succeeded: progress.succeeded,
            failed: progress.failed,
          })

          // Keep every open grid live while the import runs, not just at the end.
          await invalidateRecords()
        },
      })
    )

    // Mark job finished. The terminal status is derived from the statistics
    // inside `markJobCompleted` — `completed`, `completed_with_errors`, or
    // `failed` when no row landed at all — and is what the SSE frame below
    // carries. Publishing a literal `'completed'` here is what let a run that
    // rejected all 201 rows close the wizard on a green success card.
    const finalStatus = await markJobCompleted(db, jobId, result.statistics)

    // Final frame, unthrottled: the last batch's progress publish may have been
    // swallowed by the throttle, and it is the one carrying the tail of the rows.
    await invalidateRecords(true)

    // §7b run-completion edge — the importer's first completion signal (until
    // now its only realtime footprint was the throttled invalidate above). Per-
    // def changed counts from what execution already tracks: the import's own
    // def gets created+updated, relation auto-create targets get their created
    // counts (minted BEFORE `executePlan`, so never double-counted in the
    // statistics). Keys may be slug-keyed here; `publishRunCompleted`
    // canonicalizes and merges. Fire-and-forget — never fails the import.
    const defCounts: Record<string, number> = {
      [entityDefinitionId]: result.statistics.created + result.statistics.updated,
    }
    for (const [defId, count] of Object.entries(relationCreates.byEntityDefinition)) {
      defCounts[defId] = (defCounts[defId] ?? 0) + count
    }
    await publishRunCompleted(getRealtimeService(), organizationId, {
      source: 'import',
      ref: jobId,
      defCounts,
    }).catch(() => {})

    // B2: persist the captured manifest on the ImportJob row and publish ONE pointer
    // event — the same row-transport the connector path uses (no inline cap, no silent
    // truncation). Best-effort — a manifest failure must never fail the import.
    try {
      const captured = manifest.toJson()
      if (captured) {
        const { saveImportManifest } = await import('../../import')
        await saveImportManifest(db, jobId, captured)
        const { publisher } = await import('../../events/publisher')
        await publisher.publishLater({
          type: 'sync:records:changed',
          data: {
            source: 'import',
            organizationId,
            ref: jobId,
            // Deprecated duplicate, kept one release for in-flight consumers.
            importRef: jobId,
          },
        })
      }
    } catch (manifestErr) {
      logger.error('failed to publish import sync:records:changed', {
        jobId,
        error: manifestErr instanceof Error ? manifestErr.message : String(manifestErr),
      })
    }

    await publishEvent({
      type: 'execution:complete',
      statistics: result.statistics,
      durationMs: result.durationMs,
    })

    await publishEvent({ type: 'job:status', status: finalStatus })

    logger.info('Plan execution complete', {
      jobId,
      planId,
      status: finalStatus,
      statistics: result.statistics,
      durationMs: result.durationMs,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.error('Plan execution failed', { jobId, planId, error: errorMessage })

    // Mark job as failed
    await markJobFailed(db, jobId, errorMessage)

    await publishEvent({ type: 'error', message: errorMessage })
    await publishEvent({ type: 'job:status', status: 'failed' })

    throw error
  }
}
