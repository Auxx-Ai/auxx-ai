// packages/lib/src/data-connectors/reconciliation.ts
// Orphan reconciliation + explicit deletes (04 §4, REVISED v12).
//
// Orphan reconciliation is the CRAWL-BASED delete channel: an item row whose
// lastSeenRunId is not one of the runs of the stream's current backfill (a crawl
// parked at the ingest ceiling resumes across runs) is an orphan → archiveRecord.
// It is what makes deletes self-healing, because a webhook that was never
// delivered is never redelivered, while every crawl re-answers the question.
//
// Three gates decide whether a mapping participates, and each one means something
// different (v12 §2):
//
//  • `syncMode === 'snapshot'` — absence only means deletion when the fetch saw
//    EVERYTHING. An incremental stream sees a delta, so absence there means
//    "unchanged", and it never reconciles. This gate is not negotiable; the
//    deferred id-only reconcile crawl is what will relax it correctly.
//  • `linkMode === 'upsert'` — a reference mapping writes nothing, so it owns
//    nothing to archive.
//  • `orphanBehavior !== 'ignore'` — the mapping must ASK. This replaced the old
//    owned-only rule: an explicit per-mapping declaration is the consent that
//    check was standing in for, and it lets a contributing mapping (Shopify
//    products are contributing) opt in without opening every co-owned record to
//    archival by default. The default is still `'ignore'`.
//
// Two safety rules sit on top, and both exist because a COMPLETED crawl can still
// be wrong (a filtered query, a narrowed auth scope, an empty page reported as
// done — none of which trip `finalizeBackfill`'s completeness gating):
//
//  • {@link effectiveOrphanBehavior} refuses to ARCHIVE a record this connector
//    did not mint. Enriching someone else's contact is not authority to remove it.
//  • {@link ARCHIVE_CAP} refuses the whole pass when the orphan set is implausibly
//    large. It is the difference between "a product was deleted" and "the crawl
//    broke and we just archived the catalog".
//
// Explicit deletes (a webhook delete, a `deleted` tombstone) flow through
// archiveExternalId instead and are NOT subject to either: the upstream said so
// outright, which is a stronger signal than absence.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, eq, gte, notInArray } from 'drizzle-orm'
import { resolveConnectorFieldRef } from '../agents/bindings/resolve'
import { connectorFor } from './connectors'
import { buildWriteKeyToFieldId } from './field-id-resolver'
import { type DecodedMapping, findItem, type StreamWithMappings } from './service'
import { entitySink } from './sinks/entity-sink'
import type { SyncCtx } from './sinks/types'
import type { ConnectorStreamState, OrphanBehavior, SyncMode } from './types'

const logger = createScopedLogger('data-connector-reconciliation')

/**
 * The slice of a stream reconciliation needs: its sync mode + decoded mappings, plus
 * the run ids that count as "seen this backfill" (`listBackfillRunIds`). Absent ⇒
 * only the finalizing run counts, which is right for a crawl that ran in one run.
 */
type ReconcilableStream = {
  syncMode: SyncMode
  mappings: DecodedMapping[]
  seenRunIds?: ReadonlySet<string>
}

/**
 * The run ids a snapshot stream's orphan diff must treat as "seen": every run of the
 * connector started at or after the stream's `backfillStartedAt`. A snapshot crawl
 * parked at the ingest ceiling resumes from its cursor on the next trigger, so a
 * record read in run 1 keeps `lastSeenRunId = run 1` while the crawl completes in
 * run 2; keying the diff on run 2 alone would archive everything run 1 saw. The
 * marker is the run row's own `startedAt` (the orchestrator pins it from the run it
 * opens), so both sides of the comparison come from one clock. Runs of any kind
 * count (a webhook run that touched the item since the backfill began saw it alive).
 * Empty when the stream carries no marker (legacy state): the caller's own run id
 * still counts.
 */
export async function listBackfillRunIds(
  db: Database,
  input: { dataConnectorId: string; streamId: string }
): Promise<Set<string>> {
  const stream = await db.query.DataConnectorStream.findFirst({
    where: eq(schema.DataConnectorStream.id, input.streamId),
    columns: { state: true },
  })
  const since = (stream?.state as ConnectorStreamState | null)?.backfillStartedAt
  if (!since) return new Set()
  const runs = await db.query.DataConnectorRun.findMany({
    where: and(
      eq(schema.DataConnectorRun.dataConnectorId, input.dataConnectorId),
      gte(schema.DataConnectorRun.startedAt, new Date(since))
    ),
    columns: { id: true },
  })
  return new Set(runs.map((r) => r.id))
}

/**
 * Refuse-the-whole-pass thresholds for crawl-based archival (v12 §3, Phase 4).
 *
 * A crawl that completes but saw the wrong set of records passes every other safety
 * gate in the engine. These are what stand between that and an archived catalog:
 *
 *  • `absolute` — beyond this many disappearances, a human confirms. Full stop.
 *  • `fraction` + `floor` — a large PROPORTION is the signature of a broken crawl,
 *    but on a 10-record catalog a legitimate 3-record deletion is 30%, so the
 *    proportion rule only applies once the orphan set is big enough to mean
 *    something. Below the floor the blast radius is at most `floor - 1` records and
 *    un-archiving is possible, whereas tripping on every ordinary deletion would
 *    train people to ignore the alarm — which costs more than it saves.
 *  • `wipeFloor` — "the crawl returned NOTHING for this mapping" is a stronger smell
 *    than any proportion, and it is what a revoked auth scope or a silently filtered
 *    query actually looks like, so it trips below the floor too. It needs at least
 *    two bound records: with exactly one there is nothing that distinguishes a real
 *    deletion from an empty crawl, and refusing forever would mean a single-record
 *    mapping could never be reconciled at all.
 */
export const ARCHIVE_CAP = {
  absolute: 500,
  fraction: 0.2,
  floor: 25,
  wipeFloor: 2,
} as const

/** Would archiving this orphan set be implausible? Returns the reason, or null. */
export function archiveCapReason(orphans: number, bound: number): string | null {
  if (orphans === 0) return null
  if (orphans > ARCHIVE_CAP.absolute) {
    return `${orphans} records vanished from the crawl (cap ${ARCHIVE_CAP.absolute})`
  }
  if (bound >= ARCHIVE_CAP.wipeFloor && orphans === bound) {
    return `every bound record (${bound}) vanished from the crawl at once`
  }
  if (orphans >= ARCHIVE_CAP.floor && bound > 0 && orphans / bound > ARCHIVE_CAP.fraction) {
    const pct = Math.round((orphans / bound) * 100)
    return `${orphans} of ${bound} bound records (${pct}%) vanished from the crawl`
  }
  return null
}

/**
 * What this orphan should ACTUALLY get, given what the mapping asked for.
 *
 * A mapping declaring `archive` still only archives a record THIS connector minted.
 * A record it merely matched and enriched belongs to whoever made it — the mail
 * ingest, the CSV importer, a person — and the upstream going quiet is not authority
 * to remove it. That degrades to `mark_deleted`: the record stays live and flagged,
 * and a human decides. `mintedInstance` is the same sticky flag `deleteConnector`
 * already uses to answer exactly this question.
 */
export function effectiveOrphanBehavior(
  declared: OrphanBehavior,
  item: { mintedInstance: boolean }
): OrphanBehavior {
  if (declared !== 'archive') return declared
  return item.mintedInstance ? 'archive' : 'mark_deleted'
}

/** One mapping's collected orphan set, resolved but not yet written. */
type OrphanPlan = {
  mapping: DecodedMapping
  bound: number
  orphans: Array<Parameters<typeof entitySink.archiveRecord>[1] & { mintedInstance: boolean }>
}

/**
 * Archive (or flag) orphans for eligible mappings. `streams` carries each stream's
 * syncMode so we can gate snapshot-only. Accepts both the full `StreamWithMappings`
 * (single-shot) and the pinned snapshot shape (sliced chain); it reads only
 * `syncMode` + `mappings` (+ `seenRunIds`). An item is seen when its `lastSeenRunId`
 * is the finalizing run or any run in the stream's `seenRunIds`.
 *
 * Collects the whole plan BEFORE writing anything, because the cap is judged
 * connector-wide: a crawl that returned nothing must trip once for every mapping at
 * once, not archive the first mapping and then think better of the second.
 */
export async function reconcileOrphans(ctx: SyncCtx, streams: ReconcilableStream[]): Promise<void> {
  const plans: OrphanPlan[] = []
  let totalBound = 0
  let totalOrphans = 0

  for (const { syncMode, mappings, seenRunIds } of streams) {
    // Incremental: absence ≠ deletion — ALWAYS. Since v9 §3 a sweep runs incremental
    // streams as a watermark catch-up (they did NOT see every record), so the old
    // sweep override would mass-archive them. Deletes on incremental streams are
    // carried by delete webhooks; a stream that needs crawl-based delete detection
    // must be syncMode='snapshot'.
    if (syncMode !== 'snapshot') continue
    for (const mapping of mappings) {
      if (mapping.linkMode !== 'upsert') continue // reference mappings write nothing
      if (mapping.orphanBehavior === 'ignore') continue // the mapping has to ask (v12 D2)

      const items = await entitySink.listExistingItems(ctx, mapping)
      // Bindings that are still live and could actually be acted on. An item already
      // archived or already flagged has been dealt with; it stays absent forever, so
      // leaving it in would re-archive it on every crawl and permanently skew the cap.
      const actionable = items.filter(
        (i) => i.entityInstanceId != null && i.archivedAt == null && i.removedUpstreamAt == null
      )
      const orphans = actionable.filter((item) => {
        // Seen this run, or in an earlier run of the same (resumed) backfill.
        if (item.lastSeenRunId === ctx.runId) return false
        if (item.lastSeenRunId != null && seenRunIds?.has(item.lastSeenRunId)) return false
        return true
      })
      if (orphans.length === 0) continue
      totalBound += actionable.length
      totalOrphans += orphans.length
      plans.push({ mapping, bound: actionable.length, orphans })
    }
  }

  if (plans.length === 0) return

  // 🛑 The cap. Refuse the entire pass rather than archive an implausible set, and make
  // the run PARTIAL so it cannot read as a clean sync: an `errorSample` entry with no
  // `tier` is the engine-level error bucket, which is exactly what this is.
  const capped = archiveCapReason(totalOrphans, totalBound)
  if (capped) {
    logger.warn('orphan reconciliation refused by the archive cap — nothing archived', {
      connectorId: ctx.connector.id,
      runId: ctx.runId,
      orphans: totalOrphans,
      bound: totalBound,
      mappings: plans.length,
    })
    ctx.counters.errorSample.push({
      externalId: `connector:${ctx.connector.id}`,
      error:
        `Delete reconciliation refused: ${capped}. Nothing was archived. ` +
        'This usually means the crawl saw the wrong set of records (a narrowed auth ' +
        'scope, a filtered query, or an empty page reported as complete) rather than ' +
        'that the records were really deleted. Verify the source, then re-sync.',
    })
    return
  }

  for (const { mapping, orphans } of plans) {
    for (const item of orphans) {
      await entitySink.archiveRecord(
        ctx,
        item,
        effectiveOrphanBehavior(mapping.orphanBehavior, item)
      )
    }
  }
}

/**
 * Un-manage stale contributing markers (Field Lock & Provenance, Phase 2.6).
 *
 * The FK `set null` on `FieldValue.managedByConnectorId` covers connector
 * *deletion*. This pass covers the case the FK can't: a connector that still
 * exists but whose mapping no longer writes a field — its old `managedBy` marker
 * should be cleared so the cell stops showing "Synced by <connector>".
 *
 * For each target def this connector contributes to, we union the concrete
 * `CustomField.id`s it currently writes (across all its contributing mappings on
 * that def) and clear any marker the connector still holds on a field outside
 * that set. One bounded UPDATE per def — scoped by the connector marker itself,
 * so it doesn't enumerate instances. Owned mappings are skipped (their
 * provenance is the column-grain `CustomField.dataConnectorId`).
 *
 * Safety: a currently-mapped ref that fails to resolve (e.g. an unbound/expired
 * `@app:` connection at finalize time) marks the def's keep-set INCOMPLETE, and
 * we skip the clearing UPDATE for that def entirely. Otherwise a transient
 * resolution blip would drop the unresolved field from the keep-set and wipe its
 * valid marker — and, if every ref failed, clear EVERY marker for the connector
 * on that def. Un-managing a genuinely-dropped field still works: it's simply
 * absent from `fieldMappings`, so the remaining (resolvable) refs form the
 * keep-set and the dropped field's marker clears.
 */
export async function reconcileManagedMarkers(
  ctx: SyncCtx,
  streams: ReconcilableStream[]
): Promise<void> {
  const connectionId = ctx.connector.credentialId ?? undefined
  // Per target def: the concrete CustomField.id set this connector currently
  // writes, plus whether every currently-mapped ref resolved this run.
  const byDef = new Map<string, { keep: Set<string>; complete: boolean }>()

  for (const { mappings } of streams) {
    for (const mapping of mappings) {
      if (mapping.targetMode !== 'contributing') continue

      const keyToId = await buildWriteKeyToFieldId(ctx.orgId, mapping.entityDefinitionId)
      const entry = byDef.get(mapping.entityDefinitionId) ?? {
        keep: new Set<string>(),
        complete: true,
      }

      for (const fm of mapping.fieldMappings) {
        if (fm.targetFieldRef == null) continue // unassigned draft — not a managed field
        const resolved = await resolveConnectorFieldRef(
          fm.targetFieldRef as ResourceFieldId,
          ctx.orgId,
          connectionId
        )
        const id = resolved ? keyToId.get(getFieldId(resolved)) : undefined
        if (id) entry.keep.add(id)
        // A mapped ref we couldn't resolve to a concrete field — don't risk
        // clearing this def's markers on an incomplete view.
        else entry.complete = false
      }
      byDef.set(mapping.entityDefinitionId, entry)
    }
  }

  for (const [defId, { keep, complete }] of byDef) {
    if (!complete) {
      logger.info('skipping managed-marker un-manage — incomplete field resolution', {
        connectorId: ctx.connector.id,
        entityDefinitionId: defId,
      })
      continue
    }
    const keepIds = Array.from(keep)
    await ctx.db
      .update(schema.FieldValue)
      .set({ managedByConnectorId: null })
      .where(
        and(
          eq(schema.FieldValue.organizationId, ctx.orgId),
          eq(schema.FieldValue.managedByConnectorId, ctx.connector.id),
          eq(schema.FieldValue.entityDefinitionId, defId),
          // Empty set (all refs resolved, none mapped) ⇒ clear every marker.
          keepIds.length > 0 ? notInArray(schema.FieldValue.fieldId, keepIds) : undefined
        )
      )
  }
}

/**
 * Handle an explicit upstream delete signal. Resolves the (streamKey, externalId)
 * via the connector, finds every bound item for that external id across the
 * connector's mappings, and archives them.
 */
export async function handleConnectorDelete(
  ctx: SyncCtx,
  streams: StreamWithMappings[],
  event: unknown
): Promise<void> {
  const connector = connectorFor(ctx.connector.type, {
    db: ctx.db,
    organizationId: ctx.orgId,
    connector: {
      id: ctx.connector.id,
      type: ctx.connector.type,
      credentialId: ctx.connector.credentialId,
      appInstallationId: ctx.connector.appInstallationId,
    },
  })
  const resolved = connector.resolveDelete?.(event) ?? null
  if (!resolved) {
    logger.info('connector.resolveDelete returned null — ignoring delete event', {
      connectorId: ctx.connector.id,
    })
    return
  }

  const stream = streams.find((s) => s.stream.streamKey === resolved.streamKey)
  if (!stream) return
  await archiveExternalId(ctx, stream.mappings, resolved.externalId)
}

/**
 * Archive every item bound to one external id across a stream's mappings — the
 * shared core of an explicit upstream delete (webhook resolveDelete, Step 8A, or a
 * provider delete event). Archives regardless of target mode (the upstream said so);
 * `ignore` orphan behavior is upgraded to `archive`. Increments `counters.deleted`
 * per archived binding.
 */
export async function archiveExternalId(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  externalId: string
): Promise<void> {
  for (const mapping of mappings) {
    const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, externalId)
    if (!item) continue
    await entitySink.archiveRecord(
      ctx,
      {
        id: item.id,
        entityInstanceId: item.entityInstanceId,
        entityDefinitionId: item.entityDefinitionId,
      },
      mapping.orphanBehavior === 'ignore' ? 'archive' : mapping.orphanBehavior
    )
    ctx.counters.deleted += 1
  }
}
