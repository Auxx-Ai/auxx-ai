// packages/lib/src/data-connectors/reimport.ts
// see plans/data-connectors/v13/narrowed-fetch-plan.md §2 N5

import { randomUUID } from 'node:crypto'
import { type Database, schema } from '@auxx/database'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from '../errors'
import type { ConnectorRecordFilterCondition } from './connectors/types'
import { enqueueConnectorSync } from './data-connector-queue'
import {
  type ReimportKind,
  type ReimportRunOptions,
  validateReimportFilter,
} from './reimport-filter'
import { isConnectorClaimed, loadConnector, type StreamWithMappings } from './service'
import type { ConnectorStreamState } from './types'

export interface RequestReimportInput {
  organizationId: string
  connectorId: string
  streamIds: string[]
  recordFilter: ConnectorRecordFilterCondition[]
  initiatedBy?: string | null
}

export interface RequestReimportResult {
  /** `queued`: an `id` run waits for the running sync and starts when the claim frees. */
  status: 'started' | 'queued'
  kind: ReimportKind
  /** The run filter as it will be sent. */
  recordFilter: ConnectorRecordFilterCondition[]
  /** Lands on the run row as `progress.requestId` once the job opens it. */
  requestId: string
}

/**
 * Validate a re-import against N5's refusals and resolve its run options. Refuses a
 * non-app connector and a period run on a stream that never finished a backfill.
 */
async function planReimport(
  db: Database,
  input: RequestReimportInput
): Promise<Result<{ reimport: ReimportRunOptions; kind: ReimportKind }, Error>> {
  const validated = validateReimportFilter(input.recordFilter)
  if (validated.isErr()) return err(validated.error)
  const { kind } = validated.value

  const loaded = await loadConnector(db, input.organizationId, input.connectorId)
  if (!loaded) return err(new NotFoundError(`DataConnector not found: ${input.connectorId}`))
  const { connector } = loaded
  if (connector.definitionKind !== 'app') {
    return err(
      new BadRequestError(
        'Re-import needs an app connector. A generic REST connector can’t narrow its fetch.'
      )
    )
  }

  const streamIds = [...new Set(input.streamIds)]
  const streams: StreamWithMappings[] = []
  for (const id of streamIds) {
    const stream = loaded.streams.find((s) => s.stream.id === id)
    if (!stream) {
      return err(new NotFoundError(`Stream ${id} is not a mapped stream of this connector.`))
    }
    streams.push(stream)
  }

  if (kind === 'period') {
    const completed = await streamsWithCompletedBackfill(db, connector.id, streams)
    const pending = streams.find((s) => !completed.has(s.stream.id))
    if (pending) {
      return err(
        new UnprocessableEntityError(
          `Stream “${streamLabel(pending)}” hasn’t finished its first sync; ` +
            'its backfill will import this period.'
        )
      )
    }
  }

  return ok({
    reimport: {
      streamIds,
      recordFilter: validated.value.clauses,
      initiatedBy: input.initiatedBy ?? null,
    },
    kind,
  })
}

/**
 * Plan a re-import and enqueue it. A period run is refused while the connector is claimed;
 * an `id` run is enqueued anyway and waits for the claim (`status: 'queued'`).
 */
export async function requestReimport(
  db: Database,
  input: RequestReimportInput
): Promise<Result<RequestReimportResult, Error>> {
  const planned = await planReimport(db, input)
  if (planned.isErr()) return err(planned.error)
  const { kind } = planned.value
  const requestId = randomUUID()
  const reimport = { ...planned.value.reimport, requestId }

  const claimed = await isConnectorClaimed(db, input.connectorId)
  if (claimed && kind === 'period') {
    return err(
      new ConflictError('A sync is running on this connector. Re-import the period when it ends.')
    )
  }

  // Only an `id` run waits for the claim; a period run that loses the race is dropped with a log.
  await enqueueConnectorSync(
    {
      connectorId: input.connectorId,
      organizationId: input.organizationId,
      trigger: 'manual',
      reimport,
      ...(kind === 'id' ? { retryClaim: true as const } : {}),
    },
    // A unique key per request: two refreshes must never coalesce into one job.
    { jobKey: `reimport-${requestId}` }
  )
  return ok({
    status: claimed ? 'queued' : 'started',
    kind,
    recordFilter: reimport.recordFilter,
    requestId,
  })
}

/** Stream ids of `streams` that finished a real backfill: steady now, or done in a full run. */
async function streamsWithCompletedBackfill(
  db: Database,
  connectorId: string,
  streams: StreamWithMappings[]
): Promise<Set<string>> {
  const done = new Set<string>()
  const T = schema.DataConnectorRun
  for (const s of streams) {
    if ((s.stream.state as ConnectorStreamState | null)?.phase === 'steady') {
      done.add(s.stream.id)
      continue
    }
    // Sample and manual-pause parks also mark a stream finished; neither completed it.
    const [row] = await db
      .select({ id: T.id })
      .from(T)
      .where(
        and(
          eq(T.dataConnectorId, connectorId),
          ne(T.mode, 'reimport'),
          isNull(T.sampleLimit),
          sql`jsonb_exists(coalesce(${T.progress}->'finishedStreams', '[]'::jsonb), ${s.stream.id}::text)`,
          sql`coalesce(${T.progress}->'paused'->>'reason', '') <> 'manual'`
        )
      )
      .limit(1)
    if (row) done.add(s.stream.id)
  }
  return done
}

function streamLabel(s: StreamWithMappings): string {
  return s.stream.streamKey || s.stream.id
}
