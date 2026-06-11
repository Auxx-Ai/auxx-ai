// packages/credentials/src/store/update-credential.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, notFound } from './internal'
import type { CredentialStoreError } from './types'

export interface UpdateCredentialInput {
  name?: string
  label?: string | null
  /** Full replacement of the plaintext metadata bag (callers spread `record.metadata` themselves). */
  metadata?: Record<string, unknown>
  expiresAt?: Date | null
}

/**
 * Update non-secret credential fields. `metadata` is a full replacement — no hidden deep-merge.
 * Org-scoped. Touches no secret material.
 */
export async function updateCredential(
  id: string,
  organizationId: string,
  input: UpdateCredentialInput
): Promise<Result<void, CredentialStoreError>> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = input.name
  if (input.label !== undefined) set.label = input.label
  if (input.metadata !== undefined) set.metadata = input.metadata
  if ('expiresAt' in input) set.expiresAt = input.expiresAt ?? null

  const updateResult = await fromDb(
    database
      .update(schema.Credential)
      .set(set)
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .returning({ id: schema.Credential.id }),
    'update-credential'
  )

  if (updateResult.isErr()) return err(updateResult.error)
  if (updateResult.value.length === 0) return err(notFound(id))
  return ok(undefined)
}
