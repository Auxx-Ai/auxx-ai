// packages/credentials/src/store/delete-credential.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, notFound } from './internal'
import type { CredentialStoreError } from './types'

/**
 * Delete a credential by id, org-scoped. Unconditional — domain guards (e.g. the workflow
 * usage check) live with the domains, not here.
 */
export async function deleteCredential(
  id: string,
  organizationId: string
): Promise<Result<void, CredentialStoreError>> {
  const deleteResult = await fromDb(
    database
      .delete(schema.Credential)
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .returning({ id: schema.Credential.id }),
    'delete-credential'
  )

  if (deleteResult.isErr()) return err(deleteResult.error)
  if (deleteResult.value.length === 0) return err(notFound(id))
  return ok(undefined)
}
