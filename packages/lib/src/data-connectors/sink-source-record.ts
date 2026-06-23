// packages/lib/src/data-connectors/sink-source-record.ts
// Map one raw connector payload across the mapping tree and sink each projected
// write. Shared by the single-shot orchestrator (`run-data-connector-sync`) and the
// sliced `SyncSource` (`connector-sync-source`) so the fan-out + relationship-edge
// stamping can never diverge between the two paths. Stamps child→parent relations
// onto the parent INSTANCE's projected record so the binding carries them into the
// two-pass; parents are written before their children (walk order) so the edge
// target exists.

import type { ConnectorRecord } from './connectors/types'
import { mapRecord } from './map-record'
import { archiveExternalId } from './reconciliation'
import type { DecodedMapping } from './service'
import { entitySink } from './sinks/entity-sink'
import type { ProjectedRecord, SyncCtx } from './sinks/types'

/** Key a projected write by its mapping + instance external id (fan-out safe). */
function instanceKey(mappingId: string, externalId: string): string {
  return `${mappingId}::${externalId}`
}

/**
 * Map one connector payload across the mapping tree and sink each projected write.
 */
export async function sinkSourceRecord(
  ctx: SyncCtx,
  mappings: DecodedMapping[],
  source: ConnectorRecord
): Promise<void> {
  const writes = mapRecord(mappings, source)

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
  for (const w of writes) {
    if (!w.parentRelation) continue
    const parent = projectedByInstance.get(
      instanceKey(w.parentRelation.parentMappingId, w.parentRelation.parentExternalId)
    )
    if (parent) {
      parent.pendingRelations.push({
        fieldKey: w.parentRelation.fieldKey,
        targetMappingId: w.parentRelation.targetMappingId,
        targetExternalId: w.parentRelation.targetExternalId,
      })
    }
  }

  // Write in order (parents before children) so the parent exists for the edge.
  for (const w of writes) {
    if (!w.projected) continue
    await entitySink.upsertRecord(ctx, w.mapping, w.projected)
  }
}
