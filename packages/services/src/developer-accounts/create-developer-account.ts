// packages/services/src/developer-accounts/create-developer-account.ts

import { DeveloperAccount, DeveloperAccountMember, database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { DeveloperAccountError } from './errors'

/**
 * Create a new developer account with admin membership
 *
 * @param input - Object containing user info and account data
 * @returns Result with created account and member
 */
export async function createDeveloperAccount(input: {
  userId: string
  userEmail: string
  slug: string
  title: string
  logoId?: string
}) {
  const { userId, userEmail, slug, title, logoId } = input

  // Step 1: Check if slug already exists
  const existingResult = await fromDatabase(
    database.query.DeveloperAccount.findFirst({
      where: (accounts, { eq }) => eq(accounts.slug, slug),
      columns: {
        id: true,
      },
    }),
    'check-slug-exists'
  )

  if (existingResult.isErr()) {
    return existingResult
  }

  const existing = existingResult.value

  if (existing) {
    return err({
      code: 'DEVELOPER_ACCOUNT_SLUG_TAKEN' as const,
      message: 'This slug is already taken',
      slug,
    })
  }

  // Step 2: Generate logo URL if logoId provided
  const logoUrl = logoId ? `https://cdn.auxx.ai/logos/${logoId}` : null

  // Step 3: Create developer account
  const createAccountResult = await fromDatabase(
    database
      .insert(DeveloperAccount)
      .values({
        slug,
        title,
        logoId,
        logoUrl,
      })
      .returning(),
    'create-developer-account'
  )

  if (createAccountResult.isErr()) {
    return createAccountResult
  }

  const [account] = createAccountResult.value

  if (!account) {
    return err({
      code: 'DEVELOPER_ACCOUNT_CREATE_FAILED' as const,
      message: 'Failed to create developer account',
    })
  }

  // Step 4: Create admin membership for current user
  const createMemberResult = await fromDatabase(
    database
      .insert(DeveloperAccountMember)
      .values({
        developerAccountId: account.id,
        userId,
        emailAddress: userEmail,
        accessLevel: 'admin',
      })
      .returning(),
    'create-admin-membership'
  )

  if (createMemberResult.isErr()) {
    return createMemberResult
  }

  const [member] = createMemberResult.value

  if (!member) {
    return err({
      code: 'DEVELOPER_ACCOUNT_CREATE_FAILED' as const,
      message: 'Failed to create membership',
    })
  }

  return ok({ account, member })
}
