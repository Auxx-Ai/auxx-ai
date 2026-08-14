// packages/lib/src/record-rules/snapshot-fetcher.ts
// Bulk record-snapshot fetcher for the sync consumer (B2 §4a). The `findMany` twin of
// services' getEntityInstance: ONE relational query per chunk (values.with.field),
// output keyed by RecordId with fieldValues keyed `systemAttribute ?? id` — the SAME
// shape fetchResourceById produces, so the rule engine/resolver treat it identically.
// Unlike getEntityInstance this INCLUDES soft-archived instances, because `deleted`
// rules must evaluate against the (still-present) last-known values of an archived row.

import type { Database } from '@auxx/database'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { extractFieldValueScalar } from '../field-values/field-value-scalar'
import type { RecordSnapshot } from './resolver'

/** Chunk size per relational query — bounded IN-list, mirrors inventory-bridge-pass. */
const CHUNK = 200

/**
 * Fetch snapshots for a set of records in one relational query per 200-id chunk.
 * Returns a `Map<RecordId, RecordSnapshot>`; ids with no live/archived row are absent.
 */
export async function fetchResourceSnapshots(
  db: Database,
  organizationId: string,
  recordIds: RecordId[]
): Promise<Map<RecordId, RecordSnapshot>> {
  const out = new Map<RecordId, RecordSnapshot>()
  if (recordIds.length === 0) return out

  const instanceIds = [...new Set(recordIds.map((r) => parseRecordId(r).entityInstanceId))]

  for (let i = 0; i < instanceIds.length; i += CHUNK) {
    const chunk = instanceIds.slice(i, i + CHUNK)
    const rows = await db.query.EntityInstance.findMany({
      where: (t, { and, eq, inArray }) =>
        and(eq(t.organizationId, organizationId), inArray(t.id, chunk)),
      with: {
        values: { orderBy: (t, { asc }) => [asc(t.sortKey)], with: { field: true } },
      },
    })

    for (const inst of rows as Array<Record<string, any>>) {
      const fieldValues: Record<string, unknown> = {}
      for (const value of inst.values ?? []) {
        const field = value.field
        if (!field) continue
        const key = field.systemAttribute ?? field.id
        // First row by ascending sortKey wins — that row is the primary value.
        if (key in fieldValues) continue
        fieldValues[key] = extractFieldValueScalar(value)
      }
      out.set(toRecordId(inst.entityDefinitionId, inst.id), {
        id: inst.id,
        entityDefinitionId: inst.entityDefinitionId,
        createdAt: inst.createdAt,
        updatedAt: inst.updatedAt,
        fieldValues,
      })
    }
  }

  return out
}
