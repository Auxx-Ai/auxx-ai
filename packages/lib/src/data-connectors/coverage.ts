// packages/lib/src/data-connectors/coverage.ts
// see plans/data-connectors/v15/history-window.md §3.5–§3.6

import { type Database, schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import type { ConnectorRecord } from './connectors/types'
import { getByPath } from './map-record'
import type { ConnectorQuery, ConnectorStreamState, DataConnectorConfig } from './types'

/** The config's history limit when it is a positive integer; anything else is no limit. */
export function historyMaxRecordsOf(config: DataConnectorConfig | null | undefined) {
  const n = config?.historyMaxRecords
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
}

/** A record's `period` value as UTC ISO, or undefined when absent or not a date. */
export function periodValueOf(record: ConnectorRecord, periodPath: string): string | undefined {
  const value = getByPath(record.fields, periodPath)
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

/**
 * Coverage after a period re-import finished: earlier when the period reaches back past
 * `current` and reads past it (`to` exclusive, so `to` must be later; absent = now), else
 * undefined (unchanged).
 */
export function extendedCoverage(
  current: string | null | undefined,
  period: ConnectorQuery['period']
): string | null | undefined {
  if (typeof current !== 'string' || !period) return undefined
  const cur = Date.parse(current)
  if (!Number.isFinite(cur)) return undefined
  if (period.to !== undefined && !(Date.parse(period.to) > cur)) return undefined
  if (period.from === undefined) return null
  return Date.parse(period.from) < cur ? period.from : undefined
}

/** Merge the coverage keys into a stream's state; a key passed as undefined/null is removed. */
export async function writeStreamCoverage(
  db: Database,
  streamId: string,
  input: { coverageFrom?: string | null; stoppedAtRecords?: number | null }
): Promise<void> {
  const T = schema.DataConnectorStream
  const { coverageFrom, stoppedAtRecords } = input
  const patch = {
    ...(coverageFrom !== undefined ? { coverageFrom } : {}),
    ...(stoppedAtRecords != null ? { stoppedAtRecords } : {}),
  }
  const drop = [
    ...(coverageFrom === undefined ? ['coverageFrom'] : []),
    ...(stoppedAtRecords == null ? ['stoppedAtRecords'] : []),
  ]
  await db
    .update(T)
    .set({
      // `drop` holds only the constant key names above, so the raw array literal is safe.
      state: sql`(coalesce(${T.state}, '{}'::jsonb) - ${sql.raw(`'{${drop.join(',')}}'`)}::text[]) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(T.id, streamId))
}

/** After a period re-import finished, move the stream's coverage earlier when it reached past it. */
export async function extendStreamCoverage(
  db: Database,
  streamId: string,
  period: ConnectorQuery['period']
): Promise<void> {
  const row = await db.query.DataConnectorStream.findFirst({
    where: eq(schema.DataConnectorStream.id, streamId),
    columns: { state: true },
  })
  const state = (row?.state as ConnectorStreamState | null) ?? {}
  const next = extendedCoverage(state.coverageFrom, period)
  if (next === undefined) return
  await writeStreamCoverage(db, streamId, {
    coverageFrom: next,
    stoppedAtRecords: state.stoppedAtRecords,
  })
}

/** Record on the run that the history limit ended `streamId`'s backfill (`progress.stopped`). */
export async function markRunStreamStopped(
  db: Database,
  runId: string,
  streamId: string,
  atRecords: number
): Promise<void> {
  const T = schema.DataConnectorRun
  const entry = JSON.stringify({ reason: 'limit', atRecords })
  await db
    .update(T)
    .set({
      progress: sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), '{stopped}', coalesce(${T.progress}->'stopped', '{}'::jsonb) || jsonb_build_object(${streamId}::text, ${entry}::jsonb), true)`,
    })
    .where(eq(T.id, runId))
}
