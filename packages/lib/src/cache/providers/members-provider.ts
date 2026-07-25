// packages/lib/src/cache/providers/members-provider.ts

import { schema } from '@auxx/database'
import type { UserType } from '@auxx/database/types'
import { eq } from 'drizzle-orm'
import type { MemberRoleEntry, OrgMemberInfo } from '../org-cache-keys'
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
        seatType: schema.OrganizationMember.seatType,
        status: schema.OrganizationMember.status,
        onChatDuty: schema.OrganizationMember.onChatDuty,
        permissionProfileId: schema.OrganizationMember.permissionProfileId,
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

/**
 * Derives `userId → { role, seatType, userType, permissionProfileId }` from
 * members (computed independently for independent invalidation).
 *
 * `userType` rides along so capability composition can branch on AGENT members
 * without a second read (`composeUserCapabilities` uses SET-semantics over an
 * all-Full base for agents — see capability layer v2 §0.2). The `User` join is a
 * LEFT join, so a member row with no user row falls back to `'USER'`.
 *
 * `permissionProfileId` rides along for the same reason (doc 19 §8.1): the human
 * composer resolves the member's base profile (and, when null, the system
 * template for `(role, seatType)`) on every request, so it must be free.
 */
export const memberRoleMapProvider: CacheProvider<Record<string, MemberRoleEntry>> = {
  async compute(orgId, db) {
    const members = await membersProvider.compute(orgId, db)
    const map: Record<string, MemberRoleEntry> = {}
    for (const m of members) {
      map[m.userId] = {
        role: m.role,
        seatType: m.seatType,
        userType: (m.user?.userType as UserType | undefined) ?? 'USER',
        permissionProfileId: m.permissionProfileId ?? null,
      }
    }
    return map
  },
}
