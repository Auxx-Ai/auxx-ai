// apps/api/src/services/organization-members/list-user-organizations.ts

import { database } from '@auxx/database'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * List all organizations where the user is a member
 *
 * @param params - Object containing userId
 * @returns Result with array of organizations or an error
 */
export async function listUserOrganizations(params: { userId: string }) {
  const { userId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.OrganizationMember.findMany({
      where: (members, { eq }) => eq(members.userId, userId),
      with: {
        organization: true,
      },
    }),
    'list-user-organizations'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const members = dbResult.value

  // Transform to organization data
  const organizations = members
    .filter((m) => m.organization)
    .map((m) => ({
      id: m.organization.id,
      handle: m.organization.handle,
      name: m.organization.name,
      logoUrl: null,
    }))

  // Success
  return ok(organizations)
}
