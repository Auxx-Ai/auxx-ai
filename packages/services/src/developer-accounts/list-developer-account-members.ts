// packages/services/src/developer-accounts/list-developer-account-members.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { DeveloperAccountError } from './errors'

/**
 * List all members of a developer account with user details
 *
 * @param input - Object containing developer account ID and user ID for access check
 * @returns Result with array of members with user info
 */
export async function listDeveloperAccountMembers(input: {
  developerAccountId: string
  userId: string
}) {
  const { developerAccountId, userId } = input

  // Step 1: Verify the requesting user is a member
  const userMemberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.developerAccountId, developerAccountId), eq(members.userId, userId)),
    }),
    'get-user-member'
  )

  if (userMemberResult.isErr()) {
    return userMemberResult
  }

  const userMember = userMemberResult.value

  if (!userMember) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED',
      message: 'You do not have access to this developer account',
      userId,
      developerAccountId,
    })
  }

  // Step 2: Fetch all members with user info
  const membersResult = await fromDatabase(
    database.query.DeveloperAccountMember.findMany({
      where: (members, { eq }) => eq(members.developerAccountId, developerAccountId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    }),
    'list-developer-account-members'
  )

  if (membersResult.isErr()) {
    return membersResult
  }

  return ok({
    members: membersResult.value,
    userMember,
  })
}
