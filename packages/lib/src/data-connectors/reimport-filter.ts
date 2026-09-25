// packages/lib/src/data-connectors/reimport-filter.ts
// see plans/data-connectors/v14/implementation-brief.md §3 (re-import API)

import { err, ok, type Result } from 'neverthrow'
import type { ConditionGroup } from '../conditions/types'
import { BadRequestError } from '../errors'
import type { ConnectorQuery } from './types'

/** An `id` run names at most this many records; a longer list is a period run. */
const MAX_REIMPORT_IDS = 50

/** `id` refreshes named records and may queue behind a sync; `period` re-reads a range. */
export type ReimportKind = 'period' | 'id'

/** What a user may ask a re-import for: named records, or a period. */
export type ReimportQuery = { ids: string[] } | { period: { from?: string; to?: string } }

/** What `startConnectorSync` needs to run a re-import; carried on the sync job. */
export interface ReimportRunOptions {
  streamIds: string[]
  query: ConnectorQuery
  initiatedBy?: string | null
  /** Stamped on the run's `progress.requestId` so the caller can find the run it asked for. */
  requestId?: string
}

/** A re-import query as it will be sent, and the kind of run it makes. */
export interface ValidatedReimportQuery {
  query: ConnectorQuery
  kind: ReimportKind
}

/** Validate a re-import query: 1–50 non-empty ids (deduped), or a period with at least one UTC ISO bound. */
export function validateReimportQuery(
  input: ReimportQuery
): Result<ValidatedReimportQuery, BadRequestError> {
  const hasIds = 'ids' in input && input.ids !== undefined
  const hasPeriod = 'period' in input && input.period !== undefined
  if (hasIds === hasPeriod) {
    return err(new BadRequestError('A re-import names either records or a period.'))
  }

  if ('ids' in input) {
    const ids = input.ids
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && id.trim())) {
      return err(new BadRequestError('Every id must be a non-empty string.'))
    }
    const unique = [...new Set(ids)]
    if (unique.length === 0 || unique.length > MAX_REIMPORT_IDS) {
      return err(new BadRequestError(`A refresh names between 1 and ${MAX_REIMPORT_IDS} records.`))
    }
    return ok({ query: { ids: unique }, kind: 'id' })
  }

  const period: { from?: string; to?: string } = {}
  for (const bound of ['from', 'to'] as const) {
    const value = input.period[bound]
    if (value === undefined) continue
    const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
    if (!Number.isFinite(ms)) {
      return err(new BadRequestError(`The period’s “${bound}” is not a valid date.`))
    }
    period[bound] = new Date(ms).toISOString()
  }
  if (!period.from && !period.to) {
    return err(new BadRequestError('A period needs a start, an end, or both.'))
  }
  if (period.from && period.to && period.from >= period.to) {
    return err(new BadRequestError('A period’s start must be before its end.'))
  }
  return ok({ query: { period }, kind: 'period' })
}

/** The period re-checked post-fetch on the stream's declared `period` path. */
export function periodFilterGroup(
  path: string,
  period: { from?: string; to?: string }
): ConditionGroup {
  return {
    id: 'reimport-period',
    logicalOperator: 'AND',
    conditions: [{ id: 'reimport-period-0', fieldId: path, operator: 'between', value: period }],
  }
}
