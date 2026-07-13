// packages/lib/src/dispatch/workers.ts
//
// CRUD for `DispatchWorker` rows — a user's presence as a schedulable resource on the board
// (07-m2-build.md §A.2). Removing a worker only ungates its board column; visits keep
// `assigneeUserId` — assignment stays user-based, worker rows are a separate gate.

import { database, schema } from '@auxx/database'
import type { AddressStruct } from '@auxx/lib/custom-fields/types'
import { and, asc, eq } from 'drizzle-orm'
import { NotFoundError } from '../errors'

type DispatchWorkerRow = typeof schema.DispatchWorker.$inferSelect
type DispatchWorkerInsert = typeof schema.DispatchWorker.$inferInsert

/** A `DispatchWorker` row joined with its user's display fields (name/avatar/email). */
export interface DispatchWorkerWithUser {
  id: string
  organizationId: string
  userId: string
  isActive: boolean
  color: string | null
  homeBase: AddressStruct | null
  /** Route starts at the depot (org business address in v1) — worker Profile switch. */
  routeStartAtHome: boolean
  /** Route ends back at the depot (org business address in v1) — worker Profile switch. */
  routeEndAtHome: boolean
  createdAt: Date
  updatedAt: Date
  user: { id: string; name: string | null; email: string | null; image: string | null } | null
}

/** Input for {@link upsertDispatchWorker} — only the given fields are written on conflict. */
export interface UpsertDispatchWorkerInput {
  organizationId: string
  userId: string
  isActive?: boolean
  color?: string | null
  homeBase?: AddressStruct | null
  routeStartAtHome?: boolean
  routeEndAtHome?: boolean
}

const workerColumns = {
  id: schema.DispatchWorker.id,
  organizationId: schema.DispatchWorker.organizationId,
  userId: schema.DispatchWorker.userId,
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

/** All dispatch workers for an org (active + inactive — the settings page manages both), joined with User. */
export async function listDispatchWorkers(
  organizationId: string
): Promise<DispatchWorkerWithUser[]> {
  const rows = await database
    .select(workerColumns)
    .from(schema.DispatchWorker)
    .leftJoin(schema.User, eq(schema.User.id, schema.DispatchWorker.userId))
    .where(eq(schema.DispatchWorker.organizationId, organizationId))
    .orderBy(asc(schema.User.name))

  return rows as DispatchWorkerWithUser[]
}

/**
 * Create or update a worker row, keyed on the `(organizationId, userId)` unique index. Only
 * the fields present in `input` are written on conflict — omitted fields keep their current
 * value (the settings dialog's per-page saves don't clobber sibling pages' fields).
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
      set,
    })
    .returning()

  return row!
}

/** Row delete — visits keep `assigneeUserId`, only the board column disappears. */
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
