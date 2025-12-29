// packages/services/src/developer-accounts/update-developer-account.ts

import { database, DeveloperAccount } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { DeveloperAccountError } from './errors'
import { eq } from 'drizzle-orm'

/**
 * Update a developer account
 *
 * @param input - Object containing developer account ID, user ID, and update data
 * @returns Result with updated account
 */
export async function updateDeveloperAccount(input: {
  developerAccountId: string
  userId: string
  data: {
    title?: string
    logoId?: string
    logoUrl?: string
  }
}) {
  const { developerAccountId, userId, data } = input

  // Step 1: Verify developer account exists and user has access
  const accountResult = await fromDatabase(
    database.query.DeveloperAccount.findFirst({
      where: (accounts, { eq }) => eq(accounts.id, developerAccountId),
      with: {
        members: {
          where: (members, { eq }) => eq(members.userId, userId),
        },
      },
    }),
    'get-developer-account'
  )

  if (accountResult.isErr()) {
    return accountResult
  }

  const account = accountResult.value

  if (!account) {
    return err({
      code: 'DEVELOPER_ACCOUNT_NOT_FOUND' as const,
      message: 'Developer account not found',
      slug: '',
    })
  }

  // Step 2: Check user membership
  if (!account.members || account.members.length === 0) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED' as const,
      message: 'You do not have access to this developer account',
      userId,
      developerAccountId,
    })
  }

  // Step 3: Update developer account
  const updateResult = await fromDatabase(
    database
      .update(DeveloperAccount)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(DeveloperAccount.id, developerAccountId))
      .returning(),
    'update-developer-account'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedAccount] = updateResult.value

  if (!updatedAccount) {
    return err({
      code: 'DEVELOPER_ACCOUNT_UPDATE_FAILED' as const,
      message: 'Failed to update developer account',
      developerAccountId,
    })
  }

  return ok(updatedAccount)
}
