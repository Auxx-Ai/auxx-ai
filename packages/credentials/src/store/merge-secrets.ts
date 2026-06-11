// packages/credentials/src/store/merge-secrets.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { decryptSecrets, encryptSecrets } from '../crypto'
import { decryptionError, encryptionError, fromDb, notFound } from './internal'
import type { CredentialStoreError } from './types'

/**
 * Partially update a credential's secrets: decrypt → spread `partial` over existing → re-encrypt.
 * `undefined` or `''` values in `partial` keep the existing value (preserves the "blank password
 * field keeps the old value" edit semantics). Org-scoped.
 */
export async function mergeSecrets(
  id: string,
  organizationId: string,
  partial: Record<string, unknown>
): Promise<Result<void, CredentialStoreError>> {
  const rowsResult = await fromDb(
    database
      .select({ encryptedSecrets: schema.Credential.encryptedSecrets })
      .from(schema.Credential)
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .limit(1),
    'merge-secrets-read'
  )
  if (rowsResult.isErr()) return err(rowsResult.error)
  const row = rowsResult.value[0]
  if (!row) return err(notFound(id))

  let existing: Record<string, unknown>
  try {
    existing = decryptSecrets(row.encryptedSecrets)
  } catch {
    return err(decryptionError())
  }

  const merged = { ...existing }
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined || value === '') continue // keep existing
    merged[key] = value
  }

  let encryptedSecrets: string
  try {
    encryptedSecrets = encryptSecrets(merged)
  } catch {
    return err(encryptionError())
  }

  const updateResult = await fromDb(
    database
      .update(schema.Credential)
      .set({ encryptedSecrets, updatedAt: new Date() })
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .returning({ id: schema.Credential.id }),
    'merge-secrets-write'
  )
  if (updateResult.isErr()) return err(updateResult.error)
  if (updateResult.value.length === 0) return err(notFound(id))
  return ok(undefined)
}
