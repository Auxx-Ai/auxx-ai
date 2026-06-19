// packages/credentials/src/store/set-default-credential.ts

import { database, schema } from '@auxx/database'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, notFound } from './internal'
import type { CredentialStoreError } from './types'

/**
 * Make `credentialId` the primary org-scoped app connection — the one record actions (and other
 * unbound, org-global resolvers) use when an app has more than one connection (§4a). In one
 * transaction: clear the current primary for the same (org, app) org-scoped rows, then set the
 * chosen. Only org-scoped (`userId IS NULL`) app credentials are eligible; a personal or non-app
 * credential is rejected. The partial unique index backstops a double-set.
 */
export async function setDefaultCredential(
  credentialId: string,
  organizationId: string
): Promise<Result<void, CredentialStoreError>> {
  const target = await fromDb(
    database.query.Credential.findFirst({
      where: and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      ),
      columns: { id: true, appId: true, userId: true, kind: true },
    }),
    'set-default-credential:find'
  )
  if (target.isErr()) return err(target.error)
  const cred = target.value
  if (!cred) return err(notFound(credentialId))
  if (cred.kind !== 'app' || !cred.appId || cred.userId !== null) {
    return err({
      code: 'DATABASE_ERROR',
      message: 'Only org-scoped app connections can be made primary',
    })
  }
  const appId = cred.appId

  const txResult = await fromDb(
    database.transaction(async (tx) => {
      await tx
        .update(schema.Credential)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.Credential.organizationId, organizationId),
            eq(schema.Credential.appId, appId),
            eq(schema.Credential.kind, 'app'),
            isNull(schema.Credential.userId),
            ne(schema.Credential.id, credentialId)
          )
        )
      await tx
        .update(schema.Credential)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.Credential.id, credentialId))
    }),
    'set-default-credential:tx'
  )
  if (txResult.isErr()) return err(txResult.error)
  return ok(undefined)
}
