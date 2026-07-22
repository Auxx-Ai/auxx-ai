// packages/lib/src/dispatch/workers.ts
//
// CRUD for `DispatchWorker` rows — a schedulable resource on the board (07-m2-build.md §A.2,
// 45-teams.md). A worker is either an `individual` (a per-org gate on a User) or a `team` (a crew
// of member individuals, linked via `DispatchTeamMember`). Both kinds are one dispatchable board
// row; assignment is worker-based (`WorkOrderVisit.assigneeWorkerId`). Removing a worker only
// ungates its board column.

import { database, schema } from '@auxx/database'
import type { AddressStruct } from '@auxx/lib/custom-fields/types'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'

type DispatchWorkerRow = typeof schema.DispatchWorker.$inferSelect
type DispatchWorkerInsert = typeof schema.DispatchWorker.$inferInsert

export type DispatchWorkerType = 'individual' | 'team'

/** A member individual of a team, with its user's display fields. */
export interface DispatchTeamMemberInfo {
  /** The member individual's `DispatchWorker.id`. */
  workerId: string
  userId: string | null
  name: string | null
  image: string | null
}

/** A `DispatchWorker` row joined with its user's display fields (individuals) or members (teams). */
export interface DispatchWorkerWithUser {
  id: string
  organizationId: string
  type: DispatchWorkerType
  userId: string | null
  /** Team display label; null for individuals (they derive their name from the joined User). */
  name: string | null
  isActive: boolean
  color: string | null
  homeBase: AddressStruct | null
  /** Route starts at the depot (org business address in v1) — worker Profile switch. */
  routeStartAtHome: boolean
  /** Route ends back at the depot (org business address in v1) — worker Profile switch. */
  routeEndAtHome: boolean
  createdAt: Date
  updatedAt: Date
  /** Individuals only — null for teams. */
  user: { id: string; name: string | null; email: string | null; image: string | null } | null
  /** Teams only — the member individuals (undefined for individuals). */
  members?: DispatchTeamMemberInfo[]
}

/** Input for {@link upsertDispatchWorker} — individuals only; only present fields are written. */
export interface UpsertDispatchWorkerInput {
  organizationId: string
  userId: string
  isActive?: boolean
  color?: string | null
  homeBase?: AddressStruct | null
  routeStartAtHome?: boolean
  routeEndAtHome?: boolean
}

/** Input for {@link createTeam} / {@link updateTeam}. */
export interface TeamInput {
  name?: string | null
  isActive?: boolean
  color?: string | null
  homeBase?: AddressStruct | null
  routeStartAtHome?: boolean
  routeEndAtHome?: boolean
  /** Member individual worker ids (replace-all when provided). */
  memberWorkerIds?: string[]
}

const workerColumns = {
  id: schema.DispatchWorker.id,
  organizationId: schema.DispatchWorker.organizationId,
  type: schema.DispatchWorker.type,
  userId: schema.DispatchWorker.userId,
  name: schema.DispatchWorker.name,
  isActive: schema.DispatchWorker.isActive,
  color: schema.DispatchWorker.color,
  homeBase: schema.DispatchWorker.homeBase,
  routeStartAtHome: schema.DispatchWorker.routeStartAtHome,
  routeEndAtHome: schema.DispatchWorker.routeEndAtHome,
  createdAt: schema.DispatchWorker.createdAt,
  updatedAt: schema.DispatchWorker.updatedAt,
  user: {
    id: schema.User.id,
    name: schema.User.name,
    email: schema.User.email,
    image: schema.User.image,
  },
} as const

/**
 * All dispatch workers for an org (active + inactive — the settings page manages both). Individual
 * rows carry their `user`; team rows carry their `members[]` (member individuals + user display).
 */
export async function listDispatchWorkers(
  organizationId: string
): Promise<DispatchWorkerWithUser[]> {
  const rows = (await database
    .select(workerColumns)
    .from(schema.DispatchWorker)
    .leftJoin(schema.User, eq(schema.User.id, schema.DispatchWorker.userId))
    .where(eq(schema.DispatchWorker.organizationId, organizationId))
    .orderBy(asc(schema.User.name))) as DispatchWorkerWithUser[]

  const teamIds = rows.filter((r) => r.type === 'team').map((r) => r.id)
  if (teamIds.length > 0) {
    const membersByTeam = await getTeamMembers(organizationId, teamIds)
    for (const row of rows) {
      if (row.type === 'team') row.members = membersByTeam.get(row.id) ?? []
    }
  }

  // Individuals sort by user name, teams by their label — stable, teams intermixed by label.
  return rows.sort((a, b) => {
    const an = (a.type === 'team' ? a.name : a.user?.name) ?? ''
    const bn = (b.type === 'team' ? b.name : b.user?.name) ?? ''
    return an.localeCompare(bn)
  })
}

/** Fetch the member individuals for the given team worker ids, keyed by teamWorkerId. */
async function getTeamMembers(
  organizationId: string,
  teamWorkerIds: string[]
): Promise<Map<string, DispatchTeamMemberInfo[]>> {
  const byTeam = new Map<string, DispatchTeamMemberInfo[]>()
  if (teamWorkerIds.length === 0) return byTeam

  const rows = await database
    .select({
      teamWorkerId: schema.DispatchTeamMember.teamWorkerId,
      workerId: schema.DispatchTeamMember.memberWorkerId,
      userId: schema.DispatchWorker.userId,
      name: schema.User.name,
      image: schema.User.image,
    })
    .from(schema.DispatchTeamMember)
    .innerJoin(
      schema.DispatchWorker,
      eq(schema.DispatchWorker.id, schema.DispatchTeamMember.memberWorkerId)
    )
    .leftJoin(schema.User, eq(schema.User.id, schema.DispatchWorker.userId))
    .where(
      and(
        eq(schema.DispatchTeamMember.organizationId, organizationId),
        inArray(schema.DispatchTeamMember.teamWorkerId, teamWorkerIds)
      )
    )

  for (const row of rows) {
    const list = byTeam.get(row.teamWorkerId) ?? []
    list.push({ workerId: row.workerId, userId: row.userId, name: row.name, image: row.image })
    byTeam.set(row.teamWorkerId, list)
  }
  return byTeam
}

/** Fetch a single worker row (no user/member join). */
export async function getDispatchWorker(
  organizationId: string,
  workerId: string
): Promise<DispatchWorkerRow | null> {
  const row = await database.query.DispatchWorker.findFirst({
    where: and(
      eq(schema.DispatchWorker.organizationId, organizationId),
      eq(schema.DispatchWorker.id, workerId)
    ),
  })
  return row ?? null
}

/**
 * Create or update an INDIVIDUAL worker row, keyed on the `(organizationId, userId)` partial
 * unique index. Only the fields present in `input` are written on conflict.
 */
export async function upsertDispatchWorker(
  input: UpsertDispatchWorkerInput
): Promise<DispatchWorkerRow> {
  const set: Partial<DispatchWorkerInsert> = { updatedAt: new Date() }
  if (input.isActive !== undefined) set.isActive = input.isActive
  if (input.color !== undefined) set.color = input.color
  if (input.homeBase !== undefined) set.homeBase = input.homeBase
  if (input.routeStartAtHome !== undefined) set.routeStartAtHome = input.routeStartAtHome
  if (input.routeEndAtHome !== undefined) set.routeEndAtHome = input.routeEndAtHome

  const [row] = await database
    .insert(schema.DispatchWorker)
    .values({
      organizationId: input.organizationId,
      type: 'individual',
      userId: input.userId,
      isActive: input.isActive,
      color: input.color,
      homeBase: input.homeBase,
      routeStartAtHome: input.routeStartAtHome,
      routeEndAtHome: input.routeEndAtHome,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.DispatchWorker.organizationId, schema.DispatchWorker.userId],
      targetWhere: isNotNull(schema.DispatchWorker.userId), // match the partial unique index predicate
      set,
    })
    .returning()

  return row!
}

/** Create a TEAM worker row (no userId), optionally seeding members. */
export async function createTeam(
  organizationId: string,
  input: TeamInput
): Promise<DispatchWorkerRow> {
  const [row] = await database
    .insert(schema.DispatchWorker)
    .values({
      organizationId,
      type: 'team',
      userId: null,
      name: input.name ?? null,
      isActive: input.isActive ?? true,
      color: input.color ?? null,
      homeBase: input.homeBase ?? null,
      routeStartAtHome: input.routeStartAtHome ?? true,
      routeEndAtHome: input.routeEndAtHome ?? true,
      updatedAt: new Date(),
    })
    .returning()

  if (input.memberWorkerIds) {
    await setTeamMembers(organizationId, row!.id, input.memberWorkerIds)
  }
  return row!
}

/** Update a TEAM worker row's fields and (when provided) replace its members. */
export async function updateTeam(
  organizationId: string,
  teamWorkerId: string,
  input: TeamInput
): Promise<DispatchWorkerRow> {
  const set: Partial<DispatchWorkerInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = input.name
  if (input.isActive !== undefined) set.isActive = input.isActive
  if (input.color !== undefined) set.color = input.color
  if (input.homeBase !== undefined) set.homeBase = input.homeBase
  if (input.routeStartAtHome !== undefined) set.routeStartAtHome = input.routeStartAtHome
  if (input.routeEndAtHome !== undefined) set.routeEndAtHome = input.routeEndAtHome

  const [row] = await database
    .update(schema.DispatchWorker)
    .set(set)
    .where(
      and(
        eq(schema.DispatchWorker.organizationId, organizationId),
        eq(schema.DispatchWorker.id, teamWorkerId),
        eq(schema.DispatchWorker.type, 'team')
      )
    )
    .returning()

  if (!row) throw new NotFoundError('Dispatch team not found')
  if (input.memberWorkerIds !== undefined) {
    await setTeamMembers(organizationId, teamWorkerId, input.memberWorkerIds)
  }
  return row
}

/**
 * Replace a team's members with exactly `memberWorkerIds`. Guards (§1.G): the target must be a
 * team, and every member must be an `individual` worker in the same org (no nested teams).
 */
export async function setTeamMembers(
  organizationId: string,
  teamWorkerId: string,
  memberWorkerIds: string[]
): Promise<void> {
  const team = await getDispatchWorker(organizationId, teamWorkerId)
  if (!team || team.type !== 'team') throw new NotFoundError('Dispatch team not found')

  const uniqueIds = [...new Set(memberWorkerIds)]
  if (uniqueIds.length > 0) {
    const members = await database
      .select({ id: schema.DispatchWorker.id, type: schema.DispatchWorker.type })
      .from(schema.DispatchWorker)
      .where(
        and(
          eq(schema.DispatchWorker.organizationId, organizationId),
          inArray(schema.DispatchWorker.id, uniqueIds)
        )
      )
    if (members.length !== uniqueIds.length) {
      throw new BadRequestError('One or more team members do not exist in this organization')
    }
    const nonIndividual = members.find((m) => m.type !== 'individual')
    if (nonIndividual) {
      throw new BadRequestError('Team members must be individual workers (nested teams disallowed)')
    }
  }

  await database.transaction(async (tx) => {
    await tx
      .delete(schema.DispatchTeamMember)
      .where(
        and(
          eq(schema.DispatchTeamMember.organizationId, organizationId),
          eq(schema.DispatchTeamMember.teamWorkerId, teamWorkerId)
        )
      )
    if (uniqueIds.length > 0) {
      await tx.insert(schema.DispatchTeamMember).values(
        uniqueIds.map((memberWorkerId) => ({
          organizationId,
          teamWorkerId,
          memberWorkerId,
        }))
      )
    }
  })
}

/** Row delete — visits keep `assigneeWorkerId` (set null via FK); the board column disappears. */
export async function removeDispatchWorker(
  organizationId: string,
  workerId: string
): Promise<void> {
  await database
    .delete(schema.DispatchWorker)
    .where(
      and(
        eq(schema.DispatchWorker.organizationId, organizationId),
        eq(schema.DispatchWorker.id, workerId)
      )
    )
}

/** Toggle a worker's board-column visibility without touching its other fields. */
export async function setWorkerActive(
  organizationId: string,
  workerId: string,
  isActive: boolean
): Promise<DispatchWorkerRow> {
  const [row] = await database
    .update(schema.DispatchWorker)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(schema.DispatchWorker.organizationId, organizationId),
        eq(schema.DispatchWorker.id, workerId)
      )
    )
    .returning()

  if (!row) throw new NotFoundError('Dispatch worker not found')
  return row
}

/**
 * Resolve a worker to the underlying user id(s): an individual → its single `userId`, a team →
 * its member individuals' `userId`s (via `DispatchTeamMember`). Used by notify, my-schedule, and
 * any "assigned to me" expansion (45-teams.md §5).
 */
export async function resolveWorkerUserIds(
  organizationId: string,
  workerId: string
): Promise<string[]> {
  const worker = await getDispatchWorker(organizationId, workerId)
  if (!worker) return []
  if (worker.type === 'individual') return worker.userId ? [worker.userId] : []

  const rows = await database
    .select({ userId: schema.DispatchWorker.userId })
    .from(schema.DispatchTeamMember)
    .innerJoin(
      schema.DispatchWorker,
      eq(schema.DispatchWorker.id, schema.DispatchTeamMember.memberWorkerId)
    )
    .where(
      and(
        eq(schema.DispatchTeamMember.organizationId, organizationId),
        eq(schema.DispatchTeamMember.teamWorkerId, workerId)
      )
    )
  return rows.map((r) => r.userId).filter((id): id is string => id !== null)
}

/**
 * The worker ids a user is dispatched under: their own individual worker row plus every team they
 * are a member of. Used by my-schedule (§5.3) and "assigned to me" filters.
 */
export async function resolveUserWorkerIds(
  organizationId: string,
  userId: string
): Promise<string[]> {
  const individual = await database.query.DispatchWorker.findFirst({
    where: and(
      eq(schema.DispatchWorker.organizationId, organizationId),
      eq(schema.DispatchWorker.userId, userId),
      eq(schema.DispatchWorker.type, 'individual')
    ),
  })
  if (!individual) return []

  const teams = await database
    .select({ teamWorkerId: schema.DispatchTeamMember.teamWorkerId })
    .from(schema.DispatchTeamMember)
    .where(
      and(
        eq(schema.DispatchTeamMember.organizationId, organizationId),
        eq(schema.DispatchTeamMember.memberWorkerId, individual.id)
      )
    )
  return [individual.id, ...teams.map((t) => t.teamWorkerId)]
}
