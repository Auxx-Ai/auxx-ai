// apps/api/src/services/organization-members/verify-org-membership.ts

import { database } from '@auxx/database'
import { type Result, ok, err } from 'neverthrow'
import type { OrganizationMemberError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Verify that a user is a member of an organization
 *
 * @param params - Object containing userId and organizationId
 * @returns Result with organization member data or an error
 */
export async function verifyOrgMembership(params: {
  userId: string
  organizationId: string
}): Promise<
  Result<
    NonNullable<Awaited<ReturnType<typeof database.query.OrganizationMember.findFirst>>>,
    OrganizationMemberError
  >
> {
  const { userId, organizationId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.OrganizationMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.organizationId, organizationId), eq(members.userId, userId)),
    }),
    'verify-org-membership'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const member = dbResult.value

  // Member not found
  if (!member) {
    return err({
      code: 'NOT_MEMBER' as const,
      message: `User ${userId} is not a member of organization ${organizationId}`,
      userId,
      organizationId,
    })
  }

  // Success
  return ok(member)
}
