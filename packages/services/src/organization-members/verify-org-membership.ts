// packages/services/src/organization-members/verify-org-membership.ts

import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { OrganizationMemberError } from './errors'

/**
 * Verify that a user is an active member of an organization, by organization id.
 *
 * The id-keyed counterpart to `verifyOrganizationAccess` (which keys off a
 * handle). Both reject disabled organizations, so a caller cannot gain access to
 * a disabled tenant by addressing it by id instead of by handle.
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

  // One query, joined so `disabledAt` is checked without a second round trip.
  const dbResult = await fromDatabase(
    database.query.Organization.findFirst({
      where: (orgs, { eq }) => eq(orgs.id, organizationId),
      with: {
        members: {
          where: (members, { eq }) => eq(members.userId, userId),
        },
      },
    }),
    'verify-org-membership'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const organization = dbResult.value

  // Organization not found
  if (!organization) {
    return err({
      code: 'ORGANIZATION_NOT_FOUND' as const,
      message: `Organization ${organizationId} not found`,
      organizationId,
    })
  }

  // Organization is disabled — no member of a disabled org has access.
  if (organization.disabledAt) {
    return err({
      code: 'ORG_DISABLED' as const,
      message: organization.disabledReason || 'This organization has been disabled',
      organizationId,
      disabledReason: organization.disabledReason,
    })
  }

  const member = organization.members?.[0]

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
