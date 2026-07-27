// server/email/permissions.ts

import { TRPCError } from '@trpc/server'

interface SessionUser {
  id: string
  defaultOrganizationId?: string | null
  email?: string
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
