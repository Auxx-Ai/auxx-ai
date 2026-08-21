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
  parseResolutionConfig,
  relationFieldWriteMode,
} from '../../import'
import type { FieldWriteModes, ImportMappingProperty, ImportPlan } from '../../import/types'
import { getRealtimeService, publishRecordsInvalidated } from '../../realtime'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import type { JobContext } from '../types'

const logger = createScopedLogger('execute-plan-job')

/**
 * Minimum gap between the coarse `records:invalidated` frames published while
 * rows land. Progress fires once per 50-row batch, so an unthrottled publish
 * would put hundreds of frames on the def channel for a large file — the same
 * firehose the `skipEvents` guard exists to avoid.
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

    // Create CRUD handler and pre-warm caches
    const crudHandler = new UnifiedCrudHandler(organizationId, userId, db)
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

    // B2: the import writes with `skipEvents: true` (below), so build a manifest
    // collector to capture subscribed field/lifecycle changes for record rules. No-op
    // stub (zero cost) when the org has no enabled rules on this def.
    const { loadManifestCollector } = await import('../../record-rules/sync-manifest-collector')
    const manifest = await loadManifestCollector(organizationId)

    // Relation auto-create (`onNoMatch: 'create'`) is a TWO-PHASE design:
    // planning only records the intent, so abandoning the wizard at the preview
    // leaves no orphan records behind. This is phase two, mint the targets and
    // rewrite their resolutions to real record ids, BEFORE the resolutions are
    // read below. Distinct values are deduped, so 500 rows naming "Acme" (or
    // "ACME") produce exactly one company.
    const relationCreates = await materializeRelationCreates(db, {
      organizationId,
      jobId,
      userId,
      createRecord: createRelationTargetWriter({
        organizationId,
        userId,
        db,
        // Auto-created targets reach record rules the same way imported rows do.
        onCreated: (targetDefId, instanceId, data) => {
          if (!manifest.enabled) return
          // Subscriptions are per-def, and the TARGET def (company) is not this
          // import's def (part), look it up rather than reusing the outer one.
          if (manifest.subscriptionsFor(targetDefId)?.lifecycle.created) {
            manifest.recordCreated(toRecordId(targetDefId, instanceId), data)
          }
        },
      }),
    })
    if (relationCreates.created > 0 || relationCreates.failures.length > 0) {
      logger.info('Materialized relation auto-creates', {
        jobId,
        created: relationCreates.created,
        byEntityDefinition: relationCreates.byEntityDefinition,
        failures: relationCreates.failures.length,
      })
    }

    // Load resolutions AFTER materialization, the rewritten rows are the ones
    // execution must read.
    const resolutions = await getAllJobResolutions(db, jobId)
    logger.debug('Loaded resolutions', { jobId, count: resolutions.size })

    // The import writes with `skipEvents: true`, so no `record:created` /
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

      // Use UnifiedCrudHandler with skipEvents
      const created = await crudHandler.create(entityDefinitionId, mergedData, {
        skipEvents: true,
      })

      // B2: capture lifecycle-created + `set`-transition field writes for record rules.
      if (manifest.enabled) {
        const subs = manifest.subscriptionsFor(entityDefinitionId)
        if (subs) {
          const rid = created.recordId
          const { captureCreateFieldChanges, captureCreatedValues } = await import(
            '../../record-rules/capture-field-changes'
          )
          if (subs.lifecycle.created) {
            // Thread raw created values for native entity-trigger lifecycle handlers on the
            // sync door (Phase 9 / Option A) — no DB read, mergedData is in hand.
            const createdValues = await captureCreatedValues(
              organizationId,
              entityDefinitionId,
              mergedData
            )
            manifest.recordCreated(rid, createdValues ?? undefined)
          }
          const entries = await captureCreateFieldChanges(
            organizationId,
            entityDefinitionId,
            mergedData,
            subs.fieldIds
          )
          if (entries) manifest.recordChange(rid, entries)
        }
      }

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

      // B2: read old values for subscribed written fields BEFORE the write.
      let captured: Record<
        string,
        import('../../record-rules/sync-manifest-types').ManifestFieldChange
      > | null = null
      if (manifest.enabled) {
        const subs = manifest.subscriptionsFor(entityDefinitionId)
        if (subs?.fieldIds.size) {
          const { captureUpdateFieldChanges } = await import(
            '../../record-rules/capture-field-changes'
          )
          captured = await captureUpdateFieldChanges(
            db,
            organizationId,
            entityDefinitionId,
            id,
            mergedData,
            subs.fieldIds
          )
        }
      }

      // Use UnifiedCrudHandler with skipEvents. `data.modes` routes multi-value
      // scalar fields through the 'add' bucket (append + server-side dedup);
      // unlisted fields fall through to 'set' as before.
      const instance = await crudHandler.update(recordId, mergedData, data.modes, {
        skipEvents: true,
      })
      if (captured) manifest.recordChange(recordId, captured)

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

    const result = await executePlan({
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

    // Mark job as completed
    await markJobCompleted(db, jobId, result.statistics)

    // Final frame, unthrottled: the last batch's progress publish may have been
    // swallowed by the throttle, and it is the one carrying the tail of the rows.
    await invalidateRecords(true)

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

    await publishEvent({ type: 'job:status', status: 'completed' })

    logger.info('Plan execution complete', {
      jobId,
      planId,
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
