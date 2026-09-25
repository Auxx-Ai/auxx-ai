// packages/sdk/src/root/data-connectors/errors.ts

import type { ConnectorRecordFilterCondition } from './types.js'

/** Reserved `fieldId` for the record's external id, not a payload path. */
export const EXTERNAL_ID_FIELD = '$externalId'

/** Throw from `execute`, before any upstream call, for an `exact` clause the app cannot narrow on. */
export class UnpushableFilterError extends Error {
  readonly code = 'UNPUSHABLE_FILTER'

  constructor(streamKey: string, clause: ConnectorRecordFilterCondition, reason?: string) {
    super(
      `Stream "${streamKey}" cannot narrow on ${clause.fieldId} ${clause.operator} ${JSON.stringify(clause.value ?? null)}${reason ? `: ${reason}` : ''}`
    )
    this.name = 'UnpushableFilterError'
  }
}
