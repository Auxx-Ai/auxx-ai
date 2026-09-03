// packages/lib/src/data-connectors/catalog-update.ts
// Apply side of "Update available" on an app connector
// (plans/money/tasks/41-connector-catalog-update.md section 5.3, D4). Walks the accepted
// diff entries through the EXISTING stream/mapping mutations, so the edit-impact safety
// (`resyncPending` stamping, stale-bind neutralization, owned-instance archiving on
// remove) runs exactly as it does for an interactive edit. Then every matched row gets
// the new catalog's shape hash (D3) and the connector's `catalogDeploymentId` moves
// forward (D2). Runs step by step, not in one transaction: each mutation owns its own
// transaction and a failed step leaves the earlier ones applied, which the next read
// simply reports as a smaller update.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../errors'
import {
  applyBindingOp,
  type CatalogApplyStep,
  nextStreamRequestConfig,
  resolveWildcardKeys,
} from './catalog-diff'
import { type DerivedStream, hashMappingShape, hashStreamShape } from './catalog-shape'
import { computeConnectorCatalogUpdate } from './catalog-update-queries'
import {
  addStream,
  persistStreamShape,
  removeMapping,
  removeStream,
  setStreamRequestConfig,
  setStreamSchema,
  type UpdateMappingInput,
  updateMapping,
} from './mutations'
import { countConnectorItems, stampResyncPending } from './service'
import type { ResyncPending } from './types'

const logger = createScopedLogger('data-connector-catalog-update')

export interface ApplyConnectorCatalogUpdateInput {
  /**
   * The accepted entry ids from `getConnectorCatalogUpdate`. Non-conflict entries are
   * expected in full; a conflict entry is included only when the merchant chose the
   * app's version (keep-mine simply omits it).
   */
  entryIds: string[]
}

export interface ApplyConnectorCatalogUpdateResult {
  applied: number
  /** The connector's pending re-sync marker after apply, for the page banner. */
  resyncPending: ResyncPending | null
  /** The deployment the connector now tracks. */
  catalogDeploymentId: string
}

/** The write helpers apply goes through; injectable so the walk is unit-testable. */
export interface CatalogUpdateWriters {
  addStream: typeof addStream
  persistStreamShape: typeof persistStreamShape
  setStreamRequestConfig: typeof setStreamRequestConfig
  setStreamSchema: typeof setStreamSchema
  updateMapping: typeof updateMapping
  removeMapping: typeof removeMapping
  removeStream: typeof removeStream
  stampResyncPending: typeof stampResyncPending
  countConnectorItems: typeof countConnectorItems
}

const defaultWriters: CatalogUpdateWriters = {
  addStream,
  persistStreamShape,
  setStreamRequestConfig,
  setStreamSchema,
  updateMapping,
  removeMapping,
  removeStream,
  stampResyncPending,
  countConnectorItems,
}

const STEP_ORDER: Record<CatalogApplyStep['kind'], number> = {
  'stream-add': 0,
  'stream-change': 1,
  'mapping-add': 2,
  'mapping-change': 3,
  binding: 3,
  'mapping-remove': 4,
  'stream-remove': 5,
}

/** Deeper mapping keys first, so a child row is removed before its parent. */
function depth(key: string): number {
  return key.split('>').length
}

/**
 * Apply the accepted entries of a connector's catalog update. See the file header for
 * the order and guarantees. Unknown entry ids are a `BadRequestError`; an app that is
 * no longer installed cannot be updated.
 */
export async function applyConnectorCatalogUpdate(
  db: Database,
  organizationId: string,
  connectorId: string,
  input: ApplyConnectorCatalogUpdateInput,
  writers: CatalogUpdateWriters = defaultWriters
): Promise<Result<ApplyConnectorCatalogUpdateResult, Error>> {
  const computed = await computeConnectorCatalogUpdate(db, organizationId, connectorId)
  if (computed.isErr()) return err(computed.error)
  const update = computed.value
  if (!update.installation?.currentDeploymentId) {
    return err(new BadRequestError('The app behind this connector is no longer installed'))
  }

  const steps: Array<{ id: string; step: CatalogApplyStep }> = []
  for (const id of new Set(input.entryIds)) {
    const step = update.steps.get(id)
    if (!step) return err(new BadRequestError(`Unknown catalog update entry '${id}'`))
    steps.push({ id, step })
  }
  steps.sort((a, b) => STEP_ORDER[a.step.kind] - STEP_ORDER[b.step.kind])

  try {
    // Persisted mapping keys -> row ids (wildcard-resolved against the new shape), so a
    // new child can parent onto an existing row and a new stream's rows are reachable.
    const knownIds = new Map<string, string>()
    const derivedByStreamKey = new Map(update.derivedNew.map((s) => [s.key, s]))
    for (const ps of update.persisted) {
      const derived = derivedByStreamKey.get(ps.shape.key)
      const mappings = derived ? resolveWildcardKeys(ps, derived) : ps.mappings
      for (const pm of mappings) knownIds.set(pm.shape.key, pm.row.id)
    }
    const persistedStreamIdByKey = new Map(update.persisted.map((s) => [s.shape.key, s.row.id]))

    // Per-mapping patches accumulate across binding entries so one row gets one write.
    const mappingPatches = new Map<string, { patch: UpdateMappingInput }>()
    const synced = update.connector.lastSyncedAt != null
    const rebackfillStreamIds = new Set<string>()

    for (const { step } of steps) {
      switch (step.kind) {
        case 'stream-add': {
          const row = await writers.addStream(db, organizationId, connectorId, {
            streamKey: step.derived.key,
            sourceSchema: step.derived.sourceSchema,
            schemaSource: 'catalog',
            syncMode: step.derived.syncMode,
            requestConfig: step.derived.webhookTrigger
              ? { webhookTrigger: step.derived.webhookTrigger }
              : null,
            catalogHash: hashStreamShape(step.derived),
          })
          persistedStreamIdByKey.set(step.derived.key, row.id)
          const ids = await writers.persistStreamShape(db, organizationId, row.id, step.derived)
          for (const [key, id] of ids) knownIds.set(key, id)
          break
        }
        case 'stream-change': {
          const streamId = step.persisted.row.id
          if (step.fields.includes('syncMode') || step.fields.includes('webhookTrigger')) {
            await writers.setStreamRequestConfig(db, organizationId, streamId, {
              requestConfig: nextStreamRequestConfig(step.persisted.row, step.derived),
              syncMode: step.derived.syncMode,
            })
          }
          if (step.fields.includes('sourceSchema') && step.derived.sourceSchema) {
            await writers.setStreamSchema(db, organizationId, streamId, {
              sourceSchema: step.derived.sourceSchema,
              schemaSource: 'catalog',
            })
          }
          break
        }
        case 'mapping-add': {
          const streamId = step.persistedStream.row.id
          const ids = await writers.persistStreamShape(
            db,
            organizationId,
            streamId,
            step.derivedStream,
            { knownIds, only: (m) => m.key === step.derived.key }
          )
          for (const [key, id] of ids) knownIds.set(key, id)
          // A mapping added to a synced stream needs a re-projection to fill its target;
          // `addMapping` alone stamps nothing, so mark the stream here.
          if (synced) rebackfillStreamIds.add(streamId)
          break
        }
        case 'mapping-change': {
          const entry = mappingPatches.get(step.persisted.row.id) ?? { patch: {} }
          entry.patch.relationshipFieldKey = step.derived.storedRelationshipFieldKey
          mappingPatches.set(step.persisted.row.id, entry)
          break
        }
        case 'binding': {
          const entry = mappingPatches.get(step.persisted.row.id) ?? { patch: {} }
          entry.patch.fieldMappings = applyBindingOp(
            entry.patch.fieldMappings ?? step.persisted.row.fieldMappings ?? [],
            step.op,
            step.persisted.fieldMappingByBindingKey[step.bindingKey],
            step.derived.fieldMappingByBindingKey[step.bindingKey]
          )
          mappingPatches.set(step.persisted.row.id, entry)
          break
        }
        case 'mapping-remove':
        case 'stream-remove':
          break // handled after the patches, below
      }
    }

    for (const [mappingId, { patch }] of mappingPatches) {
      await writers.updateMapping(db, organizationId, mappingId, patch)
    }

    const removals = steps
      .filter((s) => s.step.kind === 'mapping-remove')
      .map((s) => s.step as Extract<CatalogApplyStep, { kind: 'mapping-remove' }>)
      .sort((a, b) => depth(b.persisted.shape.key) - depth(a.persisted.shape.key))
    for (const step of removals) {
      await writers.removeMapping(db, organizationId, step.persisted.row.id)
    }
    for (const { step } of steps) {
      if (step.kind !== 'stream-remove') continue
      const mappings = [...step.persisted.mappings].sort(
        (a, b) => depth(b.shape.key) - depth(a.shape.key)
      )
      for (const pm of mappings) await writers.removeMapping(db, organizationId, pm.row.id)
      await writers.removeStream(db, organizationId, step.persisted.row.id)
    }

    if (rebackfillStreamIds.size > 0) {
      await writers.stampResyncPending(db, connectorId, {
        level: 'rebackfill',
        reasons: ['mapping-added'],
        streamIds: [...rebackfillStreamIds],
        itemCount: await writers.countConnectorItems(db, connectorId),
        at: new Date().toISOString(),
      })
    }

    // D3: every row the new catalog still describes carries the new default's hash,
    // including a kept-mine row (its own shape then hashes differently, which is exactly
    // what marks it edited for the next update).
    await stampCatalogHashes(db, update.derivedNew, persistedStreamIdByKey, knownIds)

    const catalogDeploymentId = update.installation.currentDeploymentId
    await db
      .update(schema.DataConnector)
      .set({ catalogDeploymentId, updatedAt: new Date() })
      .where(eq(schema.DataConnector.id, connectorId))

    const after = await db.query.DataConnector.findFirst({
      where: eq(schema.DataConnector.id, connectorId),
      columns: { resyncPending: true },
    })
    return ok({
      applied: steps.length,
      resyncPending: after?.resyncPending ?? null,
      catalogDeploymentId,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('applyConnectorCatalogUpdate failed', { error, organizationId, connectorId })
    return err(error instanceof Error ? error : new AuxxError('Internal error'))
  }
}

async function stampCatalogHashes(
  db: Database,
  derivedNew: readonly DerivedStream[],
  streamIdByKey: Map<string, string>,
  mappingIdByKey: Map<string, string>
): Promise<void> {
  for (const stream of derivedNew) {
    const streamId = streamIdByKey.get(stream.key)
    if (!streamId) continue
    await db
      .update(schema.DataConnectorStream)
      .set({ catalogHash: hashStreamShape(stream) })
      .where(eq(schema.DataConnectorStream.id, streamId))
    for (const mapping of stream.mappings) {
      const mappingId = mappingIdByKey.get(mapping.key)
      if (!mappingId) continue
      await db
        .update(schema.DataConnectorMapping)
        .set({ catalogHash: hashMappingShape(mapping) })
        .where(eq(schema.DataConnectorMapping.id, mappingId))
    }
  }
}
