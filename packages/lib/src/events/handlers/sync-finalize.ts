// packages/lib/src/events/handlers/sync-finalize.ts
//
// Phase 4 v1 of plans/events/03-write-context-and-batch-lane-plan.md: the sync
// finalize pass with COUNT-based lane selection (D-12). Invoked by
// `handle-sync-record-rules.ts` INSIDE its claimed branch, after rules fire —
// the manifest claim (`claimManifest`) is the at-most-once latch for this pass
// too, so a redelivered `sync:records:changed` that loses the claim skips both
// rules AND finalize. No new latch, no schema column.
//
// Doors executed here (per the door matrix in `resources/crud/door-matrix.ts`):
//   - `lastActivityAt` batch bump, both lanes (D-1)
//   - collapsed per-record timeline entries, both lanes (D-4 v1)
//   - per-record workflow/agent dispatch, SMALL lane only (D-2, fixes B-3);
//     the large lane withholds dispatch pending the Phase 6 guard (D-3)
//   - tier-2 `records:changed` delta frames, both lanes (plan §7b)
//
// v1 scope note: the changed-set is what the SUBSCRIPTION-GATED manifest
// captured (`sync-manifest-collector.ts` only records fields/lifecycles some
// enabled rule watches). Until the Phase 3 session collector captures every
// write, finalize fidelity is bounded by rule subscriptions — an org with no
// enabled rules produces no manifest and no finalize. Accepted for v1.
//
// Keep top-level imports to types/logger/pure constants only; lazy-import
// everything else (the events ↔ data-connectors ↔ cache boundaries break
// vi.mock otherwise — same rule as the two manifest consumers next door).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import { SYNC_SMALL_RUN_THRESHOLD } from '../../resources/crud/door-matrix'
import { EntityInstanceEventType, TimelineActorType } from '../../timeline/event-types'

const logger = createScopedLogger('sync-finalize')

/** One batched UPDATE per this many ids for the activity touch. */
const ACTIVITY_CHUNK_SIZE = 1000
/** One bulk INSERT per this many timeline rows. */
const TIMELINE_INSERT_CHUNK_SIZE = 500

export type SyncFinalizeLane = 'small' | 'large'

export interface SyncFinalizeInput {
  organizationId: string
  source: 'connector' | 'import'
  /** Run identity: DataConnectorRun id (connector) or ImportJob id (import). */
  ref: string
  /** Carried by the connector pointer event — saves a run-row hop for actor resolution. */
  dataConnectorId?: string
  manifest: SyncChangeManifest
}

/** The manifest's three record sets, deduped, with the created/changed overlap resolved. */
interface ChangedSets {
  /** Records with captured field changes that were NOT created this run. */
  updatedIds: RecordId[]
  createdIds: RecordId[]
  archivedIds: RecordId[]
  /** Distinct records across all three sets. */
  total: number
}

function collectChangedSets(manifest: SyncChangeManifest): ChangedSets {
  const createdSet = new Set<RecordId>(manifest.createdRecordIds)
  const archivedIds = [...new Set<RecordId>(manifest.archivedRecordIds)]
  // A record created this run also appears in `changes` (creates capture `{n}`
  // entries) — it collapses to ONE "created" entry, never created + updated.
  const updatedIds = (Object.keys(manifest.changes) as RecordId[]).filter(
    (rid) => !createdSet.has(rid)
  )
  const all = new Set<RecordId>([...updatedIds, ...createdSet, ...archivedIds])
  return { updatedIds, createdIds: [...createdSet], archivedIds, total: all.size }
}

/**
 * Lane selection (D-12): decided at finalize from the OBSERVED changed-set
 * count, never declared by the writer. A truncated manifest means the true
 * count is unknown-but-large, so it takes the large lane unconditionally.
 */
export function selectSyncLane(
  manifest: SyncChangeManifest,
  changedCount: number
): SyncFinalizeLane {
  if (manifest.truncated) return 'large'
  return changedCount <= SYNC_SMALL_RUN_THRESHOLD ? 'small' : 'large'
}

/**
 * Per-def distinct changed-record counts from a manifest — the real numbers for
 * the `run:completed` frame's `defCounts` (the publisher canonicalizes def
 * keys). Def ids come from the RecordId prefix, so they are in whatever
 * keyspace the producer wrote (slug for imports, CUID for connectors).
 */
export function manifestDefCounts(manifest: SyncChangeManifest): Record<string, number> {
  const byDef = new Map<string, Set<string>>()
  const add = (rid: RecordId) => {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
    let set = byDef.get(entityDefinitionId)
    if (!set) byDef.set(entityDefinitionId, (set = new Set()))
    set.add(entityInstanceId)
  }
  for (const rid of Object.keys(manifest.changes) as RecordId[]) add(rid)
  for (const rid of manifest.createdRecordIds) add(rid)
  for (const rid of manifest.archivedRecordIds) add(rid)
  const counts: Record<string, number> = {}
  for (const [defId, set] of byDef) counts[defId] = set.size
  return counts
}

/**
 * The sync finalize pass. NEVER throws — every door is individually guarded and
 * logged. The caller (`handle-sync-record-rules`) has already fired rules off
 * the claimed manifest; a finalize crash re-thrown into a BullMQ retry could
 * never re-claim, so failing loudly here would only lose the log context.
 */
export async function runSyncFinalize(db: Database, input: SyncFinalizeInput): Promise<void> {
  const { organizationId, source, ref, manifest } = input
  try {
    const sets = collectChangedSets(manifest)
    if (sets.total === 0) return

    const lane = selectSyncLane(manifest, sets.total)
    if (manifest.truncated) {
      logger.warn('sync finalize: manifest truncated — forcing large lane', {
        organizationId,
        source,
        ref,
        changed: sets.total,
      })
    }
    logger.info('sync finalize', { organizationId, source, ref, lane, changed: sets.total })

    // Actor: the same identity the run's writes carry today — the connector's
    // `createdById` / the import job's `createdById` (the crud handlers were
    // built with exactly this userId, falling back to 'system').
    const actorUserId = await resolveRunActorUserId(db, input)

    // Canonical def id per record — memoized per def. Import manifests carry
    // slug-keyed RecordIds (`ImportMapping.entityDefinitionId` is slug-keyed),
    // while timeline readers and realtime rooms use the org's EntityDefinition
    // CUID; canonicalizing here is the #1784 lesson applied to this producer.
    const canonicalDefId = await buildDefCanonicalizer(organizationId)

    // D-1: `lastActivityAt` bump for changed + created records, one batched
    // monotonic UPDATE per chunk. Archived records are excluded — archival is
    // not activity. No `updatedAt` pass is needed here: the D-7 write
    // chokepoint already stamped `updatedAt` for every real change at write
    // time (bookkeeping like this touch deliberately does not stamp it).
    await touchActivityDoor(db, organizationId, sets, { source, ref })

    // D-4 v1: one collapsed timeline entry per record per run, both lanes.
    // NOTE: small-lane per-field fidelity (matrix cell [R] — per-record
    // `entity:field:updated` replay) is a later upgrade; v1 ships the
    // collapsed shape for BOTH lanes.
    await timelineDoor(db, organizationId, manifest, sets, {
      source,
      ref,
      actorUserId,
      canonicalDefId,
    })

    // D-2: workflows/agents fire per-record on a SMALL run (incremental sync
    // is new activity — fixes B-3). The large lane withholds dispatch pending
    // the Phase 6 guarded dispatcher (D-3: tally + thresholded hold), and
    // deliberately computes nothing expensive here.
    if (lane === 'small') {
      await dispatchDoor(organizationId, sets, { actorUserId, canonicalDefId })
    } else {
      logger.info('sync finalize: workflow dispatch withheld on large lane (D-3)', {
        organizationId,
        source,
        ref,
        changed: sets.total,
        note: 'pending the Phase 6 guarded dispatcher',
      })
    }

    // §7b tier-2 delta frames, both lanes. The existing coarse
    // `records:invalidated` publishes at the producers stay untouched.
    await realtimeDoor(organizationId, manifest, sets, { canonicalDefId })
  } catch (error) {
    logger.error('sync finalize failed', {
      organizationId,
      source,
      ref,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Resolve the run's actor user id: connector → `DataConnector.createdById`
 * (via the run row when the event didn't carry the connector id), import →
 * `ImportJob.createdById`. Null means "no attributable user" → system actor.
 */
async function resolveRunActorUserId(
  db: Database,
  input: SyncFinalizeInput
): Promise<string | null> {
  try {
    const { schema } = await import('@auxx/database')
    const { eq } = await import('drizzle-orm')
    if (input.source === 'connector') {
      let connectorId = input.dataConnectorId
      if (!connectorId) {
        const run = await db.query.DataConnectorRun.findFirst({
          where: eq(schema.DataConnectorRun.id, input.ref),
          columns: { dataConnectorId: true },
        })
        connectorId = run?.dataConnectorId ?? undefined
      }
      if (!connectorId) return null
      const connector = await db.query.DataConnector.findFirst({
        where: eq(schema.DataConnector.id, connectorId),
        columns: { createdById: true },
      })
      return connector?.createdById ?? null
    }
    const job = await db.query.ImportJob.findFirst({
      where: eq(schema.ImportJob.id, input.ref),
      columns: { createdById: true },
    })
    return job?.createdById ?? null
  } catch (error) {
    logger.warn('sync finalize: actor resolution failed — using system actor', {
      source: input.source,
      ref: input.ref,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Memoizing canonicalizer for the RecordId def prefix (slug or CUID → org CUID). */
async function buildDefCanonicalizer(
  organizationId: string
): Promise<(defId: string) => Promise<string>> {
  const memo = new Map<string, Promise<string>>()
  const { canonicalizeEntityDefinitionId } = await import('../../cache')
  return (defId: string) => {
    let pending = memo.get(defId)
    if (!pending) {
      // Fall back to the raw id on a cache hiccup — degraded keyspace beats a throw.
      pending = canonicalizeEntityDefinitionId(organizationId, defId).catch(() => defId)
      memo.set(defId, pending)
    }
    return pending
  }
}

/** D-1: batched, monotonic `lastActivityAt` bump — reuses `touchEntityActivity`. */
async function touchActivityDoor(
  db: Database,
  organizationId: string,
  sets: ChangedSets,
  ctx: { source: string; ref: string }
): Promise<void> {
  try {
    const { touchEntityActivity } = await import('../../entity-instances/activity')
    const instanceIds = [...sets.updatedIds, ...sets.createdIds].map(
      (rid) => parseRecordId(rid).entityInstanceId
    )
    const at = new Date()
    for (let i = 0; i < instanceIds.length; i += ACTIVITY_CHUNK_SIZE) {
      await touchEntityActivity(
        instanceIds.slice(i, i + ACTIVITY_CHUNK_SIZE),
        organizationId,
        at,
        db
      )
    }
  } catch (error) {
    logger.error('sync finalize: activity touch failed', {
      organizationId,
      ...ctx,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * D-4 v1: bulk-insert collapsed per-record timeline entries. Rows match the
 * storage shape `@auxx/services/timeline` `createTimelineEvent` writes (the
 * single-entry helper is one INSERT + `.returning()` per row — looping it for
 * up to 15k manifest records is exactly the fan-out the batch lane exists to
 * avoid, so this is a chunked direct insert instead). No non-obvious
 * denormalizations exist on the table: `entityType`/`entityId` come from the
 * RecordId, everything else is literal columns.
 */
async function timelineDoor(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  sets: ChangedSets,
  ctx: {
    source: string
    ref: string
    actorUserId: string | null
    canonicalDefId: (defId: string) => Promise<string>
  }
): Promise<void> {
  try {
    const { schema } = await import('@auxx/database')
    const now = new Date()
    const actorType = ctx.actorUserId ? TimelineActorType.USER : TimelineActorType.SYSTEM
    const actorId = ctx.actorUserId ?? 'system'
    const syncMeta = { origin: 'sync', syncSource: ctx.source, syncRef: ctx.ref }

    type Row = typeof schema.TimelineEvent.$inferInsert
    const rows: Row[] = []
    const baseRow = async (rid: RecordId, eventType: string, extra: Record<string, unknown>) => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
      const canonical = await ctx.canonicalDefId(entityDefinitionId)
      rows.push({
        eventType,
        startedAt: now,
        entityType: canonical,
        entityId: entityInstanceId,
        actorType,
        actorId,
        eventData: { entityDefinitionId: canonical, ...syncMeta, ...extra },
        organizationId,
        updatedAt: now,
      })
    }

    for (const rid of sets.createdIds) {
      await baseRow(rid, EntityInstanceEventType.CREATED, {})
    }
    for (const rid of sets.updatedIds) {
      const changedFieldIds = Object.keys(manifest.changes[rid] ?? {})
      await baseRow(rid, EntityInstanceEventType.UPDATED, {
        changedFieldIds,
        changedFieldCount: changedFieldIds.length,
      })
    }
    for (const rid of sets.archivedIds) {
      await baseRow(rid, EntityInstanceEventType.ARCHIVED, {})
    }

    for (let i = 0; i < rows.length; i += TIMELINE_INSERT_CHUNK_SIZE) {
      await db.insert(schema.TimelineEvent).values(rows.slice(i, i + TIMELINE_INSERT_CHUNK_SIZE))
    }
  } catch (error) {
    logger.error('sync finalize: timeline insert failed', {
      organizationId,
      source: ctx.source,
      ref: ctx.ref,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * D-2 (small lane): per-record workflow + agent dispatch through the existing
 * combined CRUD door (`triggerResourceDispatch` memoizes the record fetch and
 * runs both dispatchers — passing a synthesized event and letting it fetch
 * `resourceData` itself is the supported shape). `entity:created` for created
 * records, `entity:updated` for changed ones; archived records are not
 * dispatched in v1 (`entity:deleted`-family sync firing is a later decision).
 * The dispatcher canonicalizes def ids itself (`resolveResourceTriggerMatch`),
 * but we hand it the canonical id so the synthesized payload matches what
 * modern-shape events carry.
 */
async function dispatchDoor(
  organizationId: string,
  sets: ChangedSets,
  ctx: { actorUserId: string | null; canonicalDefId: (defId: string) => Promise<string> }
): Promise<void> {
  try {
    const { triggerResourceDispatch } = await import('./trigger-resource-dispatch')
    const { toRecordId } = await import('@auxx/types/resource')
    const userId = ctx.actorUserId ?? 'system'

    const dispatchOne = async (rid: RecordId, type: 'entity:created' | 'entity:updated') => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
      const canonical = await ctx.canonicalDefId(entityDefinitionId)
      const event = {
        type,
        data: {
          recordId: toRecordId(canonical, entityInstanceId),
          entityDefinitionId: canonical,
          // The dispatchers never read the slug; carried for shape parity only.
          entitySlug: entityDefinitionId,
          organizationId,
          userId,
          eventData: {},
        },
      }
      try {
        await triggerResourceDispatch({ data: event as never })
      } catch (error) {
        logger.error('sync finalize: per-record dispatch failed', {
          organizationId,
          recordId: rid,
          type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    for (const rid of sets.createdIds) await dispatchOne(rid, 'entity:created')
    for (const rid of sets.updatedIds) await dispatchOne(rid, 'entity:updated')
  } catch (error) {
    logger.error('sync finalize: dispatch door failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * §7b tier-2 `records:changed` frames, grouped per canonical def. Changed
 * records carry their manifest field keys as `fieldIds`; created and archived
 * records ship without `fieldIds` ("any field may have changed") — a client
 * refetch of the id surfaces both a new row and a vanished one. Ids only,
 * never values (D-18); `publishRecordsChanged` chunks and canonicalizes the
 * room key itself.
 */
async function realtimeDoor(
  organizationId: string,
  manifest: SyncChangeManifest,
  sets: ChangedSets,
  ctx: { canonicalDefId: (defId: string) => Promise<string> }
): Promise<void> {
  try {
    const { getRealtimeService, publishRecordsChanged } = await import('../../realtime')
    const service = getRealtimeService()

    const byDef = new Map<string, Array<{ recordId: string; fieldIds?: string[] }>>()
    const add = async (rid: RecordId, fieldIds?: string[]) => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
      const canonical = await ctx.canonicalDefId(entityDefinitionId)
      let entries = byDef.get(canonical)
      if (!entries) byDef.set(canonical, (entries = []))
      entries.push(
        fieldIds && fieldIds.length > 0
          ? { recordId: entityInstanceId, fieldIds }
          : { recordId: entityInstanceId }
      )
    }

    for (const rid of sets.updatedIds) {
      await add(rid, Object.keys(manifest.changes[rid] ?? {}))
    }
    for (const rid of sets.createdIds) await add(rid)
    for (const rid of sets.archivedIds) await add(rid)

    for (const [entityDefinitionId, entries] of byDef) {
      await publishRecordsChanged(service, organizationId, { entityDefinitionId, entries })
    }
  } catch (error) {
    logger.error('sync finalize: records:changed publish failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
