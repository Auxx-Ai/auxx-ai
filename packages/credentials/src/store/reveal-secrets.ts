// packages/credentials/src/store/reveal-secrets.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { decryptSecrets } from '../crypto'
import { decryptionError, fromDb, notFound, toRecord } from './internal'
import type { CredentialRecord, CredentialStoreError } from './types'

/**
 * The ONLY decrypt path. Returns the record plus its decrypted secrets, org-scoped.
 * Callers that need the legacy "full data" shape merge `{ ...record.metadata, ...secrets }`
 * (secrets win on key collisions).
 */
export async function revealSecrets<T = Record<string, unknown>>(
  id: string,
  organizationId: string
): Promise<Result<{ record: CredentialRecord; secrets: T }, CredentialStoreError>> {
  const rowsResult = await fromDb(
    database
      .select()
      .from(schema.Credential)
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .limit(1),
    'reveal-secrets'
  )

  if (rowsResult.isErr()) return err(rowsResult.error)
  const row = rowsResult.value[0] as ({ encryptedSecrets: string } & CredentialRecord) | undefined
  if (!row) return err(notFound(id))

  let secrets: T
  try {
    secrets = decryptSecrets<T>(row.encryptedSecrets)
  } catch {
    return err(decryptionError())
  }

  return ok({ record: toRecord(row as never), secrets })
}
