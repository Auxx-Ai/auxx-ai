// packages/lib/src/accounting/connect-and-go/provider-accounts-to-create.ts

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { listAccountIdentities } from '../providers/account-identities'
import type { ProviderAccountToCreate } from './client'

/** Our live accounts with no provider link and no suggestion: what Finish creates in the provider. */
export async function listProviderAccountsToCreate(
  db: Database,
  organizationId: string
): Promise<Result<ProviderAccountToCreate[], Error>> {
  const identities = await listAccountIdentities(db, organizationId)
  if (identities.isErr()) return err(identities.error)
  return ok(
    identities.value.rows
      .filter((row) => !row.providerAccountId && !row.suggestion && !row.account.isArchived)
      .map((row) => ({
        glAccountId: row.account.id,
        name: row.account.name,
        code: row.account.code ?? null,
      }))
  )
}
