// packages/lib/src/cache/providers/group-members-provider.ts

import { schema } from '@auxx/database'
import { MemberType } from '@auxx/database/enums'
import { and, eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes the userId → groupInstanceIds projection for an organization.
 *
 * `EntityGroupMember` has no organizationId column, so edges are attributed to
 * the org via the group's `EntityInstance` row. Archived groups are NOT
 * filtered — the raw queries this cache replaces never filtered them either.
 */
export const groupMembersProvider: CacheProvider<Record<string, string[]>> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        userId: schema.EntityGroupMember.memberRefId,
        groupId: schema.EntityGroupMember.groupInstanceId,
      })
      .from(schema.EntityGroupMember)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.EntityGroupMember.groupInstanceId, schema.EntityInstance.id)
      )
      .where(
        and(
          eq(schema.EntityGroupMember.memberType, MemberType.user),
          eq(schema.EntityInstance.organizationId, orgId)
        )
      )

    const map: Record<string, string[]> = {}
    for (const row of rows) {
      ;(map[row.userId] ??= []).push(row.groupId)
    }
    return map
  },
}
