// packages/services/src/apps/list-apps-for-user.ts

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { AppError } from './errors'

/**
 * List all apps for a user (across all their developer accounts)
 *
 * @param input - Object containing the user ID
 * @returns Result with array of apps with full data
 */
export async function listAppsForUser(input: { userId: string }) {
  const { userId } = input

  // Step 1: Get all developer account IDs for this user
  const membershipsResult = await fromDatabase(
    database.query.DeveloperAccountMember.findMany({
      where: (members, { eq }) => eq(members.userId, userId),
      columns: {
        developerAccountId: true,
      },
    }),
    'get-user-memberships'
  )

  if (membershipsResult.isErr()) {
    return membershipsResult
  }

  const accountIds = membershipsResult.value.map((m) => m.developerAccountId)

  // If user has no developer accounts, return empty array
  if (accountIds.length === 0) {
    return ok({ apps: [] })
  }

  // Step 2: Fetch all apps for these accounts with full data
  const appsResult = await fromDatabase(
    database.query.App.findMany({
      where: (apps, { inArray }) => inArray(apps.developerAccountId, accountIds),
    }),
    'list-apps-for-user'
  )

  if (appsResult.isErr()) {
    return appsResult
  }

  return ok({ apps: appsResult.value })
}
