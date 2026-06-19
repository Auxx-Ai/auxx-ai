// packages/lib/src/data-connectors/sinks/entity-sink.ts
// The entity sink — the ONLY entity writer (04 §1b). Resolves identity against
// the DataConnectorItem binding (else a match-flag bootstrap), skips
// unchanged records by a sorted-key content hash, applies per-field merge
// strategy, and writes via UnifiedCrudHandler reusing the importer's bulk-upsert
// shape (warmCache once, skipSnapshotInvalidation per record, single
// invalidateSnapshots at the end). Owned mode stamps provenance + may archive;
// contributing mode narrows to managedFields and never archives. Unlike the
// importer, events are NOT skipped — workflows/agents react.

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { stableHash } from '@auxx/utils/hash'
import { getCachedCustomFields } from '../../cache'
import { toRecordId } from '../../resources/resource-id'
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
 * Resolve the entity instance an upstream record binds to via its SECONDARY
 * match keys (the external-id binding is resolved first by the caller). Returns
 * `{ instanceId }`; null ⇒ no match → caller creates. Match candidates were
 * resolved from the source record by the mapping layer (flagged `match`
 * bindings → identityCandidates); the crud lookup keys candidates by
 * systemAttribute (= the target field), which lookupByField accepts directly.
 */
async function resolveIdentity(
  ctx: SyncCtx,
  mapping: DecodedMapping,
  record: ProjectedRecord
): Promise<{ instanceId: string | null }> {
  const candidates = record.identityCandidates
    .map((c) => {
      if (isBlank(c.value)) return null
      return { systemAttribute: c.targetFieldId, value: normalizeMatch(c.value, c.normalize) }
    })
    .filter((c): c is { systemAttribute: string; value: string } => c !== null)

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
  fieldKeyToId: Map<string, string>
): Promise<{ writeSet: Record<string, unknown>; managedFields: string[] }> {
  const managedFields = Object.keys(record.fields)
  const writeSet: Record<string, unknown> = {}

  // Per-field merge strategy, derived from the binding entries (folded in from the
  // old parallel column). Keyed by target field key; unassigned drafts are skipped.
  const mergeByKey = new Map<string, FieldMergeStrategy>()
  for (const fm of mapping.fieldMappings) {
    if (fm.targetFieldKey != null && fm.mergeStrategy) {
      mergeByKey.set(fm.targetFieldKey, fm.mergeStrategy)
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

  for (const [key, value] of Object.entries(record.fields)) {
    const strategy = strategyFor(key)
    if (strategy === 'ignore') continue

    if (strategy === 'overwrite') {
      writeSet[key] = value
      continue
    }
    if (strategy === 'connector_owned_only') {
      // Write only if this connector created/owns the field on this record.
      const item = await findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)
      const owns = !item || (item.managedFields ?? []).includes(key)
      if (owns) writeSet[key] = value
      continue
    }
    if (strategy === 'fill_blank') {
      const fieldId = fieldKeyToId.get(key)
      const cur = current && fieldId ? rawOf(current.get(fieldId)) : undefined
      if (isBlank(cur)) writeSet[key] = value
      continue
    }
    if (strategy === 'manual_review') {
      // Deferred UI — log a conflict instead of writing.
      logger.info('manual_review merge — conflict logged, not written', {
        mappingId: mapping.row.id,
        externalId: record.externalId,
        field: key,
      })
    }
  }

  return { writeSet, managedFields }
}

export const entitySink: EntitySink = {
  async upsertRecord(ctx, mapping, record) {
    ctx.counters.fetched += 1
    ctx.touchedDefs.add(mapping.entityDefinitionId)

    // Field key → id map (for current-value reads under merge strategies).
    const fields = await getCachedCustomFields(ctx.orgId, mapping.entityDefinitionId)
    const fieldKeyToId = new Map<string, string>()
    for (const f of fields) {
      if (f.systemAttribute) fieldKeyToId.set(f.systemAttribute, f.id)
      fieldKeyToId.set(f.name, f.id)
      fieldKeyToId.set(f.id, f.id)
    }

    // 1. Resolve identity — exact bind, else strategy bootstrap.
    const bound = await findItem(ctx.db, ctx.connector.id, mapping.row.id, record.externalId)
    let instanceId: string | null = bound?.entityInstanceId ?? null
    if (!instanceId) {
      const resolved = await resolveIdentity(ctx, mapping, record)
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
      fieldKeyToId
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
        ctx.counters.errorSample.push({ externalId: record.externalId, error: message })
      }
      logger.warn('upsertRecord failed', {
        mappingId: mapping.row.id,
        externalId: record.externalId,
        error: message,
      })
      return
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
