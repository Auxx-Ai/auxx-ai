// packages/lib/src/data-connectors/connector-webhook.ts
// Step 8A — the webhook sink fast path. A verified inbound delivery is resolved (in
// the receiver) into WebhookActions; this applies them to the SAME entity sink the
// backfill/steady paths use. A webhook is a POINT WRITE, not a run: it opens no
// DataConnectorRun, never stamps `lastSeenRunId`/the watermark (W3 — that would skew
// orphan reconciliation + the steady delta floor), and is idempotent via the sink's
// content-hash dedupe + the receiver's event-id dedupe.
//
// `applyWebhookActions` is pure over the injected ctx + streams so it unit-tests with
// a fake sink (no DB). `runConnectorWebhook` is the worker entry that loads the
// connector, builds the ephemeral ctx, applies, and invalidates snapshots once.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { invalidateSnapshots } from '../snapshot'
import { archiveExternalId } from './reconciliation'
import { loadConnector, newRunCounters, type RunCounters, type StreamWithMappings } from './service'
import { sinkSourceRecord } from './sink-source-record'
import type { SyncCtx } from './sinks/types'
import type { WebhookAction } from './types'

const logger = createScopedLogger('data-connector-webhook')

/**
 * Apply resolved webhook actions to the entity sink. `upsert` fans out through the
 * shared `sinkSourceRecord` (same path as backfill); `delete` archives every item
 * bound to the external id. An action for an unknown/unmapped stream is dropped
 * (logged) — a topic we don't map is a no-op, never an error.
 */
export async function applyWebhookActions(
  ctx: SyncCtx,
  streams: StreamWithMappings[],
  actions: WebhookAction[]
): Promise<void> {
  for (const action of actions) {
    const stream = streams.find((s) => s.stream.streamKey === action.streamKey)
    if (!stream) {
      logger.info('webhook action for unmapped stream — dropping', {
        connectorId: ctx.connector.id,
        streamKey: action.streamKey,
        kind: action.kind,
      })
      continue
    }
    if (action.kind === 'upsert') {
      await sinkSourceRecord(ctx, stream.mappings, action.record)
    } else {
      await archiveExternalId(ctx, stream.mappings, action.externalId)
    }
  }
}

/**
 * Worker entry: apply a verified webhook delivery's actions to the connector's
 * entities. Loads the connector + its enabled streams, builds a one-shot sink
 * context (`runId = webhook:<eventId>` — a synthetic id that never collides with a
 * real run's `lastSeenRunId`), applies the actions, then invalidates the touched
 * defs once. A no-op when the connector is gone/unmapped (deleted mid-flight).
 */
export async function runConnectorWebhook(
  db: Database,
  data: { connectorId: string; organizationId: string; actions: WebhookAction[]; eventId: string }
): Promise<void> {
  const { connectorId, organizationId, actions, eventId } = data
  if (actions.length === 0) return

  const loaded = await loadConnector(db, organizationId, connectorId)
  if (!loaded) {
    logger.info('runConnectorWebhook: connector gone/unmapped, dropping', { connectorId })
    return
  }
  const { connector, streams } = loaded

  const counters = newRunCounters()
  const ctx = await buildWebhookCtx(db, organizationId, connector, streams, eventId, counters)

  await applyWebhookActions(ctx, streams, actions)

  for (const defId of ctx.touchedDefs) {
    await invalidateSnapshots({ organizationId, resourceType: defId })
  }
  logger.info('runConnectorWebhook applied', {
    connectorId,
    eventId,
    actions: actions.length,
    created: counters.created,
    updated: counters.updated,
    deleted: counters.deleted,
    archived: counters.archived,
  })
}

/** Build a one-shot sink context for a webhook delivery (mirrors the sliced source). */
async function buildWebhookCtx(
  db: Database,
  organizationId: string,
  connector: SyncCtx['connector'],
  streams: StreamWithMappings[],
  eventId: string,
  counters: RunCounters
): Promise<SyncCtx> {
  const userId = connector.createdById ?? 'system'
  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const ownedCrud = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    bypassFieldGuards: new Set<never>(),
  })
  const defs = new Set(streams.flatMap((s) => s.mappings.map((m) => m.entityDefinitionId)))
  for (const defId of defs) {
    await crud.warmCache(defId)
    await ownedCrud.warmCache(defId)
  }
  return {
    db,
    orgId: organizationId,
    connector,
    // Synthetic run id — a webhook is a point write, never a run. NEVER reuse a real
    // run id here or `touchItem`/orphan reconciliation would see the webhook as a run.
    runId: `webhook:${eventId}`,
    crud,
    ownedCrud,
    counters,
    touchedDefs: new Set<string>(),
  }
}
