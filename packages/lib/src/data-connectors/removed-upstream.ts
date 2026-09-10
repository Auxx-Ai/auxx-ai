// packages/lib/src/data-connectors/removed-upstream.ts
//
// Reads behind the connector page's "Gone upstream" list and the archive-cap banner
// (plans/data-connectors/v12/crawl-delete-reconciliation-fixes-plan.md, Phases 3c and
// 5). A `mark_deleted` orphan (or an `archive` orphan the mint degrade softened) is a
// `DataConnectorItem` with `removedUpstreamAt` set and the record still live; only the
// run's "Gone upstream" count used to say it existed. These reads let a human find the
// record and decide. Writes live in `removed-upstream-mutations.ts`.
//
// No permission checks here: the router asserts `connectors.manage`, and every query
// scopes by organization AND connector in SQL.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import type { ArchiveCapTripped, ConnectorReconcileState } from './types'

/** One flagged binding, with what the list needs to name and link its record. */
export interface RemovedUpstreamItem {
  id: string
  externalId: string
  entityDefinitionId: string
  entityInstanceId: string
  /** When the crawl flagged the upstream record gone. */
  removedUpstreamAt: Date
  /** The run whose crawl decided it; null for rows flagged before runs were stamped. */
  lastSeenRunId: string | null
  /** The bound record's stored display name, when it has one. */
  displayName: string | null
}

/**
 * The archive-cap stamp on a connector's `state`, or null. Pure: `getStatus` already
 * holds the row and must not re-query for one key. Kept next to the reads so the cast
 * from the untyped `state` jsonb happens in exactly one place.
 */
export function archiveCapTrippedOf(
  state: Record<string, unknown> | null | undefined
): ArchiveCapTripped | null {
  return (state as ConnectorReconcileState | null | undefined)?.archiveCapTripped ?? null
}

function flaggedItemColumns() {
  const I = schema.DataConnectorItem
  return {
    id: I.id,
    externalId: I.externalId,
    entityDefinitionId: I.entityDefinitionId,
    entityInstanceId: I.entityInstanceId,
    removedUpstreamAt: I.removedUpstreamAt,
    lastSeenRunId: I.lastSeenRunId,
    displayName: schema.EntityInstance.displayName,
  }
}

type FlaggedItemRow = {
  id: string
  externalId: string
  entityDefinitionId: string
  entityInstanceId: string | null
  removedUpstreamAt: Date | null
  lastSeenRunId: string | null
  displayName: string | null
}

/**
 * Only a BOUND item is ever flagged (reconcile diffs `entityInstanceId != null`), so a
 * row missing either value is not a "gone upstream" decision and is dropped rather than
 * shown with nothing to act on.
 */
function toRemovedUpstreamItem(row: FlaggedItemRow): RemovedUpstreamItem | null {
  if (!row.entityInstanceId || !row.removedUpstreamAt) return null
  return {
    id: row.id,
    externalId: row.externalId,
    entityDefinitionId: row.entityDefinitionId,
    entityInstanceId: row.entityInstanceId,
    removedUpstreamAt: row.removedUpstreamAt,
    lastSeenRunId: row.lastSeenRunId,
    displayName: row.displayName,
  }
}

function flaggedItemScope(organizationId: string, dataConnectorId: string) {
  const I = schema.DataConnectorItem
  // `archivedAt IS NULL`: an item the connector (or a human, through
  // `archiveRemovedUpstream`) already archived is decided; it must not be listed twice.
  return and(
    eq(I.organizationId, organizationId),
    eq(I.dataConnectorId, dataConnectorId),
    isNotNull(I.removedUpstreamAt),
    isNull(I.archivedAt),
    isNotNull(I.entityInstanceId)
  )
}

/**
 * Every flagged, still-live binding of one connector, newest flag first. One query
 * with a left join for the record's display name; the def label resolves from the
 * org cache on the client. Cannot fail short of a connection error, so it returns
 * the array rather than a `Result` with an empty failure set.
 */
export async function listRemovedUpstreamItems(
  db: Database,
  organizationId: string,
  dataConnectorId: string
): Promise<RemovedUpstreamItem[]> {
  const I = schema.DataConnectorItem
  const rows = await db
    .select(flaggedItemColumns())
    .from(I)
    .leftJoin(schema.EntityInstance, eq(schema.EntityInstance.id, I.entityInstanceId))
    .where(flaggedItemScope(organizationId, dataConnectorId))
    .orderBy(desc(I.removedUpstreamAt))
  const out: RemovedUpstreamItem[] = []
  for (const row of rows) {
    const item = toRemovedUpstreamItem(row)
    if (item) out.push(item)
  }
  return out
}

/**
 * One flagged binding by id, under the same scope as the list. The two row actions
 * (`archiveRemovedUpstream`, `keepRemovedUpstream`) load through this so an item that
 * belongs to another org or connector, was never flagged, or is already archived is a
 * 404 and not a write.
 */
export async function findRemovedUpstreamItem(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  itemId: string
): Promise<Result<RemovedUpstreamItem, NotFoundError>> {
  const I = schema.DataConnectorItem
  const rows = await db
    .select(flaggedItemColumns())
    .from(I)
    .leftJoin(schema.EntityInstance, eq(schema.EntityInstance.id, I.entityInstanceId))
    .where(and(eq(I.id, itemId), flaggedItemScope(organizationId, dataConnectorId)))
    .limit(1)
  const item = rows[0] ? toRemovedUpstreamItem(rows[0]) : null
  return item ? ok(item) : err(new NotFoundError('No record flagged as removed upstream here'))
}
