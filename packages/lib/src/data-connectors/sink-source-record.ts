// packages/lib/src/data-connectors/sink-source-record.ts
// Map one raw connector payload across the mapping tree and sink each projected
// write. Used by the sliced `SyncSource` (`connector-sync-source`) so the fan-out +
// relationship-edge stamping is centralized. Stamps child→parent relations
// onto the parent INSTANCE's projected record so the binding carries them into the
// two-pass; parents are written before their children (walk order) so the edge
// target exists.

import { createScopedLogger } from '@auxx/logger'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import {
  getFieldDefinitionId,
  getFieldId,
  isAppFieldRef,
  isFieldPath,
  isResourceFieldId,
  keyToFieldRef,
  parseAppFieldRef,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { getCachedResourceFields } from '../cache'
import type { ConditionDiagnostic } from '../conditions/evaluate'
import type { ConditionGroup } from '../conditions/types'
import { type ResourceField, resolveFieldRef } from '../resources'
import { replaceChildSets } from './child-sets'
import { ConnectorRateLimitError, type ConnectorRecord } from './connectors/types'
import type { ChildSet, MappedWrite } from './map-record'
import { mapRecord, mapRecordTree } from './map-record'
import { archiveExternalId } from './reconciliation'
import {
  SystemicSyncFailureError,
  systemicFailureReason,
  tallyFailure,
  tallySuccess,
} from './record-failure-tally'
import { recordMatchesFilter } from './record-filter'
import { countOutcome } from './run-counters'
import type { DecodedMapping, PendingRelation } from './service'
import { closeSinkPage, entitySink, openSinkPage } from './sinks/entity-sink'
import type { PageWrite, ProjectedRecord, SyncCtx } from './sinks/types'
import { sinkWriterForDef, writerKeyOf, writerParentKey } from './sinks/writers'

const logger = createScopedLogger('data-connector-sink-source')

/** Key a projected write by its mapping + instance external id (fan-out safe). */
function instanceKey(mappingId: string, externalId: string): string {
  return `${mappingId}::${externalId}`
}

/** The relation edge resolved against the field cache, plus the instance it stamps onto. */
interface ResolvedEdge {
  /** `instanceKey` of the projected record this edge attaches to. */
  instanceKey: string
  pending: PendingRelation
}

/**
 * Resolve a map-record relation intent into a concrete, def-keyed pending edge,
 * picking which INSTANCE carries it by the relationship's cardinality
 * (relationship-linking v3 §9.6 step 6):
 *   • belongs_to / has_one → stamp the forward edge on the PARENT instance.
 *   • has_many / many_to_many → SIDE-FLIP onto each CHILD via the inverse belongs_to
 *     key; the parent collection then auto-syncs (field-value inverse sync).
 *   • CLEAR (FK empty, belongs_to only) → null the parent's forward field.
 * The target is resolved DEF-KEYED (no frozen mapping pointer), so build order no
 * longer matters. Returns null when the relationship field can't be resolved.
 */
async function resolveEdge(
  ctx: SyncCtx,
  rel: NonNullable<MappedWrite['parentRelation']>,
  parentDef: string,
  getFields: (defId: string) => Promise<ResourceField[]>
): Promise<ResolvedEdge | null> {
  const ref = keyToFieldRef(rel.relationshipRef)
  // The drilled relationship lives on the parent def; a deeper FieldPath nests via
  // child mappings (each a single drill), so the last segment is the edge field.
  const lastSeg = isFieldPath(ref) ? ref[ref.length - 1]! : ref
  // The edge field lives on the PARENT def. Two ref forms reach here: a concrete
  // `defId:fieldId` segment (UI `order:customer` or a deeper drilled hop) names its OWN
  // def; a late-bound `<slug>:@app:<app>:<key>` ref (app/template connectors) resolves on
  // the parent — its leading slug is the manifest apiSlug, NOT a real def id. Resolve
  // through the SAME resolver the editor uses (`resolveFieldRef` → concrete OR `@app:`,
  // which matches a connector-provisioned RELATIONSHIP field's AUTO-GENERATED id by its
  // `appFieldKey`), so display + sync never diverge. Then use the field's REAL id.
  const ownerDef =
    !isAppFieldRef(lastSeg) && isResourceFieldId(lastSeg)
      ? getFieldDefinitionId(lastSeg)
      : parentDef
  const fields = await getFields(ownerDef)
  const field = resolveFieldRef(fields, ownerDef, lastSeg)?.field
  // Fall back to the authored id when nothing resolves (shouldn't happen post-install):
  // the bare app key for an `@app:` ref, else the def-qualified concrete id.
  const forwardFieldId =
    field?.id ??
    (isAppFieldRef(lastSeg)
      ? (parseAppFieldRef(lastSeg)?.appFieldKey ?? lastSeg)
      : getFieldId(
          (lastSeg.includes(':')
            ? lastSeg
            : toResourceFieldId(parentDef, lastSeg)) as ResourceFieldId
        ))

  // CLEAR — belongs_to only (a reference FK that went empty). Null the parent field.
  if (rel.childExternalId === null) {
    return {
      instanceKey: instanceKey(rel.parentMappingId, rel.parentExternalId),
      pending: { fieldKey: forwardFieldId, targetDef: null, targetExternalId: null },
    }
  }

  // The parent's has_many is gone (the child moved to a writer's table): its parent key holds the edge.
  if (!field) {
    const writer = await sinkWriterForDef(ctx.orgId, rel.relatedDef)
    const parentKey = writer && (await writerParentKey(ctx.orgId, writer, parentDef))
    if (parentKey) {
      return {
        instanceKey: instanceKey(rel.childMappingId, rel.childExternalId),
        pending: {
          fieldKey: parentKey,
          targetDef: parentDef,
          targetExternalId: rel.parentExternalId,
        },
      }
    }
  }

  const config = field?.relationship as RelationshipConfig | undefined
  const cardinality = config?.relationshipType

  if (cardinality === 'has_many' || cardinality === 'many_to_many') {
    // Side-flip: stamp the inverse belongs_to on the CHILD pointing at the parent.
    const inverse = config?.inverseResourceFieldId
    if (!inverse) {
      logger.warn('has_many edge has no inverse field — skipping', {
        connectorId: ctx.connector.id,
        relationshipRef: rel.relationshipRef,
      })
      return null
    }
    // A child def with a writer takes the flipped key as a writer parent key.
    const writer = await sinkWriterForDef(ctx.orgId, rel.relatedDef)
    return {
      instanceKey: instanceKey(rel.childMappingId, rel.childExternalId),
      pending: {
        fieldKey: (writer && writerKeyOf(writer, inverse)) || getFieldId(inverse),
        targetDef: parentDef,
        targetExternalId: rel.parentExternalId,
      },
    }
  }

  // belongs_to / has_one (and the safe default) → stamp the forward edge on the parent.
  return {
    instanceKey: instanceKey(rel.parentMappingId, rel.parentExternalId),
    pending: {
      fieldKey: forwardFieldId,
      targetDef: rel.relatedDef,
      targetExternalId: rel.childExternalId,
    },
  }
}

/**
 * Record ONE run-level warning for a record filter that did not compile.
 *
 * `recordMatchesFilter` fails open, so the run imported everything — which is the
 * safe outcome but not the one the author asked for, and a silent one. The warning
 * rides in `errorSample` (the only per-run array that reaches the run panel) tiered
 * `'skipped'`, so it is VISIBLE without degrading the run to `partial`:
 * `sync-core-adapters`' finalize only counts entries whose `tier !== 'skipped'`.
 *
 * De-duplicated on the message rather than counted per record: the filter is a
 * property of the stream, not of the row, so 13,637 identical entries would say
 * nothing extra and would evict every real error from the 50-entry sample.
 */
function recordFilterCompileWarning(ctx: SyncCtx, diagnostics: ConditionDiagnostic[]): void {
  const detail = diagnostics.map((d) => `${d.fieldId} (${d.reason})`).join(', ')
  const message =
    `Record filter ignored — these conditions could not be evaluated: ${detail}. ` +
    'Every fetched record was imported. Fix the filter and re-sync.'
  if (ctx.counters.errorSample.some((e) => e.error === message)) return
  if (ctx.counters.errorSample.length < 50) {
    ctx.counters.errorSample.push({ externalId: '', error: message, tier: 'skipped' })
  }
  logger.warn('record filter did not compile — failing open, every record imported', {
    connectorId: ctx.connector.id,
    diagnostics: detail,
  })
}

/** A whole-source-record outcome has no single write, so it is booked to the root mapping. */
function countSourceOutcome(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  outcome: 'skipped' | 'failed'
): void {
  const root = mappings.find((m) => m.parentMappingId === null) ?? mappings[0]
  if (root) countOutcome(ctx.counters, root.row.id, outcome)
  else ctx.counters[outcome] += 1
}

/**
 * Map one connector payload across the mapping tree and sink each projected write.
 * `updatedAtPath` (the stream's `incremental.watermarkField`) seeds each root
 * record's `upstreamUpdatedAt` version stamp — the durable value the sink's
 * out-of-order write guard compares (sync-bridge §9 Q7).
 *
 * `recordFilter` is the stream's per-record filter (v11), evaluated here rather than
 * at the three call sites (bulk-export backfill, sliced fetch, webhook-steered fetch)
 * so one edit covers all of them and a fourth door cannot be opened without it. The
 * webhook path is the one that would hurt most to miss: it is where a NEWLY qualifying
 * record arrives.
 */
export async function sinkSourceRecord(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  source: ConnectorRecord,
  updatedAtPath?: string,
  recordFilter?: ConditionGroup[] | null
): Promise<void> {
  await withRecordBoundary(ctx, mappings, source, async () => {
    const prepared = await prepareSourceRecord(mappings, source, ctx, updatedAtPath, recordFilter)
    await applySourceRecord(ctx, mappings, prepared, false)
  })
}

/**
 * `sinkSourceRecord` for one fetched page: every record is mapped first, then the page's
 * writes sink with page-scoped binds (plans/mrp/14 §4). Records apply in fetch order, each
 * inside its own fault boundary, so counters, samples and the failure tally match the
 * per-record lane. The backfill and steady slice chains only; webhooks stay per record.
 */
export async function sinkSourcePage(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  sources: ConnectorRecord[],
  updatedAtPath?: string,
  recordFilter?: ConditionGroup[] | null
): Promise<void> {
  const prepared: Prepared[] = []
  for (const source of sources) {
    prepared.push(
      await prepareSourceRecord(mappings, source, ctx, updatedAtPath, recordFilter).catch(
        (error: unknown): Prepared => ({ kind: 'error', error })
      )
    )
  }
  await openSinkPage(
    ctx,
    prepared.flatMap((p) => (p.kind === 'writes' ? p.writes : []))
  )
  try {
    for (const [i, source] of sources.entries()) {
      await withRecordBoundary(ctx, mappings, source, () =>
        applySourceRecord(ctx, mappings, prepared[i]!, true)
      )
    }
  } catch (error) {
    await closeSinkPage(ctx).catch((flushError) =>
      logger.warn('page flush failed after the page stopped', {
        connectorId: ctx.connector.id,
        error: flushError instanceof Error ? flushError.message : String(flushError),
      })
    )
    throw error
  }
  await closeSinkPage(ctx)
}

/** The per-record fault boundary: one bad record is counted and the sync continues. */
async function withRecordBoundary(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  source: ConnectorRecord,
  sink: () => Promise<void>
): Promise<void> {
  try {
    await sink()
    tallySuccess(ctx.failureTally)
  } catch (error) {
    // The abort signal and a throttle are the SLICE's business, not this record's —
    // swallowing either would turn a graceful yield into silent data loss.
    if (error instanceof ConnectorRateLimitError || ctx.signal?.aborted) throw error
    // A systemic trip from a nested call must not be re-counted as one bad record.
    if (error instanceof SystemicSyncFailureError) throw error

    const message = error instanceof Error ? error.message : String(error)
    countSourceOutcome(ctx, mappings, 'failed')
    tallyFailure(ctx.failureTally, message)
    if (ctx.counters.errorSample.length < 50) {
      ctx.counters.errorSample.push({
        externalId: source.externalId ?? '',
        error: message,
        tier: 'rejected',
      })
    }
    logger.warn('record failed — counted and skipped, sync continues', {
      connectorId: ctx.connector.id,
      externalId: source.externalId,
      error: message,
    })

    const systemic = systemicFailureReason(ctx.failureTally)
    if (systemic) throw new SystemicSyncFailureError(systemic)
  }
}

/** One source record mapped and ready to apply; an `error` is thrown at its turn. */
type Prepared =
  | { kind: 'error'; error: unknown }
  | { kind: 'tombstone'; mappings: DecodedMapping[]; externalIds: string[] }
  | { kind: 'filtered'; diagnostics: ConditionDiagnostic[] }
  | {
      kind: 'writes'
      diagnostics: ConditionDiagnostic[]
      writes: PageWrite[]
      childSets: ChildSet[]
    }

/**
 * Map one source record: tombstone, filter verdict, or its projected writes with their edges
 * stamped. Reads only cached fields, so a page can map every record before sinking any.
 */
async function prepareSourceRecord(
  mappings: DecodedMapping[],
  source: ConnectorRecord,
  ctx: SyncCtx,
  updatedAtPath?: string,
  recordFilter?: ConditionGroup[] | null
): Promise<Prepared> {
  // Tombstone — an explicit upstream delete (event-feed `*.deleted`, a fixture
  // `deleted` flag). Archive every projected binding instead of upserting. We use the
  // per-mapping projected external id so a fan-out (parent + children) all archive.
  //
  // 🔴 A tombstone bypasses the record filter UNCONDITIONALLY, which is why this sits
  // ABOVE the filter rather than behind a branch inside it. The delete signal carries
  // the record's CURRENT payload, and the very change that deleted it is often the
  // change that made it stop matching: refund a Shopify customer's last order and
  // `orders_count` drops to 0, so an `orders_count > 0` filter would drop the delete
  // itself and orphan the already-synced contact forever.
  if (source.deleted) {
    const archives = mapRecord(mappings, source, updatedAtPath).filter((w) => w.projected)
    return {
      kind: 'tombstone',
      mappings: archives.map((w) => w.mapping),
      externalIds: archives.map((w) => w.projected!.externalId),
    }
  }

  // Per-stream record filter (v11) — evaluated on the RAW source payload, before the
  // mapping runs, so a filtered record costs nothing beyond the fetch that already
  // happened. A non-match is a deliberate, explained outcome: it bumps `skipped` and
  // nothing else. It is NOT a failure and must never enter `errorSample` as one — a
  // fully-filtering stream has to report `completed`, not `partial`.
  const verdict = recordMatchesFilter(source, recordFilter)
  if (!verdict.matched) return { kind: 'filtered', diagnostics: verdict.diagnostics }

  const { writes, childSets } = mapRecordTree(mappings, source, updatedAtPath)

  // Index projected writes by (mapping, instance) so a child attaches its edge to
  // the exact parent instance's pendingRelations before that parent is sunk.
  const projectedByInstance = new Map<string, ProjectedRecord>()
  for (const w of writes) {
    if (w.projected) {
      projectedByInstance.set(instanceKey(w.mapping.row.id, w.projected.externalId), w.projected)
    }
  }
  // The parent def owns the forward relationship field — `resolveEdge` qualifies a
  // bare authored key against it. Memoize field reads per def: a fan-out of N children
  // drilling the same relationship would otherwise re-read the same def N times.
  const parentDefByMappingId = new Map(mappings.map((m) => [m.row.id, m.entityDefinitionId]))
  const fieldsByDef = new Map<string, ResourceField[]>()
  const getFields = async (defId: string): Promise<ResourceField[]> => {
    const cached = fieldsByDef.get(defId)
    if (cached) return cached
    const fetched = await getCachedResourceFields(ctx.orgId, defId)
    fieldsByDef.set(defId, fetched)
    return fetched
  }
  for (const w of writes) {
    if (!w.parentRelation) continue
    const parentDef = parentDefByMappingId.get(w.parentRelation.parentMappingId)
    if (!parentDef) continue
    const edge = await resolveEdge(ctx, w.parentRelation, parentDef, getFields)
    if (!edge) continue
    // The edge attaches to its cardinality-chosen instance: the parent (belongs_to)
    // or the child (has_many side-flip). A has_many side-flip targets the CHILD, which
    // is only projected when it's an embedded upsert — an id-only `reference` child
    // writes nothing, so warn rather than silently drop the edge.
    const target = projectedByInstance.get(edge.instanceKey)
    if (!target) {
      logger.warn('resolved relationship edge has no projected instance — dropping', {
        connectorId: ctx.connector.id,
        relationshipRef: w.parentRelation.relationshipRef,
        instanceKey: edge.instanceKey,
      })
      continue
    }
    target.pendingRelations.push(edge.pending)
  }

  return {
    kind: 'writes',
    diagnostics: verdict.diagnostics,
    // Written in order (parents before children) so the parent exists for the edge.
    writes: writes.flatMap((w) =>
      w.projected ? [{ mapping: w.mapping, record: w.projected }] : []
    ),
    childSets,
  }
}

/**
 * Apply one prepared source record. Everything in here may throw; the caller's
 * `withRecordBoundary` counts it. Before that boundary existed, ~11 unprotected DB calls
 * per record escalated one bad row into a failed RUN — one malformed phone number in a
 * 4222-contact Quo address book ended the whole import that way.
 */
async function applySourceRecord(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  prepared: Prepared,
  page: boolean
): Promise<void> {
  if (prepared.kind === 'error') throw prepared.error
  if (prepared.kind === 'tombstone') {
    // `archiveExternalId` reads and writes items outside the page.
    await ctx.sinkPage?.flush()
    for (const [i, mapping] of prepared.mappings.entries()) {
      await archiveExternalId(ctx, [mapping], prepared.externalIds[i]!)
    }
    return
  }
  if (prepared.diagnostics.length > 0) recordFilterCompileWarning(ctx, prepared.diagnostics)
  if (prepared.kind === 'filtered') {
    countSourceOutcome(ctx, mappings, 'skipped')
    return
  }
  if (page) await entitySink.upsertRecords(prepared.writes, ctx)
  else {
    for (const w of prepared.writes) await entitySink.upsertRecord(ctx, w.mapping, w.record)
  }
  if (prepared.childSets.length > 0) {
    // `replaceChildSets` reads the children's items and archives absent ones.
    await ctx.sinkPage?.flushForItemReads()
    await replaceChildSets(ctx, prepared.childSets)
  }
}
