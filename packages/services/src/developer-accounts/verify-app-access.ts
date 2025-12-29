// apps/api/src/services/developer-accounts/verify-app-access.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared'
// import type { DeveloperAccountError } from './errors'

// import type { DeveloperAccountError } from '../../lib/errors'
// import { fromDatabase } from '../../lib/utils'

/**
 * Verify that a user has access to an app through developer account membership
 *
 * @param params - Object containing appId and userId
 * @returns Result with app and member data or an error
 */
export async function verifyAppAccess(params: { appId: string; userId: string }) {
  const { appId, userId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
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
    'verify-app-access'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const app = dbResult.value

  // App not found
  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: `App not found: ${appId}`,
      appId,
    })
  }

  // No member access
  if (!app.developerAccount.members || app.developerAccount.members.length === 0) {
    return err({
      code: 'ACCESS_DENIED' as const,
      message: `User ${userId} does not have access to app ${appId}`,
      userId,
      appId,
    })
  }

  // Success
  return ok({
    app,
    member: app.developerAccount.members[0]!,
  })
}
