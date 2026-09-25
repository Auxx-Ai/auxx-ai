// packages/lib/src/data-connectors/refresh-record-status.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { describeRecordRefresh, type RecordRefreshOutcome } from './refresh-outcome'

/** The outcome of the refresh `requestId` names; `waiting` until its job opens the run. */
export async function readRecordRefresh(
  db: Database,
  input: { organizationId: string; connectorId: string; requestId: string }
): Promise<RecordRefreshOutcome> {
  const R = schema.DataConnectorRun
  const [row] = await db
    .select({
      status: R.status,
      created: R.created,
      updated: R.updated,
      skipped: R.skipped,
      recordFilter: R.recordFilter,
      errorSample: R.errorSample,
      sourceName: schema.DataConnector.name,
    })
    .from(R)
    .innerJoin(schema.DataConnector, eq(schema.DataConnector.id, R.dataConnectorId))
    .where(
      and(
        eq(R.organizationId, input.organizationId),
        eq(R.dataConnectorId, input.connectorId),
        eq(R.mode, 'reimport'),
        sql`${R.progress}->>'requestId' = ${input.requestId}`
      )
    )
    .limit(1)
  return describeRecordRefresh(row ?? null, row?.sourceName ?? 'the source')
}
