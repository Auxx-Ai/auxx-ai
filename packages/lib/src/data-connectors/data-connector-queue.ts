// packages/lib/src/data-connectors/data-connector-queue.ts
// BullMQ queue + enqueue helper for connector syncs. Mirrors the knowledge-source
// sync queue. The jobId coalesces duplicate manual "Sync now" clicks; scheduled
// fires get distinct ids and rely on the in-handler concurrency guard.

import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../jobs/queues'
import type { WebhookAction } from './types'

const logger = createScopedLogger('data-connector-queue')

/** Job payload for a connector sync. */
export interface DataConnectorSyncJobData {
  type: 'data-connector-sync'
  connectorId: string
  organizationId: string
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill'
}

/** BullMQ job name for one backfill slice (the continuation-chain unit). */
export const BACKFILL_SLICE_JOB = 'data-connector-backfill-slice'

/** Job payload for one backfill slice — one stream's continuation chain (Step 4). */
export interface BackfillSliceJobData {
  type: typeof BACKFILL_SLICE_JOB
  connectorId: string
  organizationId: string
  /** The stream this slice advances (its own chain under the connector backfill). */
  streamId: string
  /** The connector-level run all this connector's slices fold into. */
  runId: string
}

/**
 * Enqueue the next backfill slice for a stream's continuation chain. No fixed
 * `jobId` — slices within a chain run sequentially (each enqueues the next after it
 * completes) and the per-connector claim blocks a second chain, so dedup isn't
 * needed. `delayMs` paces a throttled re-enqueue (H1) so it doesn't immediately
 * re-hit the rate limit.
 */
export async function enqueueBackfillSlice(
  data: Omit<BackfillSliceJobData, 'type'>,
  opts: { delayMs?: number } = {}
): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  await queue.add(
    BACKFILL_SLICE_JOB,
    { type: BACKFILL_SLICE_JOB, ...data } satisfies BackfillSliceJobData,
    { delay: opts.delayMs && opts.delayMs > 0 ? opts.delayMs : undefined }
  )
}

/** BullMQ job name for one verified webhook delivery's sink work (Step 8A). */
export const CONNECTOR_WEBHOOK_JOB = 'data-connector-webhook'

/** Job payload for one verified webhook delivery — actions resolved in the receiver. */
export interface ConnectorWebhookJobData {
  type: typeof CONNECTOR_WEBHOOK_JOB
  connectorId: string
  organizationId: string
  /** Sink actions the connector's `resolveWebhook` produced from the delivery. */
  actions: WebhookAction[]
  /** Provider idempotency key (carried for tracing; receiver already deduped). */
  eventId: string
}

/**
 * Enqueue a webhook delivery's sink work. The receiver verifies + dedupes + resolves
 * the delivery synchronously and returns 200 fast (W2); the actual entity writes
 * happen here so a slow sink never makes the provider retry. No `jobId` — each
 * delivery is distinct and already deduped at the receiver.
 */
export async function enqueueConnectorWebhook(
  data: Omit<ConnectorWebhookJobData, 'type'>
): Promise<void> {
  const queue = getQueue(Queues.dataConnectorQueue)
  await queue.add(CONNECTOR_WEBHOOK_JOB, {
    type: CONNECTOR_WEBHOOK_JOB,
    ...data,
  } satisfies ConnectorWebhookJobData)
}

/**
 * Enqueue a connector sync. `jobId` coalesces duplicate manual "Sync now" clicks
 * for the same connector (BullMQ rejects ':' in custom ids — keep it hyphenated).
 */
export async function enqueueConnectorSync(data: {
  connectorId: string
  organizationId: string
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill'
}): Promise<void> {
  try {
    const queue = getQueue(Queues.dataConnectorQueue)
    await queue.add(
      'data-connector-sync',
      {
        type: 'data-connector-sync',
        connectorId: data.connectorId,
        organizationId: data.organizationId,
        trigger: data.trigger ?? 'manual',
      },
      { jobId: `data-connector-sync-manual-${data.connectorId}` }
    )
  } catch (error) {
    logger.error('Failed to enqueue data connector sync job', {
      data,
      error: error instanceof Error ? error.message : error,
    })
  }
}
