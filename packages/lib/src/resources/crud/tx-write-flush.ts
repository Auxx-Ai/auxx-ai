// packages/lib/src/resources/crud/tx-write-flush.ts

// Phase A of plans/events/04-in-transaction-write-semantics-plan.md (§6.5):
// replay a committed transaction's buffered doors, once, on the OUTER
// non-transactional handle.
//
// Everything this file drives beyond the leaf `publish-record-event` is
// LAZY-imported. That is deliberate, not stylistic: the flush's callers are
// composition sites (money's billing commands and gather flow) that already sit
// inside the org-cache / field-hooks import graph, and pulling `realtime`,
// `entity-instances` and `dedup` into their STATIC graph re-orders module
// evaluation across a cycle that runs through `@auxx/lib/cache` — which makes
// `findCachedResource` resolve to a half-initialised module. The flush runs once
// per committed transaction, so the dynamic-import cost is irrelevant, and this
// is the same dodge `loadManifestCollector` uses for the record-rules cycle.

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { publishRecordLifecycleEvent } from './publish-record-event'
import { assertTxWriteScopePure, type TxWriteCreate, type TxWriteScope } from './tx-write-scope'

const logger = createScopedLogger('tx-write-flush')

/**
 * RecordIds reach this buffer in two keyspaces — `handler.create` builds them
 * from the canonical `EntityDefinition.id`, while money's own writers build them
 * from the type slug (`toRecordId('invoice', …)`), and the two strings never
 * compare equal for the same record. Every membership test in the flush
 * therefore runs on the entity INSTANCE id, which is unique on its own.
 */
function instanceIdOf(recordId: RecordId): string {
  return parseRecordId(recordId).entityInstanceId
}

/**
 * Replay a committed scope's doors. Order and rationale per §6.5:
 *
 * 1. drop the buffered field changes of records that are themselves in
 *    `created` — those values are the record's initial state, not changes to it
 *    (T-1);
 * 2. drop creates whose declared `absorbInto` parent is also in `created` — the
 *    parent's `record:created` announces them (T-1b). An `absorbInto` naming a
 *    record that already existed is not an error: the child is a genuine create
 *    and stays;
 * 3. creates, in insertion order — the same fan-out the inline create path runs;
 * 4. the surviving (C2) field changes, per record;
 * 5. archives.
 *
 * Post-hooks are NEVER replayed (T-2): the composer already ran the ones that
 * matter, in-tx, in order, against transactional state.
 *
 * BEST-EFFORT (T-6). The transaction has committed; a failure here must never
 * surface as a command failure, so every step logs and continues — exactly what
 * `projectCommittedInvoice` already did for the billing projections.
 *
 * "Never" means never IN PRODUCTION, and the guard below is the whole body, not
 * just the per-step catches: acquiring the realtime module and its service can
 * throw too, and callers await this OUTSIDE their own try (there is nothing
 * useful they could do with the error anyway — the write is already durable).
 *
 * The one deliberate exception is {@link assertTxWriteScopePure}, which sits
 * outside the guard and is a no-op in production. A poisoned scope is a
 * programming error whose real failure mode — a post-commit write on a released
 * transaction handle — is SILENT, so in dev and test it must be loud enough to
 * stop the run.
 */
export async function flushTxWriteScope(scope: TxWriteScope): Promise<void> {
  assertTxWriteScopePure(scope)
  try {
    await replayTxWriteScope(scope)
  } catch (error) {
    logFailure('flush', scope.attemptId, error)
  }
  // AFTER the doors, and inside its own guard: a reconciler reads current truth,
  // so it must not run before the realtime/timeline replay that tells the rest of
  // the system the transaction landed — and its failure must not swallow theirs.
  try {
    if (scope.dirtyParents.size > 0) {
      const { drainDeferredDirtyParents } = await import('../../reconcilers/dirty-parents')
      await drainDeferredDirtyParents({
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        dirty: scope.dirtyParents,
      })
    }
  } catch (error) {
    logFailure('dirty-parents', scope.attemptId, error)
  }
  // Money's totals engine, which the buffered lane's hook suppression silently
  // switched off for the two entities the accounting guard wraps — see
  // `recomputeTotalsForCommittedWrite`. Its own guard for the same reason as above.
  try {
    await replayMoneyTotals(scope)
  } catch (error) {
    logFailure('money-totals', scope.attemptId, error)
  }
}

/**
 * Re-run the money totals engine for every record this scope touched.
 *
 * Reads only what the scope already buffered — `TxWriteCreate.values` is keyed by
 * `systemAttribute ?? fieldId` and `changes` by the same outputKey — so deciding whether a
 * write moved a total costs no query. The two buckets never overlap: T-1 keeps a created
 * record's own field writes out of `changes`.
 *
 * `runWithDirtyParents` is what makes a paste cheap: 20 created lines mark 20 dirty lines
 * and the drain on the way out rebuilds their document ONCE, rather than each
 * `markOrRecomputeLine` falling through to its inline branch and rebuilding it 20 times.
 */
async function replayMoneyTotals(scope: TxWriteScope): Promise<void> {
  // The overflow lane already degraded to `records:invalidated`; the buckets it would read
  // are partial, so a recompute driven off them would be arbitrary rather than wrong-ish.
  if (scope.truncated) return
  if (scope.created.length === 0 && Object.keys(scope.changes).length === 0) return

  const [{ recomputeTotalsForCommittedWrite }, { runWithDirtyParents }, { findCachedResource }] =
    await Promise.all([
      import('../../sales/totals/totals-hooks'),
      import('../../reconcilers/dirty-parents'),
      import('../../cache'),
    ])

  const touched = new Map<string, { entityType: string | null; attrs: Set<string> }>()
  const record = (instanceId: string, entityType: string | null, attrs: string[]): void => {
    const entry = touched.get(instanceId) ?? { entityType, attrs: new Set<string>() }
    for (const attr of attrs) entry.attrs.add(attr)
    touched.set(instanceId, entry)
  }

  for (const create of scope.created) {
    record(instanceIdOf(create.recordId), create.entityType, Object.keys(create.values))
  }

  for (const [recordId, changes] of Object.entries(scope.changes)) {
    // `findCachedResource`, not `getCachedResource`: a change's RecordId arrives in either
    // keyspace (§ the note on `instanceIdOf`), and only this one resolves a type slug.
    const { entityDefinitionId } = parseRecordId(recordId as RecordId)
    const resource = await findCachedResource(scope.organizationId, entityDefinitionId)
    record(instanceIdOf(recordId as RecordId), resource?.entityType ?? null, Object.keys(changes))
  }

  await runWithDirtyParents(scope.organizationId, scope.actorUserId, async () => {
    for (const [instanceId, entry] of touched) {
      try {
        await recomputeTotalsForCommittedWrite({
          organizationId: scope.organizationId,
          userId: scope.actorUserId,
          entityType: entry.entityType,
          instanceId,
          changedAttrs: [...entry.attrs],
        })
      } catch (error) {
        logFailure('money-totals', instanceId, error)
      }
    }
  })
}

async function replayTxWriteScope(scope: TxWriteScope): Promise<void> {
  const realtime = await import('../../realtime')
  const service = realtime.getRealtimeService()

  if (scope.truncated) {
    await flushTruncated(scope, realtime, service)
    return
  }

  const createdInstanceIds = new Set(scope.created.map((create) => instanceIdOf(create.recordId)))
  const changedRecordIds = Object.keys(scope.changes).filter(
    (recordId) => !createdInstanceIds.has(instanceIdOf(recordId as RecordId))
  )
  const creates = scope.created.filter(
    (create) => !create.absorbInto || !createdInstanceIds.has(instanceIdOf(create.absorbInto))
  )

  for (const create of creates) {
    try {
      await flushCreate(scope, create, realtime, service)
    } catch (error) {
      logFailure('create', create.recordId, error)
    }
  }

  for (const recordId of changedRecordIds) {
    const entries = scope.realtime[recordId as RecordId]
    if (!entries || entries.length === 0) continue
    await realtime
      .publishFieldValueUpdates(service, scope.organizationId, entries)
      .catch((error) => logFailure('change', recordId, error))
  }

  for (const archive of scope.archived) {
    try {
      publishRecordLifecycleEvent({
        recordId: archive.recordId,
        entityType: archive.entityType,
        entityDefinitionId: archive.entityDefinitionId,
        entitySlug: archive.entitySlug,
        action: 'deleted',
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        eventData: archive.eventData,
      })
      await service.publish(
        realtime.rooms.orgRecords(scope.organizationId, archive.entityDefinitionId),
        archive.realtimeEvent,
        { recordId: archive.recordId, entityDefinitionId: archive.entityDefinitionId }
      )
    } catch (error) {
      logFailure('archive', archive.recordId, error)
    }
  }
}

type RealtimeModule = typeof import('../../realtime')
type RealtimeService = ReturnType<RealtimeModule['getRealtimeService']>

/**
 * Overflow lane (T-5 rule 6). The buffer stopped growing, so a per-record replay
 * would announce a partial truth; tell every touched def to refetch instead.
 */
async function flushTruncated(
  scope: TxWriteScope,
  realtime: RealtimeModule,
  service: RealtimeService
): Promise<void> {
  const entityDefinitionIds = [
    ...new Set([
      ...scope.created.map((create) => create.entityDefinitionId),
      ...scope.archived.map((archive) => archive.entityDefinitionId),
      ...Object.keys(scope.changes).map(
        (recordId) => parseRecordId(recordId as RecordId).entityDefinitionId
      ),
    ]),
  ]
  await realtime
    .publishRecordsInvalidated(service, scope.organizationId, { entityDefinitionIds })
    .catch((error) => logFailure('truncated', entityDefinitionIds.join(','), error))
}

/** The inline create fan-out (`unified-handler-mutations` createEntity), post-commit. */
async function flushCreate(
  scope: TxWriteScope,
  create: TxWriteCreate,
  realtime: RealtimeModule,
  service: RealtimeService
): Promise<void> {
  const [{ findRelatedRecordId }, { getEntityInstance }, dedup] = await Promise.all([
    import('../events/extract-event-data'),
    import('../../entity-instances'),
    import('../../dedup/enqueue-scan'),
  ])

  publishRecordLifecycleEvent({
    recordId: create.recordId,
    entityType: create.entityType,
    entityDefinitionId: create.entityDefinitionId,
    entitySlug: create.entitySlug,
    action: 'created',
    organizationId: scope.organizationId,
    userId: scope.actorUserId,
    eventData: create.values,
    relatedRecordId: findRelatedRecordId(create.entityType, create.values),
  })

  // The composed instance was not captured — display name, avatar and
  // searchText are written by `setFieldValues` after the row exists, so the
  // frame re-reads them here on the outer handle (§6.3).
  const fresh = await getEntityInstance({
    id: instanceIdOf(create.recordId),
    organizationId: scope.organizationId,
  })
  if (fresh.isOk()) {
    const instance = fresh.value
    await service.publish(
      realtime.rooms.orgRecords(scope.organizationId, create.entityDefinitionId),
      'record:created',
      {
        entityDefinitionId: create.entityDefinitionId,
        record: {
          id: instance.id,
          recordId: create.recordId,
          displayName: instance.displayName,
          avatarUrl: instance.avatarUrl,
          secondaryDisplayValue: instance.secondaryDisplayValue,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt,
        },
      }
    )
  }

  await dedup.enqueueDuplicateScan(scope.organizationId, create.entityDefinitionId).catch(() => {})
}

function logFailure(step: string, recordId: string, error: unknown): void {
  logger.error('Transaction write flush step failed', {
    step,
    recordId,
    error: error instanceof Error ? error.message : String(error),
  })
}
