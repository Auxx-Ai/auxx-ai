// packages/lib/src/accounting/export/realtime.ts
// The Outbox's live signal: one `exportBatch:changed` frame per settled state (plan 93 §3 B1).

import type { ExportBatchEntity } from '@auxx/database'
import type { ExportBatchChangedEvent } from '../../realtime/events'

/** Publish a batch's new state. Never throws: a Pusher hiccup must not fail a send. */
export async function publishExportBatchState(
  organizationId: string,
  data: ExportBatchChangedEvent['data']
): Promise<void> {
  try {
    // Lazy: a static import of the realtime barrel creates a load-time cycle, as in `export/realtime.ts`.
    const { getRealtimeService, publishExportBatchChanged } = await import('../../realtime')
    await publishExportBatchChanged(getRealtimeService(), organizationId, data)
  } catch {
    // swallowed - realtime is best-effort
  }
}

/** The frame for a row as it now stands in the database. */
export function exportBatchFrame(
  batch: Pick<
    ExportBatchEntity,
    'id' | 'state' | 'providerObjectId' | 'failureClass' | 'lastError' | 'attempts'
  >,
  runId?: string
): ExportBatchChangedEvent['data'] {
  return {
    batchId: batch.id,
    state: batch.state,
    ...(runId ? { runId } : {}),
    providerObjectId: batch.providerObjectId ?? null,
    failureClass: batch.failureClass ?? null,
    lastError: batch.lastError ?? null,
    attempts: batch.attempts,
  }
}
