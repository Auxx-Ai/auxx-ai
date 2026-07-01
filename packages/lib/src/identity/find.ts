// packages/lib/src/identity/find.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
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
    eq(schema.RecordIdentity.organizationId, input.organizationId),
    eq(schema.RecordIdentity.entityDefinitionId, input.entityDefinitionId),
    eq(schema.RecordIdentity.source, input.source),
    eq(schema.RecordIdentity.externalId, input.externalId),
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
