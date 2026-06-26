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
  isFieldPath,
  keyToFieldRef,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { getCachedResourceFields } from '../cache'
import type { ResourceField } from '../resources'
import type { ConnectorRecord } from './connectors/types'
import type { MappedWrite } from './map-record'
import { mapRecord } from './map-record'
import { archiveExternalId } from './reconciliation'
import type { DecodedMapping, PendingRelation } from './service'
import { entitySink } from './sinks/entity-sink'
import type { ProjectedRecord, SyncCtx } from './sinks/types'

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
  // A bare authored key (template/app connectors store just the field id, e.g.
  // `customer`) carries no def prefix — qualify it against the parent mapping's def.
  // A def-qualified ref (UI `order:customer`) or a deeper path segment is used as-is.
  const forwardRef = (
    lastSeg.includes(':') ? lastSeg : toResourceFieldId(parentDef, lastSeg)
  ) as ResourceFieldId
  const ownerDef = getFieldDefinitionId(forwardRef)
  const forwardFieldId = getFieldId(forwardRef)

  // CLEAR — belongs_to only (a reference FK that went empty). Null the parent field.
  if (rel.childExternalId === null) {
    return {
      instanceKey: instanceKey(rel.parentMappingId, rel.parentExternalId),
      pending: { fieldKey: forwardFieldId, targetDef: null, targetExternalId: null },
    }
  }

  const fields = await getFields(ownerDef)
  const field = fields.find((f) => f.id === forwardFieldId || f.resourceFieldId === forwardRef)
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
    return {
      instanceKey: instanceKey(rel.childMappingId, rel.childExternalId),
      pending: {
        fieldKey: getFieldId(inverse),
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
 * Map one connector payload across the mapping tree and sink each projected write.
 * `updatedAtPath` (the stream's `incremental.watermarkField`) seeds each root
 * record's `upstreamUpdatedAt` version stamp — the durable value the sink's
 * out-of-order write guard compares (sync-bridge §9 Q7).
 */
export async function sinkSourceRecord(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  source: ConnectorRecord,
  updatedAtPath?: string
): Promise<void> {
  const writes = mapRecord(mappings, source, updatedAtPath)

  // Tombstone — an explicit upstream delete (event-feed `*.deleted`, a fixture
  // `deleted` flag). Archive every projected binding instead of upserting. We use the
  // per-mapping projected external id so a fan-out (parent + children) all archive.
  if (source.deleted) {
    for (const w of writes) {
      if (!w.projected) continue
      await archiveExternalId(ctx, [w.mapping], w.projected.externalId)
    }
    return
  }

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

  // Write in order (parents before children) so the parent exists for the edge.
  for (const w of writes) {
    if (!w.projected) continue
    await entitySink.upsertRecord(ctx, w.mapping, w.projected)
  }
}
