// packages/services/src/developer-accounts/get-developer-account-first-app.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { DeveloperAccountError } from './errors'

/**
 * Get a developer account by slug with first app
 *
 * @param input - Object containing slug and user ID
 * @returns Result with developer account, member, and first app (or null)
 */
export async function getDeveloperAccountFirstApp(input: { slug: string; userId: string }) {
  const { slug, userId } = input

  // Step 1: Get developer account by slug
  const accountResult = await fromDatabase(
    database.query.DeveloperAccount.findFirst({
      where: (accounts, { eq }) => eq(accounts.slug, slug),
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
      slug,
    })
  }

  // Step 2: Check membership
  const memberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.developerAccountId, account.id), eq(members.userId, userId)),
    }),
    'check-member'
  )

  if (memberResult.isErr()) {
    return memberResult
  }

  const member = memberResult.value

  if (!member) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED' as const,
      message: 'You do not have access to this developer account',
      userId,
      developerAccountId: account.id,
    })
  }

  // Step 3: Get first app for developer account
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.developerAccountId, account.id),
    }),
    'get-first-app'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  return ok({ account, member, app: app ?? null })
}
