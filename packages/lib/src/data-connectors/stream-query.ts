// packages/lib/src/data-connectors/stream-query.ts
// The one query builder for every fetch — see plans/data-connectors/v14/implementation-brief.md §3.

import type {
  ConnectorQuery,
  ConnectorStreamQueryDecl,
  StreamRequestConfig,
  SyncMode,
} from './types'

/** The slice of a pinned stream the query builder reads. */
export interface QueryableStream {
  /** The app catalog's declaration; absent on built-in streams. */
  query?: ConnectorStreamQueryDecl
  requestConfig?: StreamRequestConfig
}

/** Whether a history floor can bound the stream: an app `query.period` or a generic-REST `backfillWindow`. */
export function streamHasPeriod(stream: QueryableStream): boolean {
  return !!stream.query?.period || !!stream.requestConfig?.backfillWindow
}

/** A sync's query (backfill, steady, sweep): the floor on a period stream, plus `since` on a since stream. */
export function syncQuery(
  stream: QueryableStream,
  job: { floor?: string; since?: unknown }
): ConnectorQuery {
  return {
    ...(job.floor && streamHasPeriod(stream) ? { period: { from: job.floor } } : {}),
    ...(job.since !== undefined && stream.query?.since ? { since: job.since } : {}),
  }
}

/** `{}` asks for everything, so only its result says anything about absence. */
export function isUnboundedQuery(query: ConnectorQuery): boolean {
  return !query.ids?.length && !query.period && query.since === undefined
}

/** A stream that deltas on `since` runs incremental; every other stream is a snapshot. */
export function catalogSyncMode(query: ConnectorStreamQueryDecl | undefined): SyncMode {
  return query?.since ? 'incremental' : 'snapshot'
}

/** The capability a user-issued `query` needs that `decl` lacks, or null when the stream can run it. */
export function missingQueryCapability(
  decl: ConnectorStreamQueryDecl | undefined,
  query: ConnectorQuery
): 'ids' | 'period' | null {
  if (query.ids && !decl?.ids) return 'ids'
  if (query.period && !decl?.period) return 'period'
  return null
}
