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
import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
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
 * How many refused records the chain will carry before it gives up.
 *
 * The skip list rides in the job payload and is spread into a `NOT IN (…)`, so
 * it cannot grow without bound. A teardown that has been refused on this many
 * records is not going to finish by trying harder — it parks for a human.
 */
export const TEARDOWN_SKIP_CAP = 5_000

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
  limit: number,
  opts: { excludeArchived: boolean; skipInstanceIds: readonly string[] }
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
        isNotNull(mintedInstanceRef),
        // 🛑 THE TERMINATION CONDITION FOR `archive`, and its absence was an
        // infinite chain. A hard delete nulls both provenance columns via
        // `onDelete: set null`, so a deleted record leaves this set on its own
        // — which is the shrinking-set invariant the whole resumable design
        // rests on. An ARCHIVE nulls nothing: it stamps `archivedAt` and the row
        // stays bound. So slice N archived 2,000 records and slice N+1 re-read
        // the very same 2,000, archived none of them (`archiveEntityInstances`
        // returns only rows that were not already archived), and enqueued
        // another slice — forever, never finishing, never removing the
        // connector. Excluding archived rows here is what makes the archive set
        // shrink too.
        opts.excludeArchived ? isNull(schema.EntityInstance.archivedAt) : undefined,
        // Records a guard has already refused. Re-reading them would hand the
        // same batch to the same guard for the same answer — see
        // {@link TeardownSliceJobData.skipInstanceIds}.
        opts.skipInstanceIds.length > 0
          ? notInArray(schema.EntityInstance.id, [...opts.skipInstanceIds])
          : undefined
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

  const skipInstanceIds = data.skipInstanceIds ?? []

  const batch = await nextMintedRecords(db, organizationId, connectorId, TEARDOWN_SLICE_RECORDS, {
    // Only `archive` needs this. A `delete` must still hard-delete a record that
    // happens to be archived already.
    excludeArchived: behavior === 'archive',
    skipInstanceIds,
  })

  if (batch.length === 0) {
    if (skipInstanceIds.length > 0) {
      // Everything removable is gone and only refusals are left. The teardown is
      // OVER — it just did not get everything — so the connector stops being
      // `deleting` and becomes terminal, with the reasons still on `error`.
      // Leaving it `deleting` is what made this unrecoverable: the detail view
      // disables every action on that status, so there was no way to retry, fall
      // back to `archive`, or even give up.
      await parkFailedTeardown(db, connectorId, skipInstanceIds.length)
      logger.warn('Teardown stopped: records refused removal', {
        connectorId,
        behavior,
        refused: skipInstanceIds.length,
      })
      return { processed: 0, failed: skipInstanceIds.length, finished: false }
    }
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
  // `bulkDelete` reports failures by RecordId; the skip list is keyed by
  // instance id, and this is the map back without re-parsing.
  const instanceIdByRecordId = new Map(recordIds.map((recordId, i) => [recordId, batch[i]?.id]))

  let processed = 0
  let failed = 0
  /** Refusals from THIS slice, to be carried into the next one. */
  const newlyRefused: string[] = []

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

      for (const error of result.errors) {
        // 🛑 Only a DELIBERATE refusal is written off. `statusCode` is set when
        // the failure was an `AuxxError` — a pre-delete guard or a restrict
        // relationship, which will answer the same way however often it is
        // asked. An unexpected failure (`undefined`) is a deadlock, a timeout, a
        // blip: skipping it would quietly abandon a record the next slice might
        // well have removed, so it is left in the scan and retried.
        if (error.statusCode === undefined) continue
        const instanceId = instanceIdByRecordId.get(error.recordId)
        if (instanceId) newlyRefused.push(instanceId)
      }
    }
  }

  const nextSkipIds = [...new Set([...skipInstanceIds, ...newlyRefused])]

  if (nextSkipIds.length > TEARDOWN_SKIP_CAP) {
    await parkFailedTeardown(db, connectorId, nextSkipIds.length)
    logger.error('Teardown refused on too many records; stopping the chain', {
      connectorId,
      refused: nextSkipIds.length,
      cap: TEARDOWN_SKIP_CAP,
    })
    return { processed, failed, finished: false }
  }

  if (processed === 0 && newlyRefused.length === 0) {
    // 🛑 The slice moved NOTHING and learned nothing new to skip, so the next
    // slice would re-read this exact batch and do the same — the definition of
    // an endless chain. This deliberately covers more than the all-refused case
    // it replaces (`failed > 0 && processed === 0`): the archive loop reached
    // here with `failed === 0`, because a re-archive of already-archived rows
    // reports no error at all, and so sailed straight past the old guard.
    await parkFailedTeardown(db, connectorId, nextSkipIds.length || batch.length)
    logger.error('Teardown slice moved nothing; stopping the chain', {
      connectorId,
      behavior,
      batch: batch.length,
      failed,
    })
    return { processed, failed, finished: false }
  }

  await enqueueConnectorTeardown({ ...data, skipInstanceIds: nextSkipIds })
  logger.info('Teardown slice complete, next slice enqueued', {
    connectorId,
    behavior,
    processed,
    failed,
    skipped: nextSkipIds.length,
  })

  return { processed, failed, finished: false }
}

/**
 * End a teardown that cannot finish, in a state the operator can act on.
 *
 * `deleting` means "a chain is running and will remove this row"; once the chain
 * has stopped that is a lie, and an actively harmful one, because the UI treats
 * the status as a claim and disables every action against it. `delete_failed`
 * says the true thing: the teardown is over, it did not get everything, and the
 * next move is yours.
 *
 * The `error` column is left exactly as `recordTeardownFailures` wrote it — the
 * refusal reasons ARE the explanation, and this only prefixes the count so the
 * banner leads with the number.
 */
async function parkFailedTeardown(
  db: Database,
  connectorId: string,
  refused: number
): Promise<void> {
  const row = await db.query.DataConnector.findFirst({
    where: eq(schema.DataConnector.id, connectorId),
    columns: { error: true },
  })
  const detail = row?.error ? ` ${row.error}` : ''
  const summary =
    `Removal stopped with ${refused} record(s) still present.` +
    `${detail} Resolve the reason above and remove the connector again, ` +
    'or remove it keeping or archiving the remaining records.'

  const [row2] = await db
    .update(schema.DataConnector)
    .set({ status: 'delete_failed', error: summary.slice(0, 2_000), updatedAt: new Date() })
    .where(eq(schema.DataConnector.id, connectorId))
    .returning({ organizationId: schema.DataConnector.organizationId })

  // Nothing else will announce this. The teardown runs in a `quietSession`
  // precisely so it does not emit per-record frames, and the chain's normal
  // ending — the connector row disappearing — is its own signal. A PARKED
  // teardown has neither, so without this the list sits on `Removing` until the
  // operator happens to reload. `run-finished` is a lifecycle edge, which is the
  // kind the client refetches on, and the publish is fire-and-forget.
  if (row2?.organizationId) {
    const { publishConnectorSync } = await import('./realtime')
    await publishConnectorSync(db, row2.organizationId, connectorId, 'run-finished')
  }
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
