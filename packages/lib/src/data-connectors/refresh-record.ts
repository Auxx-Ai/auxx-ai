// packages/lib/src/data-connectors/refresh-record.ts
// see plans/data-connectors/v14/implementation-brief.md §3 (re-import API)

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../errors'
import { type RequestReimportResult, requestReimport } from './reimport'

export interface RecordRefreshItem {
  externalId: string
  streamId: string
}

export interface RequestRecordRefreshInput {
  organizationId: string
  connectorId: string
  entityInstanceId: string
  initiatedBy?: string | null
}

export interface RequestRecordRefreshResult extends RequestReimportResult {
  externalId: string
}

/**
 * The binding a refresh re-fetches: the record's live item under a ROOT mapping of
 * `connectorId`. A fan-out child's `externalId` is not the id its stream pages by, so a
 * record bound only as a child (a line item, an order's contact) is refused.
 */
export async function findRefreshItem(
  db: Database,
  input: Omit<RequestRecordRefreshInput, 'initiatedBy'>
): Promise<Result<RecordRefreshItem, Error>> {
  const I = schema.DataConnectorItem
  const M = schema.DataConnectorMapping
  const rows = await db
    .select({
      externalId: I.externalId,
      streamId: M.dataConnectorStreamId,
      isRoot: sql<boolean>`${M.parentMappingId} is null`,
    })
    .from(I)
    .innerJoin(M, eq(M.id, I.mappingId))
    .where(
      and(
        eq(I.organizationId, input.organizationId),
        eq(I.entityInstanceId, input.entityInstanceId),
        eq(I.dataConnectorId, input.connectorId),
        isNull(I.archivedAt)
      )
    )
    .orderBy(desc(I.lastSyncedAt))

  if (rows.length === 0) {
    return err(new NotFoundError('This record isn’t synced by that connector.'))
  }
  const root = rows.find((r) => r.isRoot)
  if (!root) {
    return err(
      new UnprocessableEntityError(
        'This record syncs as part of another record. Refresh that record instead.'
      )
    )
  }
  return ok({ externalId: root.externalId, streamId: root.streamId })
}

/**
 * The connector behind a record's source chip (app installation + connection), for a drawer
 * whose cells have not hydrated their `CellSyncInfo` yet.
 */
export async function findRecordConnectorBySource(
  db: Database,
  input: {
    organizationId: string
    entityInstanceId: string
    appInstallationId: string
    connectionId: string | null
  }
): Promise<Result<string, Error>> {
  const I = schema.DataConnectorItem
  const C = schema.DataConnector
  const [row] = await db
    .select({ connectorId: C.id })
    .from(I)
    .innerJoin(C, eq(C.id, I.dataConnectorId))
    .where(
      and(
        eq(I.organizationId, input.organizationId),
        eq(I.entityInstanceId, input.entityInstanceId),
        isNull(I.archivedAt),
        eq(C.appInstallationId, input.appInstallationId),
        ...(input.connectionId ? [eq(C.credentialId, input.connectionId)] : [])
      )
    )
    .limit(1)
  if (!row) return err(new NotFoundError('No connector syncs this record from that app.'))
  return ok(row.connectorId)
}

/** Refresh one record from its source: an `id` run of one id on the record's root stream. */
export async function requestRecordRefresh(
  db: Database,
  input: RequestRecordRefreshInput
): Promise<Result<RequestRecordRefreshResult, Error>> {
  const item = await findRefreshItem(db, input)
  if (item.isErr()) return err(item.error)
  const { externalId, streamId } = item.value

  const started = await requestReimport(db, {
    organizationId: input.organizationId,
    connectorId: input.connectorId,
    streamIds: [streamId],
    query: { ids: [externalId] },
    initiatedBy: input.initiatedBy ?? null,
  })
  if (started.isErr()) return err(started.error)
  return ok({ ...started.value, externalId })
}
