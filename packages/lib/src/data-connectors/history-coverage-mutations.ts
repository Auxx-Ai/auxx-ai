// packages/lib/src/data-connectors/history-coverage-mutations.ts
// "Import missing history" — see plans/data-connectors/v15/history-window.md §4 D

import { type Database, schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, ConflictError } from '../errors'
import { enqueueConnectorSync } from './data-connector-queue'
import { coverageNeedsFrom, planHistoryImport } from './history-coverage-plan'
import {
  type CoverageConnector,
  loadCoverageConnectors,
  readCoverageCutover,
  toCoverageRow,
} from './history-coverage-queries'
import { getConnectorReadiness, READINESS_REASON } from './readiness'
import { requestReimport } from './reimport'
import { countConnectorItems, listStreams, stampResyncPending } from './service'

/** What the import did for one connector. */
export interface HistoryImportOutcome {
  connectorId: string
  name: string
  /** The `historyStartDate` written, when it moved. */
  historyStartDate?: string
  /** The period re-import: started, refused while a sync runs (`busy`), or refused with a reason. */
  reimport: 'started' | 'busy' | 'refused' | null
  syncQueued: boolean
  resyncStamped: boolean
  /** Streams whose first sync is still running; it reads to the new date on its own. */
  waiting: string[]
  /** Why nothing (or not everything) was started, in words a person can act on. */
  message?: string
}

/**
 * Move each short connector's `historyStartDate` back to the books start − 60 days and fill
 * the gap per stream. Not capped (D4). Refuses without active accounting, since nothing
 * says how far back is enough. Skips connectors that already reach back.
 */
export async function importMissingHistory(
  db: Database,
  organizationId: string,
  input: { connectorId?: string; userId: string | null }
): Promise<Result<HistoryImportOutcome[], Error>> {
  const cutoverStart = await readCoverageCutover(organizationId)
  const needsFrom = coverageNeedsFrom(cutoverStart)
  if (!needsFrom) {
    return err(new BadRequestError('Set up accounting first; it decides how far back is enough.'))
  }
  const items = await loadCoverageConnectors(db, organizationId, input.connectorId)
  const outcomes: HistoryImportOutcome[] = []
  for (const item of items) {
    if (toCoverageRow(item, cutoverStart, needsFrom).ok) continue
    outcomes.push(await importOne(db, organizationId, item, { needsFrom, cutoverStart, ...input }))
  }
  return ok(outcomes)
}

async function importOne(
  db: Database,
  organizationId: string,
  item: CoverageConnector,
  ctx: { needsFrom: string; cutoverStart: Date | null; userId: string | null }
): Promise<HistoryImportOutcome> {
  const { connector } = item
  const outcome: HistoryImportOutcome = {
    connectorId: connector.id,
    name: connector.name,
    reimport: null,
    syncQueued: false,
    resyncStamped: false,
    waiting: [],
  }
  const readiness = getConnectorReadiness(
    connector,
    await listStreams(db, organizationId, connector.id)
  )
  if (!readiness.canSync) {
    outcome.message = READINESS_REASON[readiness.problems[0] ?? 'no-endpoint']
    return outcome
  }

  const plan = planHistoryImport({
    needsFrom: ctx.needsFrom,
    historyStartDate: item.historyStartDate,
    cutoverStart: ctx.cutoverStart,
    streams: item.streams,
  })
  outcome.waiting = plan.waiting

  // Written in place, not through `updateConnector`: that stamps a full re-crawl of every
  // stream, which is exactly what the per-stream actions below avoid.
  if (plan.historyStartDate) {
    const T = schema.DataConnector
    await db
      .update(T)
      .set({
        config: sql`coalesce(${T.config}, '{}'::jsonb) || ${JSON.stringify({ historyStartDate: plan.historyStartDate })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(T.id, connector.id))
    outcome.historyStartDate = plan.historyStartDate
  }

  if (plan.resyncStreamIds.length > 0 && connector.lastSyncedAt) {
    await stampResyncPending(db, connector.id, {
      level: 'rebackfill',
      reasons: ['history'],
      streamIds: plan.resyncStreamIds,
      itemCount: await countConnectorItems(db, connector.id),
      at: new Date().toISOString(),
    })
    outcome.resyncStamped = true
  }

  if (plan.reimport) {
    const started = await requestReimport(db, {
      organizationId,
      connectorId: connector.id,
      streamIds: plan.reimport.streamIds,
      query: { period: plan.reimport.period },
      initiatedBy: ctx.userId,
    })
    if (started.isOk()) outcome.reimport = 'started'
    else {
      outcome.reimport = started.error instanceof ConflictError ? 'busy' : 'refused'
      outcome.message = started.error.message
    }
  }

  if (plan.syncNow) {
    // Waits for the claim, so it queues behind the re-import instead of being dropped.
    await enqueueConnectorSync(
      { connectorId: connector.id, organizationId, trigger: 'manual', retryClaim: true },
      { jobKey: `history-${Date.now()}` }
    )
    outcome.syncQueued = true
  }
  return outcome
}
