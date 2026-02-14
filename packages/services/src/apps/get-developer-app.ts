// packages/services/src/apps/get-developer-app.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { AppError } from './errors'

/**
 * Get app by slug with developer account access verification
 *
 * @param input - Object containing slug and userId
 * @returns Result with app data or error
 */
export async function getDeveloperApp(input: { slug: string; userId: string }) {
  const { slug, userId } = input

  // Query app with developer account and membership
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, slug),
      with: {
        developerAccount: {
          with: {
            members: {
              where: (members, { eq }) => eq(members.userId, userId),
            },
          },
        },
      },
    }),
    'get-developer-app'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  // App not found
  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: 'App not found',
      appSlug: slug,
    })
  }

  // Check if user is a member of the developer account
  if (!app.developerAccount.members || app.developerAccount.members.length === 0) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED' as const,
      message: 'You do not have access to this app',
      userId,
      appId: app.id,
    })
  }

  return ok(app)
}
