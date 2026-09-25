// packages/lib/src/data-connectors/reimport-filter.ts
// see plans/data-connectors/v13/narrowed-fetch-plan.md §2 N5

import { err, ok, type Result } from 'neverthrow'
import type { Condition, ConditionGroup } from '../conditions/types'
import { BadRequestError } from '../errors'
import type { ConnectorRecordFilterCondition } from './connectors/types'
import { EXTERNAL_ID_FIELD, toFetchClause } from './record-filter'

/** An `id` run carries at most this many external ids; a longer list is a period run. */
const MAX_REIMPORT_IDS = 50

/** `id` refreshes named records and may queue behind a sync; `period` re-reads a range. */
export type ReimportKind = 'period' | 'id'

/** What `startConnectorSync` needs to run a re-import; carried on the sync job. */
export interface ReimportRunOptions {
  streamIds: string[]
  recordFilter: ConnectorRecordFilterCondition[]
  initiatedBy?: string | null
  /** Stamped on the run's `progress.requestId` so the caller can find the run it asked for. */
  requestId?: string
}

/** A run filter's clauses, each `exact`, and the kind of run they make. */
export interface ValidatedReimportFilter {
  clauses: ConnectorRecordFilterCondition[]
  kind: ReimportKind
}

/** Validate a flat AND run filter; `$externalId` takes only `in` with 1–50 string ids. */
export function validateReimportFilter(
  filter: readonly ConnectorRecordFilterCondition[]
): Result<ValidatedReimportFilter, BadRequestError> {
  const clauses: ConnectorRecordFilterCondition[] = []
  for (const input of filter) {
    const result = toFetchClause(input)
    if ('reason' in result) {
      return err(
        new BadRequestError(`The clause “${input.fieldId} ${input.operator}” ${result.reason}.`)
      )
    }
    const { clause } = result
    if (clause.fieldId === EXTERNAL_ID_FIELD) {
      const ids = clause.value
      if (clause.operator !== 'in' || !Array.isArray(ids)) {
        return err(
          new BadRequestError(`“${EXTERNAL_ID_FIELD}” only takes “in” with a list of ids.`)
        )
      }
      if (ids.length === 0 || ids.length > MAX_REIMPORT_IDS) {
        return err(
          new BadRequestError(`A refresh names between 1 and ${MAX_REIMPORT_IDS} records.`)
        )
      }
      if (!ids.every((id) => typeof id === 'string' && id.trim())) {
        return err(
          new BadRequestError(`Every “${EXTERNAL_ID_FIELD}” id must be a non-empty string.`)
        )
      }
      clause.value = [...new Set(ids)]
    }
    clauses.push({ ...clause, exact: true })
  }

  const [only] = clauses
  const kind = clauses.length === 1 && only?.fieldId === EXTERNAL_ID_FIELD ? 'id' : 'period'
  return ok({ clauses, kind })
}

/** The run filter as one AND group, for the post-fetch check next to the stream's own groups. */
export function runFilterGroup(clauses: readonly ConnectorRecordFilterCondition[]): ConditionGroup {
  return {
    id: 'reimport-run-filter',
    logicalOperator: 'AND',
    conditions: clauses.map(
      (c, i): Condition => ({
        id: `reimport-${i}`,
        fieldId: c.fieldId,
        operator: c.operator as Condition['operator'],
        value: c.value,
      })
    ),
  }
}
