// packages/lib/src/sidebar-layout/node-reads.ts
// DB reads of SidebarNode. No cache imports: the userSidebar cache provider calls this.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { toSidebarNodeEntity } from './to-sidebar-node'
import type { SidebarNodeEntity } from './types'

/** Every node of a user in one org, in `(sortOrder, id)` order. Backs the `userSidebar` user cache. */
export async function listSidebarNodes(
  db: Database | Transaction,
  userId: string,
  organizationId: string
): Promise<SidebarNodeEntity[]> {
  const rows = await db
    .select()
    .from(schema.SidebarNode)
    .where(
      and(
        eq(schema.SidebarNode.userId, userId),
        eq(schema.SidebarNode.organizationId, organizationId)
      )
    )
    .orderBy(asc(schema.SidebarNode.sortOrder), asc(schema.SidebarNode.id))
  return rows.map(toSidebarNodeEntity)
}

/** Every node of one membership; the write path scopes by member, not by user. */
export async function listMemberSidebarNodes(
  db: Database | Transaction,
  organizationMemberId: string
): Promise<SidebarNodeEntity[]> {
  const rows = await db
    .select()
    .from(schema.SidebarNode)
    .where(eq(schema.SidebarNode.organizationMemberId, organizationMemberId))
    .orderBy(asc(schema.SidebarNode.sortOrder), asc(schema.SidebarNode.id))
  return rows.map(toSidebarNodeEntity)
}
