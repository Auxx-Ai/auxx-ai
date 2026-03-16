// packages/lib/src/cache/providers/members-provider.ts

import { schema } from '@auxx/database'
import type { OrganizationRole } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import type { OrgMemberInfo } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes all org members with joined user info */
export const membersProvider: CacheProvider<OrgMemberInfo[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        id: schema.OrganizationMember.id,
        userId: schema.OrganizationMember.userId,
        organizationId: schema.OrganizationMember.organizationId,
        role: schema.OrganizationMember.role,
        status: schema.OrganizationMember.status,
        user: {
          id: schema.User.id,
          name: schema.User.name,
          email: schema.User.email,
          image: schema.User.image,
          userType: schema.User.userType,
        },
      })
      .from(schema.OrganizationMember)
      .leftJoin(schema.User, eq(schema.User.id, schema.OrganizationMember.userId))
      .where(eq(schema.OrganizationMember.organizationId, orgId))

    return rows as OrgMemberInfo[]
  },
}

/** Derives userId → role map from members (computed independently for independent invalidation) */
export const memberRoleMapProvider: CacheProvider<Record<string, OrganizationRole>> = {
  async compute(orgId, db) {
    const members = await membersProvider.compute(orgId, db)
    const map: Record<string, OrganizationRole> = {}
    for (const m of members) {
      map[m.userId] = m.role
    }
    return map
  },
}
