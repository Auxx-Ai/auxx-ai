// packages/lib/src/data-connectors/removed-upstream-mutations.ts
//
// The two human decisions crawl reconciliation cannot make on its own
// (plans/data-connectors/v12/crawl-delete-reconciliation-fixes-plan.md, Phases 3c and
// 5b): lift the archive cap once, and let a flagged record go on living as a record
// of its own. Reads live in `removed-upstream.ts`.
//
// `DataConnector.state` is a SHARED jsonb: the sync cursor and the backfill latch live
// in it. The override write therefore merges exactly ONE key with `jsonb_set` and never
// replaces the column. The reconcile pass consumes the key (lane A's
// `takeArchiveCapOverride`); nothing here clears it.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../errors'
import { archiveCapTrippedOf } from './removed-upstream'
import type { ArchiveCapOverride } from './types'

/**
 * Delete ONE `DataConnectorItem` row: the "Keep record" answer to a record flagged
 * gone upstream. Clearing the flag alone would be wrong, because the next crawl would
 * not see the record either and would flag it again. Unbinding says the upstream
 * record is gone and this record now lives on its own: it keeps every value and simply
 * stops being synced, updated or archived by the connector.
 */
export async function unbindItem(
  db: Database,
  organizationId: string,
  itemId: string
): Promise<Result<void, NotFoundError>> {
  const I = schema.DataConnectorItem
  const rows = await db
    .delete(I)
    .where(and(eq(I.id, itemId), eq(I.organizationId, organizationId)))
    .returning({ id: I.id })
  if (rows.length === 0) return err(new NotFoundError('Connector item not found'))
  return ok(undefined)
}

/**
 * Record a one-shot human confirmation that the next reconcile pass may archive past
 * the cap. Refuses with `BadRequestError` unless `archiveCapTripped` is on the
 * connector: with no refusal on record there is nothing to confirm, and a stray
 * override would lift the cap on some future, unrelated crawl. The UPDATE re-checks
 * the stamp in its WHERE so a clean pass finishing between the read and the write
 * cannot leave an override behind.
 */
export async function requestArchiveCapOverride(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  byUserId: string
): Promise<Result<ArchiveCapOverride, NotFoundError | BadRequestError>> {
  const T = schema.DataConnector
  const connector = await db.query.DataConnector.findFirst({
    where: and(eq(T.id, dataConnectorId), eq(T.organizationId, organizationId)),
    columns: { state: true },
  })
  if (!connector) return err(new NotFoundError(`DataConnector not found: ${dataConnectorId}`))
  const nothingToConfirm = new BadRequestError(
    'Nothing to confirm: the last sync did not refuse to archive any records.'
  )
  if (!archiveCapTrippedOf(connector.state)) return err(nothingToConfirm)

  const override: ArchiveCapOverride = { at: new Date().toISOString(), byUserId }
  const rows = await db
    .update(T)
    .set({
      state: sql`jsonb_set(coalesce(${T.state}, '{}'::jsonb), '{archiveCapOverride}', ${JSON.stringify(override)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(T.id, dataConnectorId),
        eq(T.organizationId, organizationId),
        sql`jsonb_exists(${T.state}, 'archiveCapTripped')`
      )
    )
    .returning({ id: T.id })
  if (rows.length === 0) return err(nothingToConfirm)
  return ok(override)
}
