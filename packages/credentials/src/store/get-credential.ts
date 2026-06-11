// packages/credentials/src/store/get-credential.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, notFound, toRecord } from './internal'
import type { CredentialRecord, CredentialStoreError } from './types'

/**
 * Fetch a single credential by id, scoped to its org. Returns the record WITHOUT secrets
 * (`metadata` is the non-sensitive companion data). A row under another org returns
 * CREDENTIAL_NOT_FOUND, never data.
 */
export async function getCredential(
  id: string,
  organizationId: string
): Promise<Result<CredentialRecord, CredentialStoreError>> {
  const rowsResult = await fromDb(
    database
      .select()
      .from(schema.Credential)
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .limit(1),
    'get-credential'
  )

  if (rowsResult.isErr()) return err(rowsResult.error)
  const row = rowsResult.value[0]
  if (!row) return err(notFound(id))
  return ok(toRecord(row as never))
}
