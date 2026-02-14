// packages/services/src/users/get-user.ts

import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { UserError } from './errors'

/**
 * Get basic user by ID
 *
 * @param input - Object containing user ID
 * @returns Result with user data or error
 */
export async function getUser(input: {
  userId: string
}): Promise<Result<Awaited<ReturnType<typeof database.query.User.findFirst>>, UserError>> {
  const { userId } = input

  const userResult = await fromDatabase(
    database.query.User.findFirst({
      where: (users, { eq }) => eq(users.id, userId),
    }),
    'get-user'
  )

  if (userResult.isErr()) {
    return userResult
  }

  const user = userResult.value

  if (!user) {
    return err({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
      userId,
    })
  }

  return ok(user)
}
