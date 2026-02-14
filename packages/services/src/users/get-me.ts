// apps/api/src/services/users/get-me.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { DatabaseError } from '../shared/errors'
import { fromDatabase } from '../shared/utils'

/**
 * Parameters accepted by getMe for fetching the authenticated user profile.
 */
export interface GetMeParams {
  /** Identifier of the user to load */
  userId: string
}

/**
 * Shape of the organization membership entries attached to the me payload.
 */
export type MeMembership = typeof schema.OrganizationMember.$inferSelect

/**
 * Shape of the organization entries attached to the me payload.
 */
export type MeOrganization = typeof schema.Organization.$inferSelect

/**
 * Resolved user payload returned by getMe.
 */
export type GetMeSuccess = typeof schema.User.$inferSelect & {
  /** Organization membership records associated with the user */
  memberships: MeMembership[]
  /** Organizations the user belongs to */
  organizations: MeOrganization[]
}

/**
 * Error union produced by getMe.
 */
export type GetMeError =
  | DatabaseError
  | {
      /** Machine-readable code for routing to HTTP status */
      code: 'NOT_FOUND'
      /** Human readable description */
      message: string
      /** Identifier for the missing user */
      userId: string
    }

/**
 * Load the authenticated user's profile enriched with memberships and organizations.
 */
export async function getMe(params: GetMeParams): Promise<Result<GetMeSuccess, GetMeError>> {
  const { userId } = params

  // Fetch user record from database
  const userResult = await fromDatabase(
    database.select().from(schema.User).where(eq(schema.User.id, userId)).limit(1),
    'get-me-user'
  )

  if (userResult.isErr()) {
    return err(userResult.error)
  }

  const [user] = userResult.value

  if (!user) {
    return err({
      code: 'NOT_FOUND',
      message: 'User not found',
      userId,
    })
  }

  // Fetch organization memberships (with organization details)
  const membershipsResult = await fromDatabase(
    database.query.OrganizationMember.findMany({
      where: (members, { eq: memberEq }) => memberEq(members.userId, userId),
      with: {
        organization: true,
      },
    }),
    'get-me-organization-memberships'
  )

  if (membershipsResult.isErr()) {
    return err(membershipsResult.error)
  }

  const membershipsWithOrg = membershipsResult.value

  const memberships: MeMembership[] = membershipsWithOrg.map(
    ({ organization, ...membership }) => membership
  )

  const organizationsMap = new Map<string, MeOrganization>()
  for (const membership of membershipsWithOrg) {
    if (membership.organization) {
      organizationsMap.set(membership.organization.id, membership.organization)
    }
  }

  const organizations: MeOrganization[] = Array.from(organizationsMap.values())

  return ok({
    ...user,
    memberships,
    organizations,
  })
}
