// packages/lib/src/data-connectors/item-bindings.ts
//
// The one read the field-value batch fetch needs for the per-cell sync badge
// (plans/money/tasks/40-per-field-sync-pin.md section 7): every live
// `DataConnectorItem` on a set of records, with its mapping's field bindings.
// A leaf module on purpose: `field-values` imports it, and this must not pull
// the sink or the sync barrel into that graph.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { InstanceConnectorBinding } from './sync-state'

/**
 * Live item bindings for `instanceIds`, keyed by instance id. One query on the
 * `entityInstanceId` index joined to the mapping row for its `fieldMappings`.
 * Instances with no binding are absent from the map. Runs concurrently with
 * the main field-value query, never after it.
 */
export async function listItemBindingsForInstances(
  db: Database | Transaction,
  organizationId: string,
  instanceIds: readonly string[]
): Promise<Map<string, InstanceConnectorBinding[]>> {
  const out = new Map<string, InstanceConnectorBinding[]>()
  if (instanceIds.length === 0) return out

  const rows = await db
    .select({
      entityInstanceId: schema.DataConnectorItem.entityInstanceId,
      connectorId: schema.DataConnectorItem.dataConnectorId,
      managedFields: schema.DataConnectorItem.managedFields,
      pinnedFields: schema.DataConnectorItem.pinnedFields,
      fieldMappings: schema.DataConnectorMapping.fieldMappings,
    })
    .from(schema.DataConnectorItem)
    .innerJoin(
      schema.DataConnectorMapping,
      eq(schema.DataConnectorMapping.id, schema.DataConnectorItem.mappingId)
    )
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        inArray(schema.DataConnectorItem.entityInstanceId, [...instanceIds]),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )

  for (const row of rows) {
    if (!row.entityInstanceId) continue
    const list = out.get(row.entityInstanceId) ?? []
    list.push({
      connectorId: row.connectorId,
      managedFields: row.managedFields ?? [],
      pinnedFields: row.pinnedFields ?? [],
      bindings: (row.fieldMappings ?? []).map((fm) => ({
        targetFieldRef: fm.targetFieldRef,
        mergeStrategy: fm.mergeStrategy,
        identityRole: fm.identityRole,
      })),
    })
    out.set(row.entityInstanceId, list)
  }
  return out
}
