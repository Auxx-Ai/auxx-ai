// packages/lib/src/members/member-queries.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import type { OrganizationMemberInfo, OrganizationRole } from '@auxx/database/types'
import { and, asc, count, eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'

/** Find membership for a user within an organization (uses org cache) */
export async function findMemberByUser(
  organizationId: string,
  userId: string,
  db?: Database
): Promise<OrganizationMemberInfo | null> {
  // If a specific db instance is passed (e.g. inside a transaction), query directly
  if (db && db !== defaultDb) {
    return findMemberByUserDirect(organizationId, userId, db)
  }

  const { members } = await getOrgCache().getOrRecompute(organizationId, ['members'])
  const member = members.find((m) => m.userId === userId)
  if (!member) return null
  return {
    id: member.id,
    userId: member.userId,
    organizationId: member.organizationId,
    role: member.role,
    seatType: member.seatType,
    status: member.status,
    onChatDuty: member.onChatDuty,
  }
}

/** Check if a user is OWNER or ADMIN within an organization (uses org cache) */
export async function isAdminOrOwner(
  organizationId: string,
  userId: string,
  db?: Database
): Promise<boolean> {
  // If a specific db instance is passed (e.g. inside a transaction), query directly
  if (db && db !== defaultDb) {
    const member = await findMemberByUserDirect(organizationId, userId, db)
    return member?.role === 'OWNER' || member?.role === 'ADMIN'
  }

  const { memberRoleMap } = await getOrgCache().getOrRecompute(organizationId, ['memberRoleMap'])
  const role = memberRoleMap[userId]?.role
  return role === 'OWNER' || role === 'ADMIN'
}

/**
 * Check if a user is an OWNER of the organization (uses org cache). The rank
 * check behind `ownerProcedure` — genuinely rank-shaped actions only (org
 * deletion, ownership transfer; plan 21 §2.b.4), never a capability substitute.
 */
export async function isOwner(
  organizationId: string,
  userId: string,
  db?: Database
): Promise<boolean> {
  if (db && db !== defaultDb) {
    const member = await findMemberByUserDirect(organizationId, userId, db)
    return member?.role === 'OWNER'
  }

  const { memberRoleMap } = await getOrgCache().getOrRecompute(organizationId, ['memberRoleMap'])
  return memberRoleMap[userId]?.role === 'OWNER'
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
      onChatDuty: schema.OrganizationMember.onChatDuty,
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

/** Get the membership record for a user in an organization. */
export async function getMembership(
  userId: string,
  organizationId: string,
  db: Database = defaultDb
) {
  return db.query.OrganizationMember.findFirst({
    where: (om, { and, eq }) => and(eq(om.userId, userId), eq(om.organizationId, organizationId)),
  })
}

/** Check whether a user is a (real, non-system) member of the organization. */
export async function isMember(
  userId: string,
  organizationId: string,
  db?: Database
): Promise<boolean> {
  // If a specific db instance is passed (e.g. inside a transaction), query directly
  if (db && db !== defaultDb) {
    const membership = await getMembership(userId, organizationId, db)
    if (!membership) return false
    const [user] = await db
      .select({ userType: schema.User.userType })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)
    return user?.userType === 'USER'
  }

  // Use org cache — zero DB queries
  const { members } = await getOrgCache().getOrRecompute(organizationId, ['members'])
  const member = members.find((m) => m.userId === userId)
  return !!member && member.user?.userType === 'USER'
}

/** Count of ACTIVE members in an organization. */
export async function getActiveMemberCount(
  organizationId: string,
  db: Database = defaultDb
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.status, 'ACTIVE')
      )
    )
  return row?.value ?? 0
}

/**
 * All members of an organization (excludes system users), sorted by role then
 * name then email.
 */
export async function getOrganizationMembers(organizationId: string, db: Database = defaultDb) {
  const members = await db.query.OrganizationMember.findMany({
    where: eq(schema.OrganizationMember.organizationId, organizationId),
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
        // Exclude system users from member lists
        where: eq(schema.User.userType, 'USER'),
      },
    },
    orderBy: [asc(schema.OrganizationMember.role)],
  })

  const roleOrder: Record<OrganizationRole, number> = { OWNER: 0, ADMIN: 1, USER: 2 }
  return members.sort((a, b) => {
    const roleDifference = roleOrder[a.role] - roleOrder[b.role]
    if (roleDifference !== 0) {
      return roleDifference
    }

    const nameA = a.user?.name?.toLocaleLowerCase() ?? ''
    const nameB = b.user?.name?.toLocaleLowerCase() ?? ''
    if (nameA !== nameB) {
      return nameA.localeCompare(nameB)
    }

    const emailA = a.user?.email?.toLocaleLowerCase() ?? ''
    const emailB = b.user?.email?.toLocaleLowerCase() ?? ''
    return emailA.localeCompare(emailB)
  })
}

/** Direct DB query — used inside transactions where cache reads are unsafe */
async function findMemberByUserDirect(
  organizationId: string,
  userId: string,
  db: Database
): Promise<OrganizationMemberInfo | null> {
  const [row] = await db
    .select({
      id: schema.OrganizationMember.id,
      userId: schema.OrganizationMember.userId,
      organizationId: schema.OrganizationMember.organizationId,
      role: schema.OrganizationMember.role,
      seatType: schema.OrganizationMember.seatType,
      status: schema.OrganizationMember.status,
      onChatDuty: schema.OrganizationMember.onChatDuty,
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
