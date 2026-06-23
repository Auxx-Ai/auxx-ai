// packages/lib/src/data-connectors/reconciliation.ts
// Orphan reconciliation + explicit deletes (04 §4).
//
// Orphan reconciliation runs ONLY for owned + snapshot + upsert mappings: an
// item row whose lastSeenRunId !== this run is an orphan → archiveRecord with the
// mapping's orphanBehavior. Skipped for incremental (absence ≠ deletion), for
// reference mappings (they write nothing), and for ALL contributing mode (never
// archive a co-owned helpdesk record).
//
// Explicit deletes flow through the connector's resolveDelete → archiveRecord.

import { createScopedLogger } from '@auxx/logger'
import { connectorFor } from './connectors'
import { findItem, type StreamWithMappings } from './service'
import { entitySink } from './sinks/entity-sink'
import type { SyncCtx } from './sinks/types'
import type { DecodedMapping, SyncMode } from './types'

const logger = createScopedLogger('data-connector-reconciliation')

/** The slice of a stream reconciliation needs: its sync mode + decoded mappings. */
type ReconcilableStream = { syncMode: SyncMode; mappings: DecodedMapping[] }

/**
 * Archive orphans for eligible mappings. `streams` carries each stream's syncMode
 * so we can gate snapshot-only. Only owned + snapshot + upsert mappings reconcile.
 * Accepts both the full `StreamWithMappings` (single-shot) and the pinned snapshot
 * shape (sliced chain) — it reads only `syncMode` + `mappings`.
 */
export async function reconcileOrphans(ctx: SyncCtx, streams: ReconcilableStream[]): Promise<void> {
  for (const { syncMode, mappings } of streams) {
    if (syncMode !== 'snapshot') continue // incremental: absence ≠ deletion
    for (const mapping of mappings) {
      if (mapping.targetMode !== 'owned') continue // never archive co-owned records
      if (mapping.linkMode !== 'upsert') continue // reference mappings write nothing
      if (mapping.orphanBehavior === 'ignore') continue

      const items = await entitySink.listExistingItems(ctx, mapping)
      for (const item of items) {
        if (item.lastSeenRunId === ctx.runId) continue // seen this run
        await entitySink.archiveRecord(ctx, item, mapping.orphanBehavior)
      }
    }
  }
}

/**
 * Handle an explicit upstream delete signal. Resolves the (streamKey, externalId)
 * via the connector, finds every bound item for that external id across the
 * connector's mappings, and archives them.
 */
export async function handleConnectorDelete(
  ctx: SyncCtx,
  streams: StreamWithMappings[],
  event: unknown
): Promise<void> {
  const connector = connectorFor(ctx.connector.type, {
    db: ctx.db,
    organizationId: ctx.orgId,
    connector: {
      id: ctx.connector.id,
      type: ctx.connector.type,
      credentialId: ctx.connector.credentialId,
      appInstallationId: ctx.connector.appInstallationId,
    },
  })
  const resolved = connector.resolveDelete?.(event) ?? null
  if (!resolved) {
    logger.info('connector.resolveDelete returned null — ignoring delete event', {
      connectorId: ctx.connector.id,
    })
    return
  }

  const stream = streams.find((s) => s.stream.streamKey === resolved.streamKey)
  if (!stream) return

  for (const mapping of stream.mappings) {
    const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, resolved.externalId)
    if (!item) continue
    // Explicit delete archives regardless of mode (the upstream said so).
    await entitySink.archiveRecord(
      ctx,
      {
        id: item.id,
        entityInstanceId: item.entityInstanceId,
        entityDefinitionId: item.entityDefinitionId,
      },
      mapping.orphanBehavior === 'ignore' ? 'archive' : mapping.orphanBehavior
    )
    ctx.counters.deleted += 1
  }
}
