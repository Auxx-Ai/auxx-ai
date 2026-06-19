// packages/credentials/src/store/find-credential.ts

import { database, schema } from '@auxx/database'
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, toRecord } from './internal'
import type { CredentialKind, CredentialRecord, CredentialStoreError } from './types'

export interface FindCredentialInput {
  organizationId: string
  kind: CredentialKind
  type?: string
  appId?: string
  mcpServerId?: string
  /**
   * `null` → match org-scoped rows (`userId IS NULL`); a string → that user; key omitted →
   * don't filter on userId at all.
   */
  userId?: string | null
}

/**
 * Find the newest credential matching the given filters, scoped to the org.
 * Ok-wraps `null` when nothing matches so callers can distinguish "absent" from a real error.
 */
export async function findCredential(
  input: FindCredentialInput
): Promise<Result<CredentialRecord | null, CredentialStoreError>> {
  const conditions: SQL[] = [
    eq(schema.Credential.organizationId, input.organizationId),
    eq(schema.Credential.kind, input.kind),
  ]
  if (input.type !== undefined) conditions.push(eq(schema.Credential.type, input.type))
  if (input.appId !== undefined) conditions.push(eq(schema.Credential.appId, input.appId))
  if (input.mcpServerId !== undefined)
    conditions.push(eq(schema.Credential.mcpServerId, input.mcpServerId))
  if ('userId' in input) {
    conditions.push(
      input.userId === null
        ? isNull(schema.Credential.userId)
        : eq(schema.Credential.userId, input.userId as string)
    )
  }

  const rowsResult = await fromDb(
    database
      .select()
      .from(schema.Credential)
      // Primary first (record-action resolution prefers the org's chosen primary when an
      // app has >1 connection — by method or account), newest as tiebreak. `isDefault`
      // defaults false, so this is a no-op ordering for every non-app/unprimaried lookup.
      .where(and(...conditions))
      .orderBy(desc(schema.Credential.isDefault), desc(schema.Credential.createdAt))
      .limit(1),
    'find-credential'
  )

  if (rowsResult.isErr()) return err(rowsResult.error)
  const row = rowsResult.value[0]
  return ok(row ? toRecord(row as never) : null)
}
