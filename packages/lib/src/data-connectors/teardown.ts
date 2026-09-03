// packages/lib/src/data-connectors/teardown.ts
// Removing a connector's synced records, as a resumable chain of short worker
// slices. See plans/records/bulk-delete-at-scale.md §7.
//
// Why this is not a loop inside the tRPC mutation, which is what it replaces:
// a real connector holds tens of thousands of minted records (23,265 on the org
// this was written for), and `deleteConnector` removed them inline, one at a
// time, inside one HTTP request. It could not finish, and a timeout mid-loop
// left the connector present with a partially deleted record set and no record
// of what had failed.
//
// The chain is modelled on `slice-orchestrator.ts`, which already turns a
// backfill into short crash-safe slices on this same queue.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { quietSession } from '../resources/crud/write-origin'
import { toRecordId } from '../resources/resource-id'
import { enqueueConnectorTeardown, type TeardownSliceJobData } from './data-connector-queue'

const logger = createScopedLogger('data-connector-teardown')

/**
 * Records removed per slice.
 *
 * The batched delete lane commits in chunks of 500, so this is four of them.
 * Sized to keep a slice's wall-clock far under the queue's `lockDuration` even
 * when the batch lands on a definition whose pre-delete guards force the
 * per-record lane — a guarded record costs roughly what it always did.
 */
export const TEARDOWN_SLICE_RECORDS = 2_000

/**
 * The instance a binding is responsible for removing, from EITHER provenance
 * column.
 *
 * There are two, and both have to be read:
 *
 * - `entityInstanceId` when `mintedInstance` is true — the live binding of a
 *   record this connector created.
 * - `mintedInstanceId` — the same fact after a `rebind` mapping edit cleared the
 *   binding. `applyMappingEditSafety` moves it there precisely so a settings
 *   change stops erasing it (it used to `delete` the row outright, stranding
 *   every record the connector had created on a shared definition).
 *
 * A record the connector merely ENRICHED has neither, and is never selected.
 *
 * ⚠️ This is also the resume cursor. `entityInstanceId` and `mintedInstanceId`
 * are both `onDelete: set null`, so a removed record nulls its own pointer and
 * drops out of the scan — the set shrinks as the chain runs, which is why a
 * crashed slice can simply re-read what is left with nothing checkpointed.
 */
const mintedInstanceRef = sql<string | null>`COALESCE(
  CASE WHEN ${schema.DataConnectorItem.mintedInstance}
    THEN ${schema.DataConnectorItem.entityInstanceId} END,
  ${schema.DataConnectorItem.mintedInstanceId}
)`

/** What one teardown slice did. */
export interface TeardownSliceOutcome {
  /** Records archived or deleted in this slice. */
  processed: number
  /** Records this slice could not remove — a guard refusal, or a failed chunk. */
  failed: number
  /** True when this was the last slice and the connector row is gone. */
  finished: boolean
}

/**
 * The minted, still-bound instance ids this connector is responsible for,
 * grouped by definition — the same selection `deleteConnector` has always used.
 *
 * `mintedInstance` is the sticky flag the sink sets when it CREATED a record. A
 * record the connector merely enriched (a pre-existing contact it matched on
 * email) is `false` and is never touched; its per-cell
 * `FieldValue.managedByConnectorId` markers null out via the FK when the
 * connector row finally goes.
 */
async function nextMintedRecords(
  db: Database,
  organizationId: string,
  connectorId: string,
  limit: number
): Promise<Array<{ id: string; defId: string }>> {
  return db
    .selectDistinct({
      id: schema.EntityInstance.id,
      defId: schema.EntityInstance.entityDefinitionId,
    })
    .from(schema.DataConnectorItem)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, mintedInstanceRef))
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.dataConnectorId, connectorId),
        // Both provenance columns are read, and reading only the first is the
        // bug this join exists to close — see {@link mintedInstanceRef}.
        isNotNull(mintedInstanceRef)
      )
    )
    .limit(limit)
}

/**
 * How many minted records a teardown would remove, per definition.
 *
 * For the confirm dialog: it names the definitions being destroyed but has
 * never said how many rows, which is the number that decides whether someone
 * wants to press the button.
 */
export async function countMintedRecords(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<Array<{ entityDefinitionId: string; count: number }>> {
  const rows = await db
    .select({
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      count: sql<number>`count(distinct ${schema.EntityInstance.id})::int`,
    })
    .from(schema.DataConnectorItem)
    // Same two-column selection the teardown itself uses — the confirm dialog
    // must not promise a number the chain then fails to match.
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, mintedInstanceRef))
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.dataConnectorId, connectorId)
      )
    )
    .groupBy(schema.EntityInstance.entityDefinitionId)

  return rows
}

/**
 * Run ONE teardown slice and continue the chain.
 *
 * A no-op when the connector is gone or no longer `deleting` — the status is the
 * claim, so a cancelled or already-finished teardown stops here rather than
 * racing a sibling.
 *
 * ⚠️ **The successor is enqueued AFTER the work, never before**, so a slice that
 * dies mid-batch is simply re-read by whatever runs next rather than skipped.
 *
 * 🛑 And it is enqueued WITHOUT a dedup id. The opening enqueue in
 * `deleteConnector` uses one to coalesce a double-click; reusing it here would
 * add nothing at all, because this handler is still active and still holding
 * that id, so the chain would run exactly one slice and park the connector in
 * `deleting` forever. See {@link enqueueConnectorTeardown}.
 */
export async function runConnectorTeardownSlice(
  db: Database,
  data: Omit<TeardownSliceJobData, 'type'>
): Promise<TeardownSliceOutcome> {
  const { connectorId, organizationId, userId, behavior } = data

  const connector = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, connectorId),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
    columns: { id: true, status: true },
  })
  if (!connector) {
    logger.info('Teardown slice: connector already gone, stopping', { connectorId })
    return { processed: 0, failed: 0, finished: true }
  }
  if (connector.status !== 'deleting') {
    logger.warn('Teardown slice: connector no longer deleting, stopping', {
      connectorId,
      status: connector.status,
    })
    return { processed: 0, failed: 0, finished: false }
  }

  const batch = await nextMintedRecords(db, organizationId, connectorId, TEARDOWN_SLICE_RECORDS)

  if (batch.length === 0) {
    // Nothing left to remove: tear down the schema (for `delete`) and drop the
    // connector row, which cascades its streams, mappings, items and runs.
    const { finalizeConnectorTeardown } = await import('./mutations')
    await finalizeConnectorTeardown(db, organizationId, userId, connectorId, behavior)
    logger.info('Teardown finished', { connectorId, behavior })
    return { processed: 0, failed: 0, finished: true }
  }

  // 🛑 A QUIET session, unlike the inline teardown this replaces. That one ran
  // as an ordinary interactive write and so published a bus event AND a realtime
  // frame per record — ~23k of each for one disconnect, where every bus event
  // becomes a job fanning out to timeline writers, record rules and workflow
  // triggers. A teardown needs none of it: the records are gone, and the record
  // lists the user is looking at are refreshed by the connector's own removal.
  const crud = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
    session: quietSession(`connector teardown (${behavior})`),
  })

  const recordIds = batch.map((row) => toRecordId(row.defId, row.id))
  let processed = 0
  let failed = 0

  if (behavior === 'archive') {
    const result = await crud.bulkArchive(recordIds)
    processed = result.count
    // `bulkArchive` reports no per-record errors; anything it could not archive
    // was already archived, which is not a failure.
  } else {
    const result = await crud.bulkDelete(recordIds)
    processed = result.count
    failed = result.errors.length
    if (result.errors.length > 0) {
      // 🛑 Recorded, not swallowed. The inline teardown discarded this result
      // entirely and still reported `{ success: true }`, so a `guardPartDelete`
      // refusal on a settled accounting period vanished without trace.
      await recordTeardownFailures(db, connectorId, result.errors)
    }
  }

  if (failed > 0 && processed === 0) {
    // Every record in the slice refused, so the next slice would re-read the
    // same rows and refuse them again — an endless chain. Stop and leave the
    // connector `deleting` with its error set, for a human to resolve.
    logger.error('Teardown slice removed nothing; stopping the chain', {
      connectorId,
      failed,
    })
    return { processed, failed, finished: false }
  }

  await enqueueConnectorTeardown(data)
  logger.info('Teardown slice complete, next slice enqueued', {
    connectorId,
    behavior,
    processed,
    failed,
  })

  return { processed, failed, finished: false }
}

/**
 * Park the reasons records could not be removed on the connector's `error`
 * column, where the detail view already shows it.
 *
 * Distinct messages only, and capped: a guard refusal is the same sentence for
 * every record it applies to ("This part has 3 stock movements in a settled
 * period"), and what the user needs is the reason, not 400 copies of it.
 */
async function recordTeardownFailures(
  db: Database,
  connectorId: string,
  errors: ReadonlyArray<{ message: string }>
): Promise<void> {
  const reasons = [...new Set(errors.map((e) => e.message))].slice(0, 5)
  const summary = `${errors.length} record(s) could not be removed. ${reasons.join(' ')}`
  await db
    .update(schema.DataConnector)
    .set({ error: summary.slice(0, 2_000), updatedAt: new Date() })
    .where(eq(schema.DataConnector.id, connectorId))
}
