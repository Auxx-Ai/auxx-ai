// packages/services/src/apps/update-app.ts

import { App, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { AppError } from './errors'

/**
 * Update app details
 *
 * @param input - Object containing app ID, user ID, and update data
 * @returns Result with updated app or error
 */
export async function updateApp(input: {
  appId: string
  userId: string
  data: Partial<{
    title: string
    description: string
    category: string
    overview: string
    contentOverview: string
    contentHowItWorks: string
    contentConfigure: string
    websiteUrl: string
    documentationUrl: string
    contactUrl: string
    supportSiteUrl: string
    termsOfServiceUrl: string
    hasOauth: boolean
    avatarId: string
    avatarUrl: string
    screenshots: string[]
  }>
}) {
  const { appId, userId, data } = input

  // Step 1: Get app and verify it exists
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
    }),
    'get-app'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: 'App not found',
      appSlug: appId, // Using appId as identifier since we don't have slug
    })
  }

  // Step 2: Verify user is a member of the developer account
  const memberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.developerAccountId, app.developerAccountId), eq(members.userId, userId)),
    }),
    'check-member-access'
  )

  if (memberResult.isErr()) {
    return memberResult
  }

  const member = memberResult.value

  if (!member) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED' as const,
      message: 'You do not have permission to update this app',
      userId,
      appId,
    })
  }

  // Step 3: Build update data (only include provided fields)
  const updateData: Record<string, unknown> = {
    ...data,
    updatedAt: new Date(),
  }

  // Step 4: Update app
  const updateResult = await fromDatabase(
    database.update(App).set(updateData).where(eq(App.id, appId)).returning(),
    'update-app'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedApp] = updateResult.value

  if (!updatedApp) {
    return err({
      code: 'APP_UPDATE_FAILED' as const,
      message: 'Failed to update app',
      appId,
    })
  }

  return ok({ app: updatedApp })
}
