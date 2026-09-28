// packages/lib/src/data-connectors/first-import.ts

import { schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { type DbOrTx, loadConnector } from './service'
import type { ConnectorStreamState } from './types'

/** Run park reasons that leave an import unfinished (a manual pause does not). */
const IMPORT_PARK_REASONS = new Set(['sample', 'ingest-ceiling'])

/**
 * Pure: a sync still importing new data — some usable stream has never finished its
 * backfill, or the connector is parked at a sample/ceiling. `lastSyncedAt` can't say
 * this: a sample park or a failed partial first sync stamps it.
 */
export function isFirstImport(input: {
  pausedReason: string | null
  streamStates: ConnectorStreamState[]
}): boolean {
  if (input.pausedReason && IMPORT_PARK_REASONS.has(input.pausedReason)) return true
  // A re-crawl of a stream that finished a backfill before is not new data (v15 `backfilledBefore`).
  return input.streamStates.some((state) => state.phase !== 'steady' && !state.backfilledBefore)
}

/** Whether a manual sync of this connector would be a (resumed) first import. */
export async function readIsFirstImport(
  db: DbOrTx,
  organizationId: string,
  dataConnectorId: string
): Promise<boolean> {
  // loadConnector's streams are the ones a sync actually runs (enabled, with a targeted mapping).
  const loaded = await loadConnector(db, organizationId, dataConnectorId)
  if (!loaded) return false
  let pausedReason: string | null = null
  if (loaded.connector.status === 'paused') {
    const T = schema.DataConnectorRun
    const [run] = await db
      .select({ progress: T.progress })
      .from(T)
      .where(and(eq(T.dataConnectorId, dataConnectorId), eq(T.organizationId, organizationId)))
      .orderBy(desc(T.startedAt))
      .limit(1)
    const paused = (run?.progress as { paused?: { reason?: unknown } } | null)?.paused
    pausedReason = typeof paused?.reason === 'string' ? paused.reason : null
  }
  return isFirstImport({
    pausedReason,
    streamStates: loaded.streams.map((s) => (s.stream.state as ConnectorStreamState) ?? {}),
  })
}
