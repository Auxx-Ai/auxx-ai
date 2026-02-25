// packages/lib/src/members/member-queries.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import type { OrganizationMemberInfo } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'

/** Find membership for a user within an organization */
export async function findMemberByUser(
  organizationId: string,
  userId: string,
  db: Database = defaultDb
): Promise<OrganizationMemberInfo | null> {
  const [row] = await db
    .select({
      id: schema.OrganizationMember.id,
      userId: schema.OrganizationMember.userId,
      organizationId: schema.OrganizationMember.organizationId,
      role: schema.OrganizationMember.role,
      status: schema.OrganizationMember.status,
    })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.userId, userId)
      )
    )
    .limit(1)
  return (row as OrganizationMemberInfo) ?? null
}

/** Check if a user is OWNER or ADMIN within an organization */
export async function isAdminOrOwner(
  organizationId: string,
  userId: string,
  db: Database = defaultDb
): Promise<boolean> {
  const member = await findMemberByUser(organizationId, userId, db)
  return member?.role === 'OWNER' || member?.role === 'ADMIN'
}

/** List members with basic user info, optionally filtered by name/email */
export async function listMembersWithUser(
  organizationId: string,
  opts: { nameOrEmailContains?: string; limit?: number } = {},
  db: Database = defaultDb
): Promise<
  Array<
    OrganizationMemberInfo & {
      user: { id: string; name: string | null; email: string | null; image: string | null }
    }
  >
> {
  let q = db
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
      },
    })
    .from(schema.OrganizationMember)
    .leftJoin(schema.User, eq(schema.User.id, schema.OrganizationMember.userId))
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .$dynamic()

  if (opts.limit) q = q.limit(opts.limit)
  const rows = await q

  if (!opts.nameOrEmailContains) return rows as any

  const needle = opts.nameOrEmailContains.toLowerCase()
  return rows.filter(
    (r: any) =>
      (r.user?.name || '').toLowerCase().includes(needle) ||
      (r.user?.email || '').toLowerCase().includes(needle)
  ) as any
}
