// packages/lib/src/identity/batch.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import type { RecordIdentityEntity } from '@auxx/database/types'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'

type DbHandle = Database | Transaction

/**
 * Batch-loads `RecordIdentity` rows for a page of records in one query — the
 * "linked systems" list backer (avoids N+1). Returns raw rows grouped by
 * `RecordId`; cache-decorating into the display-ready `RecordIdentityView`
 * (app name, connection label, field label) is a front-end/record-router
 * concern layered on top of this primitive.
 */
export async function getRecordIdentitiesForRecords(
  organizationId: string,
  recordIds: RecordId[],
  db: DbHandle = database
): Promise<Map<RecordId, RecordIdentityEntity[]>> {
  const result = new Map<RecordId, RecordIdentityEntity[]>()
  if (recordIds.length === 0) return result

  const instanceIdToRecordId = new Map<string, RecordId>()
  for (const recordId of recordIds) {
    const { entityInstanceId } = parseRecordId(recordId)
    instanceIdToRecordId.set(entityInstanceId, recordId)
  }

  const rows = await db
    .select()
    .from(schema.RecordIdentity)
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        inArray(schema.RecordIdentity.entityInstanceId, [...instanceIdToRecordId.keys()])
      )
    )

  for (const row of rows) {
    const recordId = instanceIdToRecordId.get(row.entityInstanceId)
    if (!recordId) continue
    const existing = result.get(recordId)
    if (existing) {
      existing.push(row)
    } else {
      result.set(recordId, [row])
    }
  }
  return result
}
