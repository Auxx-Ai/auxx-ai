// packages/lib/src/field-values/resolvers/visit-virtual-fields.ts

import { schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { and, eq, inArray } from 'drizzle-orm'
import type { FieldValueContext } from '../field-value-helpers'
import type { VirtualFieldMap } from './virtual-field-registry'

/** Build the shared typed-value metadata for a virtual Visit field. */
function buildBase(entityId: string, fieldKey: string, fieldIdMap: Map<string, string>) {
  const now = new Date().toISOString()
  return {
    id: `virtual_${entityId}_${fieldKey}`,
    entityId,
    fieldId: fieldIdMap.get(fieldKey) ?? fieldKey,
    sortKey: '0',
    createdAt: now,
    updatedAt: now,
  }
}

/** Store a resolved virtual field value. */
function setFieldValue(
  result: VirtualFieldMap,
  entityId: string,
  fieldKey: string,
  value: TypedFieldValue
) {
  const fieldMap = result.get(entityId) ?? new Map()
  fieldMap.set(fieldKey, { value })
  result.set(entityId, fieldMap)
}

/**
 * Resolve Visit presentation fields from one organization-scoped query.
 *
 * `startTime` and `endTime` stay absolute ISO values. Callers apply their
 * own presentation timezone only when they render the resolved value.
 */
export async function resolveVisitVirtualFields(
  ctx: FieldValueContext,
  entityIds: string[],
  fieldKeys: string[],
  fieldIdMap: Map<string, string>
): Promise<VirtualFieldMap> {
  if (entityIds.length === 0 || fieldKeys.length === 0) return new Map()

  const rows = await ctx.db
    .select({
      id: schema.WorkOrderVisit.id,
      startTime: schema.WorkOrderVisit.startTime,
      endTime: schema.WorkOrderVisit.endTime,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        inArray(schema.WorkOrderVisit.id, entityIds),
        eq(schema.WorkOrderVisit.organizationId, ctx.organizationId)
      )
    )

  const requested = new Set(fieldKeys)
  const result: VirtualFieldMap = new Map()
  for (const row of rows) {
    for (const fieldKey of ['date', 'startTime', 'endTime'] as const) {
      if (!requested.has(fieldKey)) continue
      const value = fieldKey === 'endTime' ? row.endTime : row.startTime
      if (!value) continue

      setFieldValue(result, row.id, fieldKey, {
        ...buildBase(row.id, fieldKey, fieldIdMap),
        type: 'date',
        value: value.toISOString(),
      } as TypedFieldValue)
    }
  }

  return result
}
