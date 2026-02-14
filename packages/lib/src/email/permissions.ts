// server/email/permissions.ts

import { database as db } from '@auxx/database'
import { OrganizationRole } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { MemberService } from '../members/member-service'

const logger = createScopedLogger('permissions')
interface SessionUser {
  id: string
  defaultOrganizationId?: string | null
  email?: string
}
/**
 * Checks if a user has admin permissions within an organization.
 *
 * This function verifies if a user has ADMIN or OWNER role for a specific organization.
 * It queries the organization member record from the database and checks the role.
 *
 * @param userId - The unique identifier of the user
 * @param organizationId - The unique identifier of the organization
 * @returns A promise that resolves to a boolean indicating if the user has admin permissions
 * @throws Catches and logs any errors that occur during database operations, returning false
 */
async function checkIsAdmin(userId: string, organizationId: string): Promise<boolean> {
  try {
    const membership = await MemberService.getMembership(userId, organizationId, db)
    if (!membership) {
      return false
    }
    return membership.role === OrganizationRole.ADMIN || membership.role === OrganizationRole.OWNER
  } catch (error) {
    logger.error('Error checking admin permissions:', { error })
    return false
  }
}
/**
 * Requires administrator access for a user in an organization.
 *
 * This function checks if a user has admin permissions in a specific organization.
 * If the user is not an admin, it throws a TRPC Forbidden error.
 *
 * @param userId - The ID of the user to check for admin permissions
 * @param organizationId - The ID of the organization to check permissions against
 * @throws {TRPCError} With code 'FORBIDDEN' if the user is not an admin
 * @returns {Promise<void>} Resolves if the user is an admin, otherwise throws
 */
export async function requireAdminAccess(userId: string, organizationId: string): Promise<void> {
  const isAdmin = await checkIsAdmin(userId, organizationId)
  if (!isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only administrators can perform this action',
    })
  }
}
/**
 * Extracts the user's default organization ID from the session.
 *
 * @param session - The user session object containing user information
 * @param session.user - The user object within the session
 * @returns The default organization ID of the user
 * @throws {TRPCError} - Throws with 'BAD_REQUEST' code if no organization is selected
 */
export function getUserOrganizationId(session: { user: SessionUser }): string {
  const organizationId = session.user.defaultOrganizationId
  if (!organizationId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No organization selected' })
  }
  return organizationId
}
