// packages/lib/src/identity/find.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { FindRecordByIdentityInput, RecordIdentityMatch } from './types'

type DbHandle = Database | Transaction

/**
 * Reverse lookup: resolve a record from an external identity.
 *
 * `connectionId`/`appFieldKey` are match filters, not row-identity fields —
 * omit them (`undefined`) to match *any* connection/kind (the cross-store,
 * "regardless of which app/store" case); pass `null` to require the column
 * be NULL (app-less/installation-scoped links); pass a value to scope to one
 * connection (mandatory for chat's id-based resolution, so a customer id
 * colliding across two stores doesn't cross-link).
 *
 * Not archived-filtered — re-capturing an archived contact should re-link
 * the same row, not duplicate it.
 */
export async function findRecordByIdentity(
  input: FindRecordByIdentityInput,
  db: DbHandle = database
): Promise<RecordIdentityMatch | null> {
  const conditions = [
    ...scopeConditions(input),
    eq(schema.RecordIdentity.externalId, input.externalId),
  ]

  const [row] = await db
    .select({
      entityInstanceId: schema.RecordIdentity.entityInstanceId,
      entityDefinitionId: schema.RecordIdentity.entityDefinitionId,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId)
    )
    .where(and(...conditions))
    .limit(1)

  if (!row) return null
  return {
    recordId: toRecordId(row.entityDefinitionId, row.entityInstanceId),
    displayName: row.displayName,
  }
}

/**
 * `findRecordByIdentity` for many external ids of one scope in one query. An id with no
 * identity is absent from the map; with several, any one of them wins, as in the single form.
 */
export async function findRecordsByIdentity(
  input: Omit<FindRecordByIdentityInput, 'externalId'> & { externalIds: string[] },
  db: DbHandle = database
): Promise<Map<string, RecordIdentityMatch>> {
  const out = new Map<string, RecordIdentityMatch>()
  if (input.externalIds.length === 0) return out
  const rows = await db
    .select({
      externalId: schema.RecordIdentity.externalId,
      entityInstanceId: schema.RecordIdentity.entityInstanceId,
      entityDefinitionId: schema.RecordIdentity.entityDefinitionId,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId)
    )
    .where(
      and(
        ...scopeConditions(input),
        inArray(schema.RecordIdentity.externalId, [...new Set(input.externalIds)])
      )
    )
  for (const row of rows) {
    if (out.has(row.externalId)) continue
    out.set(row.externalId, {
      recordId: toRecordId(row.entityDefinitionId, row.entityInstanceId),
      displayName: row.displayName,
    })
  }
  return out
}

function scopeConditions(input: Omit<FindRecordByIdentityInput, 'externalId'>): SQL[] {
  const conditions = [
    eq(schema.RecordIdentity.organizationId, input.organizationId),
    eq(schema.RecordIdentity.entityDefinitionId, input.entityDefinitionId),
    eq(schema.RecordIdentity.source, input.source),
  ]
  if (input.connectionId !== undefined) {
    conditions.push(
      input.connectionId === null
        ? isNull(schema.RecordIdentity.connectionId)
        : eq(schema.RecordIdentity.connectionId, input.connectionId)
    )
  }
  if (input.appFieldKey !== undefined) {
    conditions.push(
      input.appFieldKey === null
        ? isNull(schema.RecordIdentity.appFieldKey)
        : eq(schema.RecordIdentity.appFieldKey, input.appFieldKey)
    )
  }
  return conditions
}
