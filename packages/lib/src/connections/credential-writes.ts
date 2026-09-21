// packages/lib/src/connections/credential-writes.ts
// The `Credential` writes a caller outside `connections/`/`credentials/` may need.
// The decrypting store (`@auxx/credentials/store`) owns everything secret-bearing;
// this file owns the non-secret bookkeeping columns.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull, ne } from 'drizzle-orm'

/**
 * Make `credentialId` the org's default connection for `appId`: clear the flag on the
 * other org-scoped (`userId IS NULL`) credentials of that app, then set it here.
 *
 * Takes a `Transaction` because the callers that pick a default do it as part of a
 * larger commit — `@auxx/credentials/store`'s {@link setDefaultCredential} opens its own
 * on the global `database` and so cannot be used from inside one.
 */
export async function setDefaultAppCredential(
  tx: Database | Transaction,
  organizationId: string,
  input: { appId: string; credentialId: string }
): Promise<void> {
  await tx
    .update(schema.Credential)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.Credential.organizationId, organizationId),
        eq(schema.Credential.appId, input.appId),
        isNull(schema.Credential.userId),
        ne(schema.Credential.id, input.credentialId)
      )
    )
  await tx
    .update(schema.Credential)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.Credential.organizationId, organizationId),
        eq(schema.Credential.id, input.credentialId)
      )
    )
}
