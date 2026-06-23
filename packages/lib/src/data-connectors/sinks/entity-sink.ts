// packages/lib/src/data-connectors/sinks/entity-sink.ts
// The entity sink — the ONLY entity writer (04 §1b). Resolves identity against
// the DataConnectorItem binding (else a match-flag bootstrap), skips
// unchanged records by a sorted-key content hash, applies per-field merge
// strategy, and writes via UnifiedCrudHandler reusing the importer's bulk-upsert
// shape (warmCache once, skipSnapshotInvalidation per record, single
// invalidateSnapshots at the end). Owned mode stamps provenance + may archive;
// contributing mode narrows to managedFields and never archives. Unlike the
// importer, events are NOT skipped — workflows/agents react.

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldId, ResourceFieldId } from '@auxx/types/field'
import { getFieldId } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { stableHash } from '@auxx/utils/hash'
import { and, eq, inArray } from 'drizzle-orm'
import { resolveConnectorFieldRef } from '../../agents/bindings/resolve'
import { toRecordId } from '../../resources/resource-id'
import { buildWriteKeyToFieldId } from '../field-id-resolver'
import {
  type DecodedMapping,
  findItem,
  listItemsForMapping,
  markItemArchived,
  type PendingRelation,
  setItemPendingRelations,
  touchItem,
  upsertItem,
} from '../service'
import type { FieldMergeStrategy } from '../types'
import type { EntitySink, ProjectedRecord, SyncCtx } from './types'

const logger = createScopedLogger('data-connector-entity-sink')

/** Normalize a match value the way the importer's find-existing path expects. */
function normalizeMatch(value: unknown, normalize?: 'email' | 'phone' | 'domain' | 'none'): string {
  const s = String(value ?? '').trim()
  if (normalize === 'email') return s.toLowerCase()
  if (normalize === 'domain')
    return s
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
  return s
}

/** Extract the raw scalar from a TypedFieldValue (for merge comparison). */
function rawOf(v: TypedFieldValue | TypedFieldValue[] | undefined): unknown {
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v.length > 0 ? v : undefined
  const t = v as TypedFieldValue
  if ('value' in t) return (t as { value: unknown }).value
  return undefined
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Resolve every distinct `targetFieldRef` a record references (write fields +
 * identity candidates) to a concrete `ResourceFieldId`. Concrete refs pass
 * through; the late-bound `@app:` form resolves against the connector's bound
 * connection (its `credentialId`). An unresolved ref (no bound connection / no
 * provisioned field) is dropped from the map + recorded as a run error — the
 * caller skips that field/candidate rather than writing a garbage field id.
 */
async function resolveFieldRefs(
  ctx: SyncCtx,
  record: ProjectedRecord
): Promise<Map<string, ResourceFieldId>> {
  const refs = new Set<string>()
  for (const k of Object.keys(record.fields)) refs.add(k)
  for (const c of record.identityCandidates) refs.add(c.targetFieldRef)

  const connectionId = ctx.connector.credentialId ?? undefined
  const out = new Map<string, ResourceFieldId>()
  for (const ref of refs) {
    const resolved = await resolveConnectorFieldRef(ref as ResourceFieldId, ctx.orgId, connectionId)
    if (resolved) {
      out.set(ref, resolved)
      continue
    }
    logger.warn('targetFieldRef did not resolve — skipping field/candidate', {
      connectorId: ctx.connector.id,
      mappingExternalId: record.externalId,
      ref,
    })
    if (ctx.counters.errorSample.length < 50) {
      ctx.counters.errorSample.push({
        externalId: record.externalId,
        error: `unresolved targetFieldRef: ${ref}`,
        tier: 'invalid', // caught before the write — bad shape / missing identity
      })
    }
  }
  return out
}

/**
 * Resolve the entity instance an upstream record binds to via its SECONDARY
 * match keys (the external-id binding is resolved first by the caller). Returns
 * `{ instanceId }`; null ⇒ no match → caller creates. Match candidates were
 * resolved from the source record by the mapping layer (flagged `match`
 * bindings → identityCandidates); each candidate's `targetFieldRef` is resolved
 * to a concrete field id via `refToConcrete`, then keyed by `fieldId` so
 * `lookupByField` matches connector-provisioned fields (systemAttribute null).
 */
async function resolveIdentity(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  refToConcrete: Map<string, ResourceFieldId>
): Promise<{ instanceId: string | null }> {
  const candidates = record.identityCandidates
    .map((c) => {
      if (isBlank(c.value)) return null
      const concrete = refToConcrete.get(c.targetFieldRef)
      if (!concrete) return null
      return { fieldId: getFieldId(concrete), value: normalizeMatch(c.value, c.normalize) }
    })
    .filter((c): c is { fieldId: FieldId; value: string } => c !== null)

  if (candidates.length === 0) return { instanceId: null } // external-id only → create

  const { items } = await ctx.crud.lookupByField({
    entityDefinitionId: mapping.entityDefinitionId,
    candidates,
    limit: 2,
  })
  if (items.length === 0) return { instanceId: null }
  if (items.length > 1) {
    logger.warn('ambiguous identity match — using first', {
      mappingId: mapping.row.id,
      externalId: record.externalId,
      matches: items.length,
    })
  }
  // recordId is `entityDefId:instanceId`.
  const recordId = items[0]!.recordId
  const instanceId = recordId.split(':').slice(1).join(':')
  return { instanceId }
}

/**
 * Build the write set from a projected record, applying each field's merge
 * strategy against the current target value. Contributing mode narrows to the
 * mapping's managed (mapped) fields; owned mode writes everything mapped.
 */
async function buildWriteSet(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord,
  existingInstanceId: string | null,
  refToConcrete: Map<string, ResourceFieldId>
): Promise<{ writeSet: Record<string, unknown>; managedFields: string[] }> {
  // managedFields stay keyed by the raw `targetFieldRef` — the same key space as
  // `record.fields`, `mergeByKey`, and the prior runs' stored `managedFields`
  // (used by the `connector_owned_only` ownership check below).
  const managedFields = Object.keys(record.fields)
  // Write-set keys are concrete field ids (`getFieldId(resolvedRef)`) — what
  // `setFieldValues`/`createEntity` expect (a bare uuid or systemAttribute).
  const writeSet: Record<string, unknown> = {}

  // Per-field merge strategy, derived from the binding entries (folded in from the
  // old parallel column). Keyed by raw `targetFieldRef`; unassigned drafts skipped.
  const mergeByKey = new Map<string, FieldMergeStrategy>()
  for (const fm of mapping.fieldMappings) {
    if (fm.targetFieldRef != null && fm.mergeStrategy) {
      mergeByKey.set(fm.targetFieldRef, fm.mergeStrategy)
    }
  }
  const strategyFor = (key: string): FieldMergeStrategy => mergeByKey.get(key) ?? 'overwrite'

  // Read current values once (only needed for fill_blank / connector_owned_only).
  const needsCurrent = managedFields.some((k) => {
    const strat = strategyFor(k)
    return strat === 'fill_blank' || strat === 'connector_owned_only' || strat === 'manual_review'
  })
  let current: Map<string, TypedFieldValue | TypedFieldValue[]> | null = null
  if (needsCurrent && existingInstanceId) {
    const recordId = toRecordId(mapping.entityDefinitionId, existingInstanceId)
    current = await ctx.crud.getFieldValues(recordId)
  }

  for (const [rawRef, value] of Object.entries(record.fields)) {
    const strategy = strategyFor(rawRef)
    if (strategy === 'ignore') continue

    const concrete = refToConcrete.get(rawRef)
    if (!concrete) continue // unresolved @app: ref — already recorded in resolveFieldRefs
    const fieldId = getFieldId(concrete)

    if (strategy === 'overwrite') {
      writeSet[fieldId] = value
      continue
    }
    if (strategy === 'connector_owned_only') {
      // Write only if this connector created/owns the field on this record.
      const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)
      const owns = !item || (item.managedFields ?? []).includes(rawRef)
      if (owns) writeSet[fieldId] = value
      continue
    }
    if (strategy === 'fill_blank') {
      const cur = current ? rawOf(current.get(fieldId)) : undefined
      if (isBlank(cur)) writeSet[fieldId] = value
      continue
    }
    if (strategy === 'manual_review') {
      // Deferred UI — log a conflict instead of writing.
      logger.info('manual_review merge — conflict logged, not written', {
        mappingId: mapping.row.id,
        externalId: record.externalId,
        field: rawRef,
      })
    }
  }

  return { writeSet, managedFields }
}

/**
 * Stamp the per-cell contributing provenance marker (`FieldValue.managedByConnectorId`)
 * on the values this connector just wrote. Contributing-mode only — owned writes
 * never call this (the column-grain `CustomField.dataConnectorId` carries owned
 * provenance instead). The marker drives the soft "Synced by <connector>" cell
 * badge; the cell stays editable.
 *
 * `writeFieldKeys` are the concrete write-set keys (a bare CustomField uuid OR a
 * systemAttribute). `FieldValue.fieldId` is always the CustomField uuid, so we
 * resolve systemAttribute keys back to their uuid via the cached field map before
 * the batched UPDATE. One UPDATE per upserted contributing record (cold path).
 */
async function stampContributingProvenance(
  ctx: SyncCtx,
  entityDefinitionId: string,
  instanceId: string,
  writeFieldKeys: string[]
): Promise<void> {
  if (writeFieldKeys.length === 0) return

  const keyToId = await buildWriteKeyToFieldId(ctx.orgId, entityDefinitionId)
  const concreteIds = Array.from(
    new Set(writeFieldKeys.map((k) => keyToId.get(k)).filter((v): v is string => !!v))
  )
  if (concreteIds.length === 0) return

  await ctx.db
    .update(schema.FieldValue)
    .set({ managedByConnectorId: ctx.connector.id })
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.orgId),
        eq(schema.FieldValue.entityId, instanceId),
        inArray(schema.FieldValue.fieldId, concreteIds)
      )
    )
}

export const entitySink: EntitySink = {
  async upsertRecord(ctx, mapping, record) {
    ctx.counters.fetched += 1
    ctx.touchedDefs.add(mapping.entityDefinitionId)

    // Resolve every mapped `targetFieldRef` to a concrete field id once — both the
    // identity lookup and the write set key off this table (§3.3).
    const refToConcrete = await resolveFieldRefs(ctx, record)

    // 1. Resolve identity — exact bind, else strategy bootstrap.
    const bound = await findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)
    let instanceId: string | null = bound?.entityInstanceId ?? null
    if (!instanceId) {
      const resolved = await resolveIdentity(ctx, mapping, record, refToConcrete)
      instanceId = resolved.instanceId
    }

    // 2. Content hash — skip unchanged + already bound.
    const contentHash = stableHash({ fields: record.fields, displayName: record.displayName })
    if (bound?.entityInstanceId && bound.contentHash === contentHash) {
      await touchItem(ctx.db, bound.id, ctx.runId)
      ctx.counters.skipped += 1
      // Still re-register pending relations so a later-arriving target resolves.
      if (record.pendingRelations.length > 0) {
        await mergePendingRelations(
          ctx,
          bound.id,
          bound.pendingRelations ?? [],
          record.pendingRelations
        )
      }
      return
    }

    // 3. Build the write set with per-field merge strategy.
    const { writeSet, managedFields } = await buildWriteSet(
      ctx,
      mapping,
      record,
      instanceId,
      refToConcrete
    )

    // 4. Write — owned uses the bypass handler + provenance; contributing uses
    //    the standard handler and leaves the row pair alone.
    const handler = mapping.targetMode === 'owned' ? ctx.ownedCrud : ctx.crud
    try {
      if (instanceId) {
        const recordId = toRecordId(mapping.entityDefinitionId, instanceId)
        await handler.update(recordId, writeSet, undefined, { skipSnapshotInvalidation: true })
        ctx.counters.updated += 1
      } else {
        const created = await handler.create(mapping.entityDefinitionId, writeSet, {
          skipSnapshotInvalidation: true,
          provenance:
            mapping.targetMode === 'owned'
              ? { integrationSource: ctx.connector.id, externalId: record.externalId }
              : undefined,
        })
        instanceId = created.instance.id
        ctx.counters.created += 1
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.counters.failed += 1
      if (ctx.counters.errorSample.length < 50) {
        ctx.counters.errorSample.push({
          externalId: record.externalId,
          error: message,
          tier: 'rejected', // the entity write itself failed
        })
      }
      logger.warn('upsertRecord failed', {
        mappingId: mapping.row.id,
        externalId: record.externalId,
        error: message,
      })
      return
    }

    // 4b. Contributing mode — stamp per-cell provenance on the written values so
    //     the grid/drawer can show a "Synced by <connector>" marker. Owned mode
    //     skips this (column-grain provenance lives on CustomField.dataConnectorId).
    if (mapping.targetMode === 'contributing' && instanceId) {
      await stampContributingProvenance(
        ctx,
        mapping.entityDefinitionId,
        instanceId,
        Object.keys(writeSet)
      )
    }

    // 5. Upsert the binding — merge any new managed fields with prior ones
    //    (contributing records are co-owned field-by-field across connectors).
    const mergedManaged = Array.from(new Set([...(bound?.managedFields ?? []), ...managedFields]))
    await upsertItem(ctx.db, {
      dataConnectorId: ctx.connector.id,
      organizationId: ctx.orgId,
      mappingId: mapping.row.id,
      externalId: record.externalId,
      entityDefinitionId: mapping.entityDefinitionId,
      entityInstanceId: instanceId,
      contentHash,
      managedFields: mergedManaged,
      pendingRelations: mergePending(bound?.pendingRelations ?? [], record.pendingRelations),
      upstreamUpdatedAt: record.upstreamUpdatedAt ?? null,
      lastSeenRunId: ctx.runId,
    })
  },

  async archiveRecord(ctx, item, behavior) {
    if (behavior === 'ignore' || !item.entityInstanceId) return
    if (behavior === 'archive') {
      const recordId = toRecordId(item.entityDefinitionId, item.entityInstanceId)
      try {
        await ctx.ownedCrud.archive(recordId, { skipSnapshotInvalidation: true })
        ctx.touchedDefs.add(item.entityDefinitionId)
        ctx.counters.archived += 1
      } catch (error) {
        logger.warn('archiveRecord failed', {
          itemId: item.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // mark_deleted: set a connector status field — left as a no-op stub for v1
    // (no canonical status field is provisioned yet); the item is still stamped.
    await markItemArchived(ctx.db, item.id, ctx.runId)
  },

  async listExistingItems(ctx, mapping) {
    const items = await listItemsForMapping(ctx.db, ctx.connector.id, mapping.row.id)
    return items.map((i) => ({
      id: i.id,
      entityInstanceId: i.entityInstanceId,
      entityDefinitionId: i.entityDefinitionId,
      lastSeenRunId: i.lastSeenRunId,
    }))
  },
}

/** Union two pending-relation lists, de-duplicated by their tuple. */
function mergePending(existing: PendingRelation[], incoming: PendingRelation[]): PendingRelation[] {
  const seen = new Set<string>()
  const out: PendingRelation[] = []
  for (const r of [...existing, ...incoming]) {
    const k = `${r.fieldKey}|${r.targetMappingId}|${r.targetExternalId}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

/** Persist a merged pending-relations list onto an already-bound item. */
async function mergePendingRelations(
  ctx: SyncCtx,
  itemId: string,
  existing: PendingRelation[],
  incoming: PendingRelation[]
): Promise<void> {
  await setItemPendingRelations(ctx.db, itemId, mergePending(existing, incoming))
}
