// apps/api/src/services/organizations/verify-organization-access.ts

import { database } from '@auxx/database'
import { err, ok } from 'neverthrow'
// import type { OrganizationError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Verify that a user has access to an organization by handle
 *
 * @param params - Object containing handle and userId
 * @returns Result with organization and member data or an error
 */
export async function verifyOrganizationAccess(params: { handle: string; userId: string }) {
  const { handle, userId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.Organization.findFirst({
      where: (orgs, { eq }) => eq(orgs.handle, handle),
      with: {
        members: {
          where: (members, { eq }) => eq(members.userId, userId),
        },
      },
    }),
    'verify-organization-access'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const org = dbResult.value

  // Organization not found
  if (!org) {
    return err({
      code: 'ORG_NOT_FOUND' as const,
      message: `Organization "${handle}" not found`,
      handle,
    })
  }

  // Organization is disabled
  if (org.disabledAt) {
    return err({
      code: 'ORG_DISABLED' as const,
      message: org.disabledReason || 'This organization has been disabled',
      handle,
      disabledReason: org.disabledReason,
    })
  }

  // User is not a member
  const member = org.members?.[0]
  if (!member) {
    return err({
      code: 'ORG_ACCESS_DENIED' as const,
      message: `You do not have access to organization "${handle}"`,
      userId,
      handle,
    })
  }

  // Success
  return ok({
    organization: org,
    member,
  })
}
