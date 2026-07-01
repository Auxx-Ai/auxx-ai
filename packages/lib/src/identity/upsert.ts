// packages/lib/src/identity/upsert.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import type { RecordIdentityEntity } from '@auxx/database/types'
import { and, eq, isNull } from 'drizzle-orm'
import { Result, type TypedResult } from '../result'
import type { UpsertRecordIdentityInput } from './types'

type DbHandle = Database | Transaction

/**
 * Idempotent insert-or-update on the record+kind unique key
 * `(entityInstanceId, source, connectionId, appFieldKey)` — "this record's
 * identity of this kind is X". Explicit select-then-write rather than a
 * DB-level upsert: the unique indexes are COALESCE expressions (to treat
 * NULL connectionId/appFieldKey as a real dedupe value), which Drizzle's
 * `onConflictDoUpdate` target can't address.
 *
 * Can fail with a unique-key violation on `RecordIdentity_identity_key` if a
 * *different* record already holds this identity value — surfaced as an
 * error rather than silently overwritten, since that signals two records
 * claiming the same external id.
 */
export async function upsertRecordIdentity(
  input: UpsertRecordIdentityInput,
  db: DbHandle = database
): Promise<TypedResult<RecordIdentityEntity, Error>> {
  try {
    const existing = await db.query.RecordIdentity.findFirst({
      where: and(
        eq(schema.RecordIdentity.organizationId, input.organizationId),
        eq(schema.RecordIdentity.entityInstanceId, input.entityInstanceId),
        eq(schema.RecordIdentity.source, input.source),
        input.connectionId != null
          ? eq(schema.RecordIdentity.connectionId, input.connectionId)
          : isNull(schema.RecordIdentity.connectionId),
        input.appFieldKey != null
          ? eq(schema.RecordIdentity.appFieldKey, input.appFieldKey)
          : isNull(schema.RecordIdentity.appFieldKey)
      ),
    })

    if (existing) {
      const [updated] = await db
        .update(schema.RecordIdentity)
        .set({
          entityDefinitionId: input.entityDefinitionId,
          appInstallationId: input.appInstallationId ?? null,
          fieldId: input.fieldId ?? null,
          externalId: input.externalId,
          updatedAt: new Date(),
        })
        .where(eq(schema.RecordIdentity.id, existing.id))
        .returning()
      if (!updated) return Result.error(new Error('Failed to update record identity'))
      return Result.ok(updated)
    }

    const [created] = await db
      .insert(schema.RecordIdentity)
      .values({
        organizationId: input.organizationId,
        entityInstanceId: input.entityInstanceId,
        entityDefinitionId: input.entityDefinitionId,
        source: input.source,
        appInstallationId: input.appInstallationId ?? null,
        connectionId: input.connectionId ?? null,
        appFieldKey: input.appFieldKey ?? null,
        fieldId: input.fieldId ?? null,
        externalId: input.externalId,
        updatedAt: new Date(),
      })
      .returning()
    if (!created) return Result.error(new Error('Failed to create record identity'))
    return Result.ok(created)
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
