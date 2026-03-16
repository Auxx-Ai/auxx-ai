// packages/lib/src/cache/providers/user-memberships-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'
import type { UserMembership } from '../user-cache-keys'

/** Computes all memberships for a user */
export const userMembershipsProvider: CacheProvider<UserMembership[]> = {
  async compute(userId, db) {
    const memberships = await db
      .select({
        id: schema.OrganizationMember.id,
        userId: schema.OrganizationMember.userId,
        organizationId: schema.OrganizationMember.organizationId,
        role: schema.OrganizationMember.role,
        status: schema.OrganizationMember.status,
      })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.userId, userId))

    return memberships
  },
}
