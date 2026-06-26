// packages/lib/src/data-connectors/realtime.ts
// Live connector-sync status over realtime (v2). One entry point —
// `publishConnectorSync` — reads the current connector + latest run + per-stream
// state and emits a `dataConnector:sync` snapshot so the detail view moves live
// instead of on the 4s `getStatus` poll. Centralized here (not scattered across
// the finalize sites) so every emitted payload matches exactly what `getStatus`
// would return.

import type { Database } from '@auxx/database'
import type { DataConnectorSyncEvent } from '../realtime/events'
import { getConnector, listRuns, listStreams } from './service'
import type { ConnectorStreamState } from './types'

/** Client routing hint — `progress` patches in place; lifecycle edges refetch. */
export type ConnectorSyncEventKind = DataConnectorSyncEvent['data']['kind']

/**
 * Min interval between `progress` emits per connector. A slice (one page) is
 * already coarse, but a backfill of thousands of tiny pages could fan out a lot
 * of frames — coalesce to ≤1 progress emit / interval. Lifecycle edges bypass it.
 */
const PROGRESS_MIN_INTERVAL_MS = 750
const lastProgressEmit = new Map<string, number>()

/**
 * Publish the connector's current sync status to its org channel. `progress` is
 * throttled per-connector; `run-started` / `run-finished` always emit (and reset
 * the throttle so a fast follow-up run's first progress isn't suppressed by a
 * stale timestamp). Fire-and-forget — never throws into the sync job.
 */
export async function publishConnectorSync(
  db: Database,
  organizationId: string,
  connectorId: string,
  kind: ConnectorSyncEventKind
): Promise<void> {
  if (kind === 'progress') {
    const now = Date.now()
    if (now - (lastProgressEmit.get(connectorId) ?? 0) < PROGRESS_MIN_INTERVAL_MS) return
    lastProgressEmit.set(connectorId, now)
  } else {
    lastProgressEmit.delete(connectorId)
  }

  // Wholly fire-and-forget: the snapshot read + publish must NEVER throw into a sync
  // run or webhook job — a realtime hiccup is not a sync failure. Callers `await` this
  // without their own try/catch, so the guarantee has to live here.
  try {
    const data = await buildSnapshot(db, organizationId, connectorId, kind)
    if (!data) return

    // Lazy-import the realtime barrel: a static import from a data-connectors module
    // creates a load-time cycle (realtime → publish-helpers → cache → …) that breaks
    // vi.mock interception in the connector smoke tests. Same pattern as
    // `connector-sync-source.emitRecordsInvalidated`.
    const { getRealtimeService, publishDataConnectorSync } = await import('../realtime')
    await publishDataConnectorSync(getRealtimeService(), organizationId, data)
  } catch {
    // swallowed — realtime is best-effort
  }
}

/**
 * Read the realtime-relevant subset of `getStatus` (connector lifecycle + latest
 * run + per-stream progress) into a `dataConnector:sync` payload. Mirrors the
 * `getStatus` router's aggregation so the client can patch its cache from this
 * frame without a refetch. Returns null when the connector is gone.
 */
async function buildSnapshot(
  db: Database,
  organizationId: string,
  connectorId: string,
  kind: ConnectorSyncEventKind
): Promise<DataConnectorSyncEvent['data'] | null> {
  const result = await getConnector(db, organizationId, connectorId)
  if (result.isErr()) return null
  const connector = result.value

  const [runs, streams] = await Promise.all([
    listRuns(db, organizationId, connectorId, 1),
    listStreams(db, organizationId, connectorId),
  ])
  const latest = runs[0] ?? null

  const perStream = streams.map((s) => {
    const st = (s.state ?? {}) as ConnectorStreamState
    return {
      streamKey: s.streamKey ?? '',
      recordsSeen: st.recordsSeen ?? 0,
      phase: st.phase ?? ('backfill' as const),
      done: st.phase === 'steady',
    }
  })
  const recordsSeen = perStream.reduce((n, s) => n + s.recordsSeen, 0)

  return {
    connectorId,
    kind,
    connectorStatus: connector.status,
    lastSyncedAt: connector.lastSyncedAt ? connector.lastSyncedAt.toISOString() : null,
    runId: latest?.id,
    runStatus: latest?.status,
    phase: (latest?.phase as 'backfill' | 'steady' | null) ?? null,
    trigger: latest?.trigger,
    recordsSeen,
    created: latest?.created ?? 0,
    updated: latest?.updated ?? 0,
    perStream,
  }
}
