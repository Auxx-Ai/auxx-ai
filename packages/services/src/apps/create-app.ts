// packages/services/src/apps/create-app.ts

import { database, App } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { AppError } from './errors'

/**
 * Create a new app under a developer account
 *
 * @param input - Object containing developer account slug, user ID, and app data
 * @returns Result with created app or error
 */
export async function createApp(input: {
  developerAccountSlug: string
  userId: string
  id?: string
  slug: string
  title: string
  avatarId?: string
}) {
  const { developerAccountSlug, userId, id, slug, title, avatarId } = input

  // Step 1: Get developer account
  const accountResult = await fromDatabase(
    database.query.DeveloperAccount.findFirst({
      where: (accounts, { eq }) => eq(accounts.slug, developerAccountSlug),
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
      slug: developerAccountSlug,
    })
  }

  // Step 2: Check if user is a member with admin access
  const memberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(
          eq(members.developerAccountId, account.id),
          eq(members.userId, userId),
          eq(members.accessLevel, 'admin')
        ),
    }),
    'check-admin-member'
  )

  if (memberResult.isErr()) {
    return memberResult
  }

  const member = memberResult.value

  if (!member) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED' as const,
      message: 'Admin access required to create apps',
      userId,
      developerAccountId: account.id,
      requiredLevel: 'admin',
    })
  }

  // Step 3: Check if app slug already exists
  const existingResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, slug),
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
      code: 'APP_SLUG_TAKEN' as const,
      message: 'This app slug is already taken',
      slug,
    })
  }

  // Step 4: Generate avatar URL if avatarId provided
  const avatarUrl = avatarId ? `https://cdn.auxx.ai/avatars/${avatarId}` : null

  // Step 5: Create app
  const createResult = await fromDatabase(
    database
      .insert(App)
      .values({
        id,
        developerAccountId: account.id,
        slug,
        title,
        avatarId,
        avatarUrl,
      })
      .returning(),
    'create-app'
  )

  if (createResult.isErr()) {
    return createResult
  }

  const [app] = createResult.value

  if (!app) {
    return err({
      code: 'APP_CREATE_FAILED' as const,
      message: 'Failed to create app',
    })
  }

  return ok({ app })
}
