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
