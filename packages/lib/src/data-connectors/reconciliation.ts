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
import {
  clearArchiveCapTripped,
  listMintedInstanceIds,
  setArchiveCapTripped,
  takeArchiveCapOverride,
} from './orphan-state'
import { type DecodedMapping, findItem, type StreamWithMappings } from './service'
import { entitySink } from './sinks/entity-sink'
import type { EntitySink, SyncCtx } from './sinks/types'
import type { ConnectorStreamState, OrphanBehavior, SyncMode } from './types'

const logger = createScopedLogger('data-connector-reconciliation')

/**
 * The slice of a stream reconciliation needs: its sync mode + decoded mappings, plus
 * the run ids that count as "seen this backfill" (`listBackfillRunIds`). Absent ⇒
 * only the finalizing run counts, which is right for a crawl that ran in one run.
 * `streamKey` (pinned snapshot shape) or `stream.streamKey` (full row) names the stream
 * in a wipe refusal, which is judged per stream.
 */
type ReconcilableStream = {
  syncMode: SyncMode
  mappings: DecodedMapping[]
  seenRunIds?: ReadonlySet<string>
  streamKey?: string
  stream?: { streamKey: string }
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
 *  • `wipeFloor` — "the crawl returned NOTHING for this stream" is a stronger smell
 *    than any proportion, and it is what a revoked auth scope or a silently filtered
 *    query actually looks like, so it trips below the floor too. It is judged PER
 *    STREAM and floored on the stream's ROOT mappings (v12.1 Phase 2): one upstream
 *    record fans out to several bindings (a Shopify product is a product, a part
 *    and its variants), so a connector-wide sum would read one deleted product as
 *    "every bound record vanished". It needs at least two root records gone: with
 *    exactly one there is nothing that distinguishes a real deletion from an empty
 *    crawl, and refusing forever would mean a single-record store could never be
 *    reconciled at all.
 *
 * `absolute` and `fraction` are judged CONNECTOR-WIDE, with `bound` counted over
 * every eligible mapping including the ones with no orphans; a crawl that returned
 * nothing must trip once for everything, not archive the first mapping and then think
 * better of the second.
 */
export const ARCHIVE_CAP = {
  absolute: 500,
  fraction: 0.2,
  floor: 25,
  wipeFloor: 2,
} as const

/**
 * Connector-wide rules: would archiving this many orphans out of this many bound
 * records be implausible? Returns the reason, or null.
 */
export function capReason(counts: { orphans: number; bound: number }): string | null {
  const { orphans, bound } = counts
  if (orphans === 0) return null
  if (orphans > ARCHIVE_CAP.absolute) {
    return `${orphans} records vanished from the crawl (cap ${ARCHIVE_CAP.absolute})`
  }
  if (orphans >= ARCHIVE_CAP.floor && bound > 0 && orphans / bound > ARCHIVE_CAP.fraction) {
    const pct = Math.round((orphans / bound) * 100)
    return `${orphans} of ${bound} bound records (${pct}%) vanished from the crawl`
  }
  return null
}

/**
 * Per-stream wipe rule: did EVERY actionable record of the stream vanish at once, with
 * at least `wipeFloor` of them on the stream's root mappings? Returns the reason, or
 * null. `rootOrphans` is the orphan count over mappings with no `parentMappingId`.
 */
export function wipeReason(counts: {
  bound: number
  orphans: number
  rootOrphans: number
}): string | null {
  const { bound, orphans, rootOrphans } = counts
  if (orphans === 0) return null
  if (orphans === bound && rootOrphans >= ARCHIVE_CAP.wipeFloor) {
    return `every bound record (${bound}) vanished from the crawl at once`
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

type ExistingItem = Awaited<ReturnType<EntitySink['listExistingItems']>>[number]

/**
 * One mapping's collected orphan set, resolved but not yet written. `orphans` are the
 * fresh disappearances the cap is judged on; `flagged` are orphans an earlier pass
 * already stamped `removedUpstreamAt`, kept out of the arithmetic and never re-flagged,
 * but archived after the cap when their behavior now resolves to `archive` (a policy
 * flip from `mark_deleted`, or a mint answer that changed).
 */
type OrphanPlan = {
  mapping: DecodedMapping
  orphans: ExistingItem[]
  flagged: ExistingItem[]
}

/** One stream's plan, with the counts the per-stream wipe rule is judged on. */
type StreamPlan = {
  label: string
  bound: number
  orphans: number
  rootOrphans: number
  plans: OrphanPlan[]
}

/**
 * Archive (or flag) orphans for eligible mappings. `streams` carries each stream's
 * syncMode so we can gate snapshot-only. Accepts both the full `StreamWithMappings`
 * (single-shot) and the pinned snapshot shape (sliced chain); it reads only
 * `syncMode` + `mappings` (+ `seenRunIds`, + the stream key for messages). An item is
 * seen when its `lastSeenRunId` is the finalizing run or any run in the stream's
 * `seenRunIds`.
 *
 * Collects the whole plan BEFORE writing anything, because any trip refuses the whole
 * pass: a crawl that returned nothing must trip once for every mapping at once, not
 * archive the first mapping and then think better of the second. A trip stamps
 * `archiveCapTripped` on the connector; a pass that did not trip clears it (Phase 3a).
 * A one-shot `archiveCapOverride` lifts the cap for exactly this pass and is consumed
 * whether or not anything is archived; it does NOT lift the mint degrade, because a
 * human confirming a deletion is not authority to archive a record the connector did
 * not create (Phase 3b).
 */
export async function reconcileOrphans(ctx: SyncCtx, streams: ReconcilableStream[]): Promise<void> {
  // Consumed by THIS pass, even one that finds nothing: it never lingers across runs.
  const override = await takeArchiveCapOverride(ctx.db, ctx.connector.id)

  const streamPlans: StreamPlan[] = []
  let totalBound = 0
  let totalOrphans = 0

  for (const [index, stream] of streams.entries()) {
    // Incremental: absence ≠ deletion — ALWAYS. Since v9 §3 a sweep runs incremental
    // streams as a watermark catch-up (they did NOT see every record), so the old
    // sweep override would mass-archive them. Deletes on incremental streams are
    // carried by delete webhooks; a stream that needs crawl-based delete detection
    // must be syncMode='snapshot'.
    if (stream.syncMode !== 'snapshot') continue
    const plan: StreamPlan = {
      label: stream.streamKey ?? stream.stream?.streamKey ?? `#${index + 1}`,
      bound: 0,
      orphans: 0,
      rootOrphans: 0,
      plans: [],
    }
    for (const mapping of stream.mappings) {
      if (mapping.linkMode !== 'upsert') continue // reference mappings write nothing
      if (mapping.orphanBehavior === 'ignore') continue // the mapping has to ask (v12 D2)

      const items = await entitySink.listExistingItems(ctx, mapping)
      // Bindings that are still live and could actually be acted on. An item already
      // archived has been dealt with for good; it stays absent forever, so leaving it
      // in would re-archive it on every crawl and permanently skew the cap.
      const actionable = items.filter((i) => i.entityInstanceId != null && i.archivedAt == null)
      const unseen = actionable.filter((item) => {
        // Seen this run, or in an earlier run of the same (resumed) backfill.
        if (item.lastSeenRunId === ctx.runId) return false
        if (item.lastSeenRunId != null && stream.seenRunIds?.has(item.lastSeenRunId)) return false
        return true
      })
      // An item already flagged gone upstream is outside the cap arithmetic on both
      // sides: it is not a fresh disappearance, and it must not pad `bound` either.
      const orphans = unseen.filter((i) => i.removedUpstreamAt == null)
      const flagged = unseen.filter((i) => i.removedUpstreamAt != null)
      // `bound` counts every eligible mapping, including one with no orphans at all:
      // the proportion rule is "of everything this connector holds", not "of the
      // mappings that happened to lose something".
      plan.bound += actionable.filter((i) => i.removedUpstreamAt == null).length
      plan.orphans += orphans.length
      if (mapping.parentMappingId == null) plan.rootOrphans += orphans.length
      if (orphans.length === 0 && flagged.length === 0) continue
      plan.plans.push({ mapping, orphans, flagged })
    }
    totalBound += plan.bound
    totalOrphans += plan.orphans
    if (plan.plans.length > 0) streamPlans.push(plan)
  }

  // 🛑 The cap. Refuse the entire pass rather than archive an implausible set, and make
  // the run PARTIAL so it cannot read as a clean sync: an `errorSample` entry with no
  // `tier` is the engine-level error bucket, which is exactly what this is.
  const refused =
    capReason({ orphans: totalOrphans, bound: totalBound }) ?? wipeRefusal(streamPlans)
  if (override) {
    logger.info('orphan reconciliation running under a one-shot archive-cap override', {
      connectorId: ctx.connector.id,
      runId: ctx.runId,
      orphans: totalOrphans,
      bound: totalBound,
      lifted: refused,
      byUserId: override.byUserId,
      confirmedAt: override.at,
    })
  }
  if (refused && !override) {
    logger.warn('orphan reconciliation refused by the archive cap — nothing archived', {
      connectorId: ctx.connector.id,
      runId: ctx.runId,
      orphans: totalOrphans,
      bound: totalBound,
      mappings: streamPlans.reduce((n, s) => n + s.plans.length, 0),
    })
    ctx.counters.errorSample.push({
      externalId: `connector:${ctx.connector.id}`,
      error:
        `Delete reconciliation refused: ${refused}. Nothing was archived. ` +
        'This usually means the crawl saw the wrong set of records (a narrowed auth ' +
        'scope, a filtered query, or an empty page reported as complete) rather than ' +
        'that the records were really deleted. Verify the source, then re-sync.',
    })
    await setArchiveCapTripped(ctx.db, ctx.connector.id, {
      at: new Date().toISOString(),
      runId: ctx.runId,
      orphans: totalOrphans,
      bound: totalBound,
      reason: refused,
    })
    return
  }
  await clearArchiveCapTripped(ctx.db, ctx.connector.id)

  // "Minted" is a property of the record, not the binding (Phase 4): a def-keyed
  // sibling that did not create the instance still resolves to `archive` when another
  // binding of this connector did. One query for every unminted candidate at once.
  const candidateIds = new Set<string>()
  for (const { plans } of streamPlans) {
    for (const { mapping, orphans, flagged } of plans) {
      if (mapping.orphanBehavior !== 'archive') continue
      for (const item of [...orphans, ...flagged]) {
        if (!item.mintedInstance && item.entityInstanceId) candidateIds.add(item.entityInstanceId)
      }
    }
  }
  const minted =
    candidateIds.size > 0
      ? await listMintedInstanceIds(ctx.db, ctx.connector.id, [...candidateIds])
      : new Set<string>()

  for (const { plans } of streamPlans) {
    for (const { mapping, orphans, flagged } of plans) {
      const resolve = (item: ExistingItem) =>
        effectiveOrphanBehavior(mapping.orphanBehavior, {
          mintedInstance:
            item.mintedInstance ||
            (item.entityInstanceId != null && minted.has(item.entityInstanceId)),
        })
      for (const item of orphans) {
        await entitySink.archiveRecord(ctx, item, resolve(item))
      }
      // Already flagged: never re-flag, but a behavior that now resolves to `archive`
      // finishes the job the flag deferred (Phase 6b).
      for (const item of flagged) {
        const behavior = resolve(item)
        if (behavior === 'archive') await entitySink.archiveRecord(ctx, item, behavior)
      }
    }
  }
}

/** The first stream whose wipe rule trips, named, or null. */
function wipeRefusal(streamPlans: StreamPlan[]): string | null {
  for (const plan of streamPlans) {
    const reason = wipeReason(plan)
    if (reason) return `stream "${plan.label}": ${reason}`
  }
  return null
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
 * provider delete event). The upstream said so outright, so this bypasses the mint
 * degrade and the archive cap; `ignore` orphan behavior is upgraded to `archive`, while
 * a `mark_deleted` mapping still only flags. Increments `counters.deleted` per archived
 * binding; a flag is already counted by `archiveRecord` under `markedDeleted`, so it is
 * not counted twice here.
 */
export async function archiveExternalId(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  externalId: string
): Promise<void> {
  for (const mapping of mappings) {
    const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, externalId)
    if (!item) continue
    const behavior = mapping.orphanBehavior === 'ignore' ? 'archive' : mapping.orphanBehavior
    await entitySink.archiveRecord(
      ctx,
      {
        id: item.id,
        entityInstanceId: item.entityInstanceId,
        entityDefinitionId: item.entityDefinitionId,
      },
      behavior
    )
    if (behavior !== 'mark_deleted') ctx.counters.deleted += 1
  }
}
