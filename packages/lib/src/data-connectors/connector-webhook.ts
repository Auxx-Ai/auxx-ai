// packages/lib/src/data-connectors/connector-webhook.ts
// The webhook-steered PARTIAL run. A verified inbound delivery (app trigger or generic
// WebhookEndpoint) STEERS the regular connector fetch into the SAME entity sink the
// backfill/steady paths use — but fetches only the changed record (`{path}` steering,
// e.g. `GET /orders/{id}`) instead of re-crawling the collection. Unlike a full sync it
// opens a run marked `partial`: the run observed a SUBSET of the collection, so it must
// NOT reconcile/archive the rest (a one-record run that reconciled would archive every
// other record). It never advances the watermark/cursor (W3 — webhook events are
// out-of-band of the steady delta floor) and is idempotent via the sink's content-hash
// dedupe + the receiver's event-id dedupe. The full-sync path (enqueueConnectorSync) still
// handles cursor streams that have no `{path}` to steer — see the dispatch jobs.

import { getCredential } from '@auxx/credentials/store'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { invalidateSnapshots } from '../snapshot'
import { flattenConnectionMeta } from './connection-meta'
import { prepareConnectorFetch } from './connector-runtime'
import { ConnectorRateLimitError } from './connectors'
import { isConnectorCheckpoint } from './connectors/types'
import { publishConnectorSync } from './realtime'
import { archiveExternalId } from './reconciliation'
import { resolveRelationships } from './relationship-pass'
import {
  countConnectorItems,
  finalizeConnector,
  finalizeRun,
  loadConnector,
  newRunCounters,
  openRun,
  type RunCounters,
  type StreamWithMappings,
} from './service'
import { sinkSourceRecord } from './sink-source-record'
import type { SyncCtx } from './sinks/types'
import { resolveWebhookSteer } from './webhook-steer'

const logger = createScopedLogger('data-connector-webhook')

/**
 * App-trigger / WebhookEndpoint sync bridge — drive ONE stream off one webhook delivery
 * as a PARTIAL run. STEERS the regular connector fetch: reads the stream's `webhookTrigger`
 * config, resolves `{token}` values out of `triggerData`, runs the normal fetch seeded with
 * that context (so auth/baseUrl/pagination/mappings are identical to a bulk sync), and sinks
 * the FETCH result. A delete event skips the fetch and archives by externalId.
 *
 * Opens a real `DataConnectorRun` (`trigger:'webhook'`, `mode:'incremental'`) so the delivery
 * shows in the Runs panel and refreshes `lastSyncedAt` — but closes it as `partial` and runs
 * NO orphan reconciliation (the run saw a single record, not the whole collection). A throttle
 * surfaces as `ConnectorRateLimitError` (the fetch sets `maxRetries: 0`) for the caller to
 * re-enqueue — the run row is dropped on a throttle deferral so retries don't spam the panel.
 * A no-op when the connector/stream is gone or unmapped.
 */
export async function runWebhookSteeredRun(
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
    logger.info('runWebhookSteeredRun: connector gone/unmapped, dropping', { connectorId })
    return
  }
  const { connector, streams } = loaded
  // Match by the functional key — a named stream uses its streamKey, an unnamed one its
  // stable streamId (the dispatch enqueues the same fallback). Keeps webhook deletes +
  // steered fetches routable for streams the user never named.
  const stream = streams.find((s) => (s.stream.streamKey ?? s.stream.id) === streamKey)
  const webhookTrigger = stream?.stream.requestConfig?.webhookTrigger
  if (!stream || !webhookTrigger) {
    logger.info('runWebhookSteeredRun: stream unmapped or not webhook-bound, dropping', {
      connectorId,
      streamKey,
    })
    return
  }

  const steer = resolveWebhookSteer(webhookTrigger, triggerData)
  const counters = newRunCounters()

  // Open a real run. `incremental` mode + no `phase`/cursor reset: a steered point-fetch,
  // never a (re)backfill. The run id flows into the sink ctx — legit now that a row exists.
  const run = await openRun(db, {
    dataConnectorId: connectorId,
    organizationId,
    trigger: 'webhook',
    mode: 'incremental',
  })

  try {
    const ctx = await buildWebhookCtx(db, organizationId, connector, streams, run.id, counters)

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
      // Drain the fetch (1 page for `single`, the full pagination loop for `collection`),
      // sinking each raw page through the SAME mappings as bulk sync. Seed
      // `upstreamUpdatedAt` from the fetched record's `watermarkField` so concurrent events
      // for one externalId can't regress to older data (the guard lives in the sink).
      const updatedAtPath = stream.stream.requestConfig?.incremental?.watermarkField
      for await (const record of records) {
        if (isConnectorCheckpoint(record)) continue
        await sinkSourceRecord(ctx, stream.mappings, record, updatedAtPath)
      }
    }

    // Resolve relationships before finalizing (relationship-linking v3 §9.6 step 7).
    // Unlike `reconcileOrphans` (which archives unseen records — unsafe on a subset, so
    // still skipped), the relationship pass is additive + self-deferring + already
    // connector-wide, so it's safe on a partial run and also clears edges stranded by
    // earlier deliveries. Without it, webhook-steered connectors never form relationships.
    await resolveRelationships(ctx)

    // Invalidate snapshots AFTER the pass so the relationship writes refresh the grid too.
    for (const defId of ctx.touchedDefs) {
      await invalidateSnapshots({ organizationId, resourceType: defId })
    }

    // Close the run PARTIAL — it observed a single steered record, so the connector
    // finalize must NOT reconcile orphans (that would archive the rest of the collection).
    // `finalizeConnector` still stamps `lastSyncedAt` so header freshness advances.
    await finalizeRun(db, run.id, { status: 'partial', counters, startedAt: run.startedAt })
    await finalizeConnector(db, connectorId, {
      ok: true,
      itemCount: await countConnectorItems(db, connectorId),
    })
    // A steered run is a fast point-fetch that never sets the connector to `syncing`
    // (no claimForSync), so there's no live "syncing" phase to animate — this single
    // emit invalidates getStatus + listRuns so the new partial run row appears and
    // freshness advances instantly, instead of waiting on the 15s safety poll.
    await publishConnectorSync(db, organizationId, connectorId, 'run-finished')
    logger.info('runWebhookSteeredRun applied', {
      connectorId,
      streamKey,
      eventId,
      runId: run.id,
      kind: steer.kind,
      created: counters.created,
      updated: counters.updated,
      deleted: counters.deleted,
      archived: counters.archived,
    })
  } catch (err) {
    // A throttle is a "try again later", not an attempt worth recording — drop the run row
    // so a deferred-then-succeeded delivery leaves one clean run, not a trail of failures.
    // The fetch throttles at initiation (before any sink) for the common `single` shape, so
    // nothing is lost; a mid-pagination throttle re-sinks idempotently on retry.
    if (err instanceof ConnectorRateLimitError) {
      await db.delete(schema.DataConnectorRun).where(eq(schema.DataConnectorRun.id, run.id))
    } else {
      await finalizeRun(db, run.id, { status: 'failed', counters, startedAt: run.startedAt }).catch(
        () => {}
      )
      // Surface the failed run row live too — a throttle (run dropped above) emits nothing.
      await publishConnectorSync(db, organizationId, connectorId, 'run-finished')
    }
    throw err
  }
}

/** Build a one-shot sink context for a webhook delivery, bound to the real run id. */
async function buildWebhookCtx(
  db: Database,
  organizationId: string,
  connector: SyncCtx['connector'],
  streams: StreamWithMappings[],
  runId: string,
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
  // Best-effort — a webhook-steered partial run never fails on a metadata load miss.
  let connectionMeta: Record<string, unknown> | null = null
  if (connector.credentialId) {
    const result = await getCredential(connector.credentialId, organizationId)
    if (result.isOk()) {
      connectionMeta = flattenConnectionMeta(result.value)
    } else {
      logger.warn('Failed to load connection metadata for connectionAppFields', {
        connectorId: connector.id,
        credentialId: connector.credentialId,
        error: result.error.message,
      })
    }
  }
  return {
    db,
    orgId: organizationId,
    connector,
    runId,
    crud,
    ownedCrud,
    counters,
    touchedDefs: new Set<string>(),
    connectionMeta,
  }
}
