// packages/lib/src/identity/delete.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { Result, type TypedResult } from '../result'
import type { DeleteRecordIdentityInput } from './types'

type DbHandle = Database | Transaction

/**
 * Mirror-delete on explicit value clear. FK cascades (record delete,
 * connection delete, field delete) already cover teardown — this is only
 * for a writer that clears an identity cell without deleting its owner.
 */
export async function deleteRecordIdentity(
  input: DeleteRecordIdentityInput,
  db: DbHandle = database
): Promise<TypedResult<undefined, Error>> {
  try {
    await db
      .delete(schema.RecordIdentity)
      .where(
        and(
          eq(schema.RecordIdentity.organizationId, input.organizationId),
          eq(schema.RecordIdentity.entityInstanceId, input.entityInstanceId),
          eq(schema.RecordIdentity.source, input.source),
          input.connectionId != null
            ? eq(schema.RecordIdentity.connectionId, input.connectionId)
            : isNull(schema.RecordIdentity.connectionId),
          input.appFieldKey != null
            ? eq(schema.RecordIdentity.appFieldKey, input.appFieldKey)
            : isNull(schema.RecordIdentity.appFieldKey)
        )
      )
    return Result.nil()
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
