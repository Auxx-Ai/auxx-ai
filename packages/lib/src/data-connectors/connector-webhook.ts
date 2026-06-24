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
import { prepareConnectorFetch } from './connector-runtime'
import { isConnectorCheckpoint } from './connectors/types'
import { archiveExternalId } from './reconciliation'
import {
  loadConnector,
  newRunCounters,
  type RunCounters,
  type StreamWithMappings,
  stampWebhookEvent,
} from './service'
import { sinkSourceRecord } from './sink-source-record'
import type { SyncCtx } from './sinks/types'
import type { WebhookAction } from './types'
import { resolveWebhookSteer } from './webhook-steer'

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

/**
 * App-trigger sync bridge (§5.3) — drive ONE stream off one app-webhook delivery.
 * Unlike `runConnectorWebhook` (which sinks a pre-resolved payload), this STEERS the
 * regular connector fetch: it reads the stream's `webhookTrigger` config, resolves
 * `{token}` values out of `triggerData`, runs the normal fetch seeded with that
 * context (so auth/baseUrl/pagination/mappings are identical to a bulk sync), and
 * sinks the FETCH result. A delete event skips the fetch and archives by externalId.
 *
 * Like `runConnectorWebhook` it's a POINT WRITE: synthetic `runId =
 * app-webhook:<eventId>`, no `DataConnectorRun`, no watermark/cursor advance
 * (webhook events are out-of-band of the sync cursor). A throttle surfaces as
 * `ConnectorRateLimitError` (the fetch sets `maxRetries: 0`) for the caller to
 * re-enqueue. A no-op when the connector/stream is gone or unmapped.
 */
export async function runWebhookEventSlice(
  db: Database,
  data: {
    connectorId: string
    organizationId: string
    streamKey: string
    triggerData: Record<string, unknown>
    eventId: string
  }
): Promise<void> {
  const { connectorId, organizationId, streamKey, triggerData, eventId } = data

  const loaded = await loadConnector(db, organizationId, connectorId)
  if (!loaded) {
    logger.info('runWebhookEventSlice: connector gone/unmapped, dropping', { connectorId })
    return
  }
  const { connector, streams } = loaded
  const stream = streams.find((s) => s.stream.streamKey === streamKey)
  const webhookTrigger = stream?.stream.requestConfig?.webhookTrigger
  if (!stream || !webhookTrigger) {
    logger.info('runWebhookEventSlice: stream unmapped or not webhook-bound, dropping', {
      connectorId,
      streamKey,
    })
    return
  }

  const steer = resolveWebhookSteer(webhookTrigger, triggerData)
  const counters = newRunCounters()
  const ctx = await buildWebhookCtx(
    db,
    organizationId,
    connector,
    streams,
    eventId,
    counters,
    'app-webhook'
  )

  if (steer.kind === 'delete') {
    if (steer.externalId) await archiveExternalId(ctx, stream.mappings, steer.externalId)
  } else {
    const { definition, credential } = await prepareConnectorFetch(
      db,
      organizationId,
      connector,
      connector.createdById ?? 'system'
    )
    const { records } = await definition.fetch({
      streamKey,
      mode: 'snapshot',
      state: {},
      credential,
      config: connector.config,
      requestConfig: stream.stream.requestConfig ?? undefined,
      triggerContext: steer.triggerContext,
      // H1 — never sleep on a throttle; surface it for the caller to re-enqueue.
      rateLimitOverride: { maxRetries: 0 },
    })
    // Drain the fetch (1 page for `single`, the full pagination loop for
    // `collection`), sinking each raw page through the SAME mappings as bulk sync.
    // Seed `upstreamUpdatedAt` from the fetched record's `watermarkField` so concurrent
    // events for one externalId can't regress to older data (§9 Q7 — the guard itself
    // lives in the sink, which compares the stamp against the bound item's stored one).
    const updatedAtPath = stream.stream.requestConfig?.incremental?.watermarkField
    for await (const record of records) {
      if (isConnectorCheckpoint(record)) continue
      await sinkSourceRecord(ctx, stream.mappings, record, updatedAtPath)
    }
  }

  for (const defId of ctx.touchedDefs) {
    await invalidateSnapshots({ organizationId, resourceType: defId })
  }
  // Liveness stamp — a webhook sync opens no run, so this is the only signal that
  // keeps a healthy webhook-sync connector from reading as "never synced" (§9).
  await stampWebhookEvent(db, connectorId)
  logger.info('runWebhookEventSlice applied', {
    connectorId,
    streamKey,
    eventId,
    kind: steer.kind,
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
  counters: RunCounters,
  /** Synthetic run-id namespace: `webhook` (action sink) vs `app-webhook` (steered slice). */
  runIdPrefix: 'webhook' | 'app-webhook' = 'webhook'
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
    runId: `${runIdPrefix}:${eventId}`,
    crud,
    ownedCrud,
    counters,
    touchedDefs: new Set<string>(),
  }
}
