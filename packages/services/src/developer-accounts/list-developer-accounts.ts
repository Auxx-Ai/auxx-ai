// packages/services/src/developer-accounts/list-developer-accounts.ts

import { database, DeveloperAccount, DeveloperAccountMember } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { DeveloperAccountError } from './errors'

/**
 * List all developer accounts for a user
 *
 * @param input - Object containing the user ID
 * @returns Result with array of developer accounts with member info
 */
export async function listDeveloperAccounts(input: { userId: string }) {
  const { userId } = input

  const result = await fromDatabase(
    database
      .select({
        account: DeveloperAccount,
        member: DeveloperAccountMember,
      })
      .from(DeveloperAccount)
      .innerJoin(
        DeveloperAccountMember,
        eq(DeveloperAccount.id, DeveloperAccountMember.developerAccountId)
      )
      .where(eq(DeveloperAccountMember.userId, userId)),
    'list-developer-accounts'
  )

  if (result.isErr()) {
    return result
  }

  const accounts = result.value.map((row) => ({
    ...row.account,
    memberAccessLevel: row.member.accessLevel,
    memberCreatedAt: row.member.createdAt,
  }))

  return ok({ accounts })
}
