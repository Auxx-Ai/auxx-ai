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
//   - timeline entries: per-field `entity:field:updated` rows on the SMALL
//     lane, collapsed per-record entries on the large lane (D-4)
//   - per-record workflow/agent dispatch, SMALL lane only (D-2, fixes B-3);
//     the large lane withholds dispatch pending the Phase 6 guard (D-3)
//   - tier-2 `records:changed` delta frames, both lanes (plan §7b)
//
// Manifest v2 (plan 07 §3): tier-1 membership (`touched` + lifecycle arrays)
// is UNCONDITIONAL — every sync-session change reaches finalize, rules or no
// rules. Tier-2 `deltas` stay rule-subscription-gated, so `{o, n}` detail is
// present only where some enabled rule watches the field. Truncation only ever
// drops detail, never membership: `detailTruncated` leaves the lane honest
// (membership is complete, the count is real), `membershipTruncated` forces
// the large lane. Per-record ids-only degradation (`touched[rid] === 1`)
// collapses that record's timeline entry and widens its integrity selection.
//
// Keep top-level imports to types/logger/pure constants only; lazy-import
// everything else (the events ↔ data-connectors ↔ cache boundaries break
// vi.mock otherwise — same rule as the two manifest consumers next door).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import type {
  ManifestFieldChange,
  SyncChangeManifest,
} from '../../record-rules/sync-manifest-types'
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

/** The manifest's three record sets, deduped, with the created/touched overlap resolved. */
interface ChangedSets {
  /** Touched records (tier-1 membership) that were NOT created this run. */
  updatedIds: RecordId[]
  createdIds: RecordId[]
  archivedIds: RecordId[]
  /** Distinct records across all three sets. */
  total: number
}

function collectChangedSets(manifest: SyncChangeManifest): ChangedSets {
  const createdSet = new Set<RecordId>(manifest.createdRecordIds)
  const archivedIds = [...new Set<RecordId>(manifest.archivedRecordIds)]
  // A record created this run also appears in `touched` (creates record their
  // written keys) — it collapses to ONE "created" entry, never created + updated.
  const updatedIds = (Object.keys(manifest.touched) as RecordId[]).filter(
    (rid) => !createdSet.has(rid)
  )
  const all = new Set<RecordId>([...updatedIds, ...createdSet, ...archivedIds])
  return { updatedIds, createdIds: [...createdSet], archivedIds, total: all.size }
}

/**
 * Lane selection (D-12): decided at finalize from the OBSERVED changed-set
 * count, never declared by the writer. Only MEMBERSHIP truncation forces the
 * large lane — the true count is then unknown-but-large. `detailTruncated`
 * alone means tier-2 deltas were capped while membership stayed complete, so
 * the observed count is honest and the count-based decision stands.
 */
export function selectSyncLane(
  manifest: SyncChangeManifest,
  changedCount: number
): SyncFinalizeLane {
  if (manifest.membershipTruncated) return 'large'
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
  for (const rid of Object.keys(manifest.touched) as RecordId[]) add(rid)
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
    if (manifest.membershipTruncated) {
      logger.warn('sync finalize: manifest MEMBERSHIP truncated — forcing large lane', {
        organizationId,
        source,
        ref,
        changed: sets.total,
      })
    } else if (manifest.detailTruncated) {
      logger.info(
        'sync finalize: manifest detail truncated — membership complete, lane stays count-based',
        { organizationId, source, ref, changed: sets.total }
      )
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

    // D-4: timeline entries. SMALL lane: per-field `entity:field:updated`
    // replay for changed records (matrix cell [R] — shipped), mirroring the
    // inline per-field row shape; created/archived stay collapsed. LARGE
    // lane: one collapsed `entity:updated` entry per record per run — that
    // IS decision D-4, not a pending upgrade.
    await timelineDoor(db, organizationId, manifest, sets, lane, {
      source,
      ref,
      actorUserId,
      canonicalDefId,
    })

    // B-1: data-integrity passes (totals recompute, address normalize +
    // geocode, phone geo), BOTH lanes — sync writes are silent at the handler
    // seam, so the inline integrity hooks never ran for them; this pass is
    // their compensation (matrix: integrityHooks batched at finalize). Runs
    // before dispatch so workflow runs and delta frames follow recomputed
    // data.
    await integrityDoor(db, organizationId, manifest, { source, ref })

    // D-2: workflows/agents fire per-record on a SMALL run (incremental sync
    // is new activity — fixes B-3). The large lane routes through the Phase 6
    // guarded dispatcher instead (D-3): tally always, auto-dispatch below
    // WORKFLOW_AUTO_DISPATCH_THRESHOLD per workflow, held for approval at or
    // above (D-13), surfaced through the `bulk-dispatch` approval kind (D-19).
    if (lane === 'small') {
      await dispatchDoor(organizationId, sets, { actorUserId, canonicalDefId })
    } else {
      await guardedDispatchDoor(db, organizationId, sets, {
        source,
        ref,
        actorUserId,
        canonicalDefId,
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

/** B-1: the integrity batch passes — the module guards each pass internally. */
async function integrityDoor(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  ctx: { source: string; ref: string }
): Promise<void> {
  try {
    const { runIntegrityPasses } = await import('./finalize-integrity-passes')
    await runIntegrityPasses(db, { organizationId, manifest })
  } catch (error) {
    logger.error('sync finalize: integrity passes failed', {
      organizationId,
      ...ctx,
      error: error instanceof Error ? error.message : String(error),
    })
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
 * D-4: bulk-insert timeline entries. Rows match the storage shape
 * `@auxx/services/timeline` `createTimelineEvent` writes (the single-entry
 * helper is one INSERT + `.returning()` per row — looping it for up to 15k
 * manifest records is exactly the fan-out the batch lane exists to avoid, so
 * this is a chunked direct insert instead). No non-obvious denormalizations
 * exist on the table: `entityType`/`entityId` come from the RecordId,
 * everything else is literal columns.
 *
 * Changed records on the SMALL lane get per-field `entity:field:updated`
 * rows (one per touched field key) instead of the collapsed `entity:updated`
 * entry — a run of ≤ SYNC_SMALL_RUN_THRESHOLD records × a handful of fields
 * keeps the bulk insert trivially bounded. The large lane keeps the
 * collapsed shape (that IS D-4), counting fields from the touched key list.
 * Created/archived records stay collapsed on both lanes, and so does a
 * record degraded to ids-only (`touched[rid] === 1` — its keys were shed
 * under the byte budget, so there is nothing to write per-field rows from).
 *
 * Honest deltas of the per-field rows vs the inline shape
 * (`mapFieldUpdated` in `create-timeline-event.ts`), all limited by what the
 * manifest carries (tier-1 `touched` keys; tier-2 `ManifestFieldChange` raw
 * `{o, n}` keyed by outputKey = systemAttribute ?? fieldId):
 * - `fieldId` / `relatedEntityId` / `changes[].field` hold the manifest
 *   outputKey — for system fields that is the attribute key, not the
 *   CustomField CUID, and never the display name the inline lane resolves.
 * - `fieldName`, `fieldType`, `entitySlug`, and the resolved
 *   `oldDisplay`/`newDisplay` snapshots are omitted, not fabricated — the
 *   manifest does not capture them. `changes[]` carries the raw
 *   `oldValue`/`newValue` pair ONLY when a tier-2 delta exists for the
 *   record+key (the existing "oldValue only when captured" contract,
 *   extended: values as a whole are tier-2); a tier-1-only row still names
 *   the field, with no value pair.
 * - `eventType` is `entity:field:updated` for every def (the inline lane
 *   maps contact/ticket to their prefixed variants) — consistent with the
 *   collapsed rows already using the `entity:*` family for all defs.
 */
async function timelineDoor(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  sets: ChangedSets,
  lane: SyncFinalizeLane,
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

    /** Small-lane per-field replay — see the honest-delta notes in the doc comment. */
    const fieldRows = async (
      rid: RecordId,
      touchedKeys: string[],
      deltas: Record<string, ManifestFieldChange>
    ) => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
      const canonical = await ctx.canonicalDefId(entityDefinitionId)
      const recordId = toRecordId(canonical, entityInstanceId)
      for (const fieldKey of touchedKeys) {
        // `{o, n}` detail only when a tier-2 delta was captured for this
        // record+key; a tier-1-only row names the field, with no value pair.
        const change = deltas[fieldKey]
        rows.push({
          eventType: EntityInstanceEventType.FIELD_UPDATED,
          startedAt: now,
          entityType: canonical,
          entityId: entityInstanceId,
          // Inline: relatedRecordId = toRecordId('custom_field', fieldId).
          relatedEntityType: 'custom_field',
          relatedEntityId: fieldKey,
          actorType,
          actorId,
          eventData: { recordId, entityDefinitionId: canonical, fieldId: fieldKey, ...syncMeta },
          changes: [
            change
              ? {
                  field: fieldKey,
                  ...('o' in change ? { oldValue: change.o } : {}),
                  newValue: change.n,
                }
              : { field: fieldKey },
          ],
          organizationId,
          updatedAt: now,
        })
      }
    }

    for (const rid of sets.createdIds) {
      await baseRow(rid, EntityInstanceEventType.CREATED, {})
    }
    for (const rid of sets.updatedIds) {
      const touched = manifest.touched[rid]
      if (touched === 1 || touched === undefined) {
        // Ids-only degradation — keys were shed under the byte budget, so the
        // collapsed entry is all that can honestly be written.
        await baseRow(rid, EntityInstanceEventType.UPDATED, {})
        continue
      }
      if (lane === 'small' && touched.length > 0) {
        await fieldRows(rid, touched, manifest.deltas[rid] ?? {})
      } else {
        await baseRow(rid, EntityInstanceEventType.UPDATED, {
          changedFieldIds: touched,
          changedFieldCount: touched.length,
        })
      }
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
 * D-3 (large lane): the Phase 6 guarded workflow dispatcher — tally always,
 * per-workflow threshold, held dispatches persisted on the run row and
 * surfaced as `bulk-dispatch` approval requests. `runGuardedWorkflowDispatch`
 * never throws, but the lazy import itself is guarded like every other door.
 */
async function guardedDispatchDoor(
  db: Database,
  organizationId: string,
  sets: ChangedSets,
  ctx: {
    source: 'connector' | 'import'
    ref: string
    actorUserId: string | null
    canonicalDefId: (defId: string) => Promise<string>
  }
): Promise<void> {
  try {
    const { runGuardedWorkflowDispatch } = await import('./sync-dispatch-guard')
    await runGuardedWorkflowDispatch(db, {
      organizationId,
      source: ctx.source,
      ref: ctx.ref,
      actorUserId: ctx.actorUserId,
      createdIds: sets.createdIds,
      updatedIds: sets.updatedIds,
      canonicalDefId: ctx.canonicalDefId,
    })
  } catch (error) {
    logger.error('sync finalize: guarded dispatch door failed', {
      organizationId,
      source: ctx.source,
      ref: ctx.ref,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * §7b tier-2 `records:changed` frames, grouped per canonical def. Changed
 * records carry their touched field keys as `fieldIds`; created, archived,
 * and ids-only-degraded records ship without `fieldIds` ("any field may have
 * changed") — a client refetch of the id surfaces both a new row and a
 * vanished one. Ids only, never values (D-18); `publishRecordsChanged`
 * chunks and canonicalizes the room key itself.
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
      const touched = manifest.touched[rid]
      await add(rid, touched === 1 || touched === undefined ? undefined : touched)
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
