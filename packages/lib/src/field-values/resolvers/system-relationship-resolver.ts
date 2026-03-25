// packages/lib/src/field-values/resolvers/system-relationship-resolver.ts

import { schema } from '@auxx/database'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { RESOURCE_DISPLAY_CONFIG } from '../../resources/registry/display-config'
import { RESOURCE_TABLE_MAP, type TableId } from '../../resources/registry/field-registry'
import type { ResourceField } from '../../resources/registry/field-types'
import { parseRecordId, toRecordId } from '../../resources/resource-id'
import type { FieldValueContext } from '../field-value-helpers'

/**
 * Batch fetch relationship values from a system resource table.
 *
 * For fields like thread.inbox (dbColumn: 'inboxId'), reads the FK
 * directly from the Thread table and builds target RecordIds.
 *
 * @param cachedField - The merged ResourceField with dbColumn and relationship
 * @param entityDefId - Source entity type (e.g., 'thread')
 */
export async function batchFetchSystemRelationships(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  cachedField: ResourceField,
  entityDefId: string
): Promise<Map<RecordId, RecordId[]>> {
  if (recordIds.length === 0) return new Map()

  const tableId = entityDefId as TableId
  const tableDef = RESOURCE_TABLE_MAP[tableId]
  if (!tableDef || !cachedField.dbColumn) return new Map()

  const table = (schema as any)[tableDef.dbName]
  if (!table) return new Map()

  if (!cachedField.relationship?.inverseResourceFieldId) return new Map()

  const targetEntityDefId = parseResourceFieldId(
    cachedField.relationship.inverseResourceFieldId as ResourceFieldId
  ).entityDefinitionId

  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  // Build instanceId → RecordId lookup
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  const fkColumn = table[cachedField.dbColumn]
  if (!fkColumn) return new Map()

  const rows = await queryFkColumn(ctx, tableId, table, entityInstanceIds, fkColumn)

  // Build result map
  const result = new Map<RecordId, RecordId[]>()
  for (const row of rows) {
    const sourceRecordId = instanceToRecordId.get(row.id)
    if (!sourceRecordId || !row.fkValue) continue

    const targetRecordId = toRecordId(targetEntityDefId, row.fkValue) as RecordId
    result.set(sourceRecordId, [targetRecordId])
  }

  return result
}

/**
 * Query the FK column from a system table with org scoping.
 */
async function queryFkColumn(
  ctx: FieldValueContext,
  tableId: TableId,
  table: any,
  entityInstanceIds: string[],
  fkColumn: any
): Promise<Array<{ id: string; fkValue: string | null }>> {
  const displayConfig = RESOURCE_DISPLAY_CONFIG[tableId]
  const orgStrategy = displayConfig?.orgScopingStrategy ?? 'direct'

  const conditions = [inArray(table.id, entityInstanceIds)]

  if (orgStrategy === 'direct' && table.organizationId) {
    conditions.push(eq(table.organizationId, ctx.organizationId))
  } else if (orgStrategy === 'join' && displayConfig?.joinScoping) {
    // Join-based scoping for relationship hops is unlikely in practice
    // (e.g., traversing through User), but handle it for correctness
    const jt = (schema as any)[displayConfig.joinScoping.joinTable]
    if (jt) {
      return ctx.db
        .select({ id: table.id, fkValue: fkColumn })
        .from(table)
        .innerJoin(
          jt,
          eq(
            table[displayConfig.joinScoping.mainTableKey],
            jt[displayConfig.joinScoping.joinSourceKey]
          )
        )
        .where(
          and(
            inArray(table.id, entityInstanceIds),
            eq(jt[displayConfig.joinScoping.joinOrgKey], ctx.organizationId),
            ...Object.entries(displayConfig.joinScoping.additionalConditions ?? {}).map(
              ([key, val]) => eq(jt[key], val)
            )
          )
        )
    }
  }

  return ctx.db
    .select({ id: table.id, fkValue: fkColumn })
    .from(table)
    .where(and(...conditions))
}
