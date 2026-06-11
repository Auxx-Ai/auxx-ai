// packages/credentials/src/store/rotate-secrets.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { encryptSecrets } from '../crypto'
import { encryptionError, fromDb, notFound } from './internal'
import type { CredentialStoreError } from './types'

/**
 * Fully replace a credential's secrets (OAuth refresh, reconnect). Optionally update `expiresAt`.
 * Org-scoped; a row under another org is a no-op that returns CREDENTIAL_NOT_FOUND.
 */
export async function rotateSecrets(
  id: string,
  organizationId: string,
  secrets: Record<string, unknown>,
  options?: { expiresAt?: Date | null }
): Promise<Result<void, CredentialStoreError>> {
  let encryptedSecrets: string
  try {
    encryptedSecrets = encryptSecrets(secrets)
  } catch {
    return err(encryptionError())
  }

  const set: Record<string, unknown> = { encryptedSecrets, updatedAt: new Date() }
  if (options && 'expiresAt' in options) set.expiresAt = options.expiresAt ?? null

  const updateResult = await fromDb(
    database
      .update(schema.Credential)
      .set(set)
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .returning({ id: schema.Credential.id }),
    'rotate-secrets'
  )

  if (updateResult.isErr()) return err(updateResult.error)
  if (updateResult.value.length === 0) return err(notFound(id))
  return ok(undefined)
}
