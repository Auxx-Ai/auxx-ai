// apps/worker/scripts/verify-dispatch-teams.ts
/**
 * Dispatch Teams backend end-to-end verification (plans/dispatch/45-teams.md §7).
 * Exercises the REAL write/read paths added for teams:
 *   - team CRUD (`createTeam`/`setTeamMembers`) + the individual-only member guard (§1.G)
 *   - `resolveWorkerUserIds` (individual → [user]; team → all members)
 *   - `assignVisit` onto a team worker + `getBoard` returning the team as a row/column
 *   - the mirror writing a uniform `worker:{id}` actor for individuals AND teams (§5.6)
 *   - my-schedule membership expansion — a member sees team visits, a non-member does not (§5.3)
 *   - notify fan-out — dispatching a team-assigned visit reaches ALL members (§5.4)
 *   - `ActorService.getByIds` resolving `worker:{id}` to a `WorkerActor` (individual + team) (§5A)
 *   - migration integrity — every `assigneeWorkerId` points at a real worker row (§4)
 *
 * Work orders are created via `UnifiedCrudHandler` (number + visit auto-create hooks), prefixed
 * "[teams-verify]", and deleted at the end (visit rows cascade on EntityInstance delete). The
 * DispatchWorker/team rows created for the run are removed explicitly.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-teams.ts
 */

import { database } from '@auxx/database'
import { ActorService } from '@auxx/lib/actors'
import {
  assignVisit,
  createTeam,
  dispatchVisit,
  getBoard,
  listMyVisits,
  removeDispatchWorker,
  resolveWorkerUserIds,
  scheduleVisit,
  setTeamMembers,
  upsertDispatchWorker,
} from '@auxx/lib/dispatch'
import { BadRequestError } from '@auxx/lib/errors'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

// Inlined to avoid a direct `@auxx/types` dependency in the worker script (package-resolution
// rule): the actor-id wire form is `"{type}:{id}"` and a worker actor is `.type === 'worker'`.
const workerActorId = (id: string) => `worker:${id}`

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

async function getVisit(workOrderInstanceId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  if (!visit) throw new Error(`No visit found for work order ${workOrderInstanceId}`)
  return visit
}

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function assigneeMirror(organizationId: string, workOrderInstanceId: string) {
  const defId = await entityDefId(organizationId, 'work_order')
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, 'work_order_assignee')),
  })
  if (!field) return null
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, workOrderInstanceId), eq(t.fieldId, field.id)),
  })
  return fv ?? null
}

async function main() {
  const userA = await database.query.User.findFirst({
    columns: { id: true, email: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!userA) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org)
  const userIdA = userA.id

  // A second (and optional third) real USER member, for member/non-member + multi-member fan-out.
  const members = await database.query.OrganizationMember.findMany({
    columns: { userId: true },
    where: (t, { eq }) => eq(t.organizationId, organizationId),
  })
  const userRows = await database.query.User.findMany({
    columns: { id: true, userType: true },
    where: (t, { inArray: inArr }) =>
      inArr(
        t.id,
        members.map((m) => m.userId)
      ),
  })
  const realUserIds = userRows.filter((u) => u.userType === 'USER').map((u) => u.id)
  const otherUserIds = realUserIds.filter((id) => id !== userIdA)
  const memberUserIds = otherUserIds.slice(0, 2) // team members (NOT userA — userA is the non-member)
  console.log(
    `Org ${organizationId}; non-member userA=${userIdA}; team members=${memberUserIds.join(', ') || '(none — degraded)'}`
  )
  if (memberUserIds.length === 0) {
    console.log('  ⚠️  No second org user — member/non-member + fan-out checks will be degraded.')
  }

  const handler = new UnifiedCrudHandler(organizationId, userIdA)
  const createdRecordIds: string[] = []
  const createdWorkerIds: string[] = [] // only rows this run CREATED — safe to delete at cleanup

  // Non-destructive: reuse a pre-existing individual worker row (don't delete real dev data),
  // create one only when absent (and then track it for cleanup).
  async function ensureIndividualWorker(uid: string): Promise<string> {
    const existing = await database.query.DispatchWorker.findFirst({
      columns: { id: true },
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.userId, uid), eq(t.type, 'individual')),
    })
    if (existing) return existing.id
    const w = await upsertDispatchWorker({ organizationId, userId: uid })
    createdWorkerIds.push(w.id)
    return w.id
  }

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Individual workers + team CRUD + the member guard
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: individual workers + team CRUD + guard')
    const workerAId = await ensureIndividualWorker(userIdA)
    const workerA = await database.query.DispatchWorker.findFirst({
      where: (t, { eq }) => eq(t.id, workerAId),
    })
    check(
      'individual worker A exists (type individual, has userId)',
      workerA?.type === 'individual' && workerA?.userId === userIdA
    )

    const memberWorkerIds: string[] = []
    for (const uid of memberUserIds) {
      memberWorkerIds.push(await ensureIndividualWorker(uid))
    }

    const team = await createTeam(organizationId, {
      name: '[teams-verify] Crew Alpha',
      color: '#22aa66',
      memberWorkerIds,
    })
    createdWorkerIds.push(team.id)
    check(
      'createTeam makes a team row (type team, null userId, name set)',
      team.type === 'team' && team.userId === null && team.name === '[teams-verify] Crew Alpha'
    )

    // Guard (§1.G): a team may not be a member of another team.
    const team2 = await createTeam(organizationId, { name: '[teams-verify] Crew Beta' })
    createdWorkerIds.push(team2.id)
    let guardRejected = false
    try {
      await setTeamMembers(organizationId, team.id, [...memberWorkerIds, team2.id])
    } catch (err) {
      guardRejected = err instanceof BadRequestError
    }
    check('guard: adding a team as a member is rejected (BadRequestError)', guardRejected)
    // The rejected call must not have partially mutated membership.
    check(
      'guard: membership unchanged after a rejected setTeamMembers',
      (await resolveWorkerUserIds(organizationId, team.id)).length === memberUserIds.length
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. resolveWorkerUserIds
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: resolveWorkerUserIds')
    const indivUsers = await resolveWorkerUserIds(organizationId, workerAId)
    check(
      'individual → its single user',
      indivUsers.length === 1 && indivUsers[0] === userIdA,
      indivUsers
    )
    const teamUsers = await resolveWorkerUserIds(organizationId, team.id)
    check(
      'team → exactly its members',
      teamUsers.length === memberUserIds.length &&
        memberUserIds.every((u) => teamUsers.includes(u)),
      teamUsers
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. assign a visit to the team; getBoard + mirror (individual + team + null)
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: assign to team + getBoard + mirror')
    const wo = await handler.create('work_order', { work_order_title: '[teams-verify] WO team' })
    createdRecordIds.push(wo.recordId)
    const visit = await getVisit(wo.instance.id)
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId: userIdA,
      visitId: visit.id,
      startTime: start,
      endTime: new Date(start.getTime() + 60 * 60 * 1000),
    })

    const assignedTeam = await assignVisit({
      organizationId,
      userId: userIdA,
      visitId: visit.id,
      assigneeWorkerId: team.id,
    })
    check(
      'assignVisit sets assigneeWorkerId to the team',
      assignedTeam.assigneeWorkerId === team.id
    )

    const mirrorTeam = await assigneeMirror(organizationId, wo.instance.id)
    check(
      'mirror: team assignee → work_order_assignee stored as worker (relatedEntityId + marker)',
      mirrorTeam?.relatedEntityId === team.id && mirrorTeam?.relatedEntityDefinitionId === 'worker',
      {
        relatedEntityId: mirrorTeam?.relatedEntityId,
        marker: mirrorTeam?.relatedEntityDefinitionId,
      }
    )

    const board = await getBoard(organizationId, {
      from: new Date(),
      to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    check(
      'getBoard workers includes the team row',
      board.workers.some((w) => w.id === team.id && w.type === 'team')
    )
    const boardTeamRow = board.workers.find((w) => w.id === team.id)
    check(
      'getBoard team row carries its members[]',
      (boardTeamRow?.members?.length ?? 0) === memberUserIds.length,
      boardTeamRow?.members
    )
    const boardVisit = board.visits.find((v) => v.id === visit.id)
    check(
      'getBoard visit sits on the team column (assigneeWorkerId = teamId)',
      boardVisit?.assigneeWorkerId === team.id
    )

    // Reassign to individual A → mirror flips to worker:{workerA}
    await assignVisit({
      organizationId,
      userId: userIdA,
      visitId: visit.id,
      assigneeWorkerId: workerAId,
    })
    const mirrorIndiv = await assigneeMirror(organizationId, wo.instance.id)
    check(
      'mirror: individual assignee → worker (relatedEntityId = workerId + marker)',
      mirrorIndiv?.relatedEntityId === workerAId &&
        mirrorIndiv?.relatedEntityDefinitionId === 'worker',
      {
        relatedEntityId: mirrorIndiv?.relatedEntityId,
        marker: mirrorIndiv?.relatedEntityDefinitionId,
      }
    )

    // Unassign → mirror null
    await assignVisit({
      organizationId,
      userId: userIdA,
      visitId: visit.id,
      assigneeWorkerId: null,
    })
    const mirrorNull = await assigneeMirror(organizationId, wo.instance.id)
    check(
      'mirror: unassigned → null',
      mirrorNull === null || (mirrorNull.relatedEntityId === null && mirrorNull.actorId === null),
      { relatedEntityId: mirrorNull?.relatedEntityId }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. my-schedule membership + notify fan-out (needs ≥1 member)
    // ══════════════════════════════════════════════════════════════════════
    if (memberUserIds.length > 0) {
      console.log('4: my-schedule membership + notify fan-out')
      // Re-assign the visit to the team for the schedule/notify checks.
      await assignVisit({
        organizationId,
        userId: userIdA,
        visitId: visit.id,
        assigneeWorkerId: team.id,
      })

      const from = new Date(Date.now() - 60 * 1000)
      const to = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      const memberVisits = await listMyVisits({
        organizationId,
        userId: memberUserIds[0]!,
        from,
        to,
      })
      check(
        'member sees the team visit in listMyVisits',
        memberVisits.some((v) => v.id === visit.id)
      )

      const nonMemberVisits = await listMyVisits({ organizationId, userId: userIdA, from, to })
      check(
        'non-member (userA) does NOT see the team visit',
        !nonMemberVisits.some((v) => v.id === visit.id)
      )

      // Notify: dispatch a team-assigned visit → one WORK_ORDER_DISPATCHED per member.
      await dispatchVisit({ organizationId, userId: userIdA, visitId: visit.id })
      const notifs = await database.query.Notification.findMany({
        where: (t, { and, eq }) =>
          and(
            eq(t.entityId, wo.instance.id),
            eq(t.entityType, 'work_order'),
            eq(t.type, 'WORK_ORDER_DISPATCHED')
          ),
      })
      const notifiedUserIds = new Set(notifs.map((n) => n.userId))
      check(
        'notify: dispatch of a team visit reaches every member',
        memberUserIds.every((u) => notifiedUserIds.has(u)),
        [...notifiedUserIds]
      )
    }

    // ══════════════════════════════════════════════════════════════════════
    // 5. ActorService resolves worker:{id} (individual + team)
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: ActorService.getByIds worker resolution')
    const actorService = new ActorService({ db: database, organizationId, userId: userIdA })
    const indivActorId = workerActorId(workerAId)
    const teamActorId = workerActorId(team.id)
    const resolved = await actorService.getByIds([indivActorId, teamActorId])

    const ia = resolved.get(indivActorId) as
      | { type: string; workerType?: string; userId?: string | null }
      | undefined
    check(
      'individual worker resolves to a WorkerActor with the user identity',
      !!ia && ia.type === 'worker' && ia.workerType === 'individual' && ia.userId === userIdA,
      ia
    )
    const ta = resolved.get(teamActorId) as
      | { type: string; workerType?: string; members?: unknown[] }
      | undefined
    check(
      'team worker resolves to a WorkerActor with members[]',
      !!ta &&
        ta.type === 'worker' &&
        ta.workerType === 'team' &&
        (ta.members?.length ?? 0) === memberUserIds.length,
      ta?.type === 'worker' ? { members: ta.members?.length } : ta
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6. Migration integrity — no orphan assigneeWorkerId
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: migration integrity (no orphan assigneeWorkerId)')
    const orgVisits = await database.query.WorkOrderVisit.findMany({
      columns: { id: true, assigneeWorkerId: true },
      where: (t, { and, eq, isNotNull }) =>
        and(eq(t.organizationId, organizationId), isNotNull(t.assigneeWorkerId)),
    })
    const workerIds = new Set(
      (
        await database.query.DispatchWorker.findMany({
          columns: { id: true },
          where: (t, { eq }) => eq(t.organizationId, organizationId),
        })
      ).map((w) => w.id)
    )
    const orphans = orgVisits.filter(
      (v) => v.assigneeWorkerId && !workerIds.has(v.assigneeWorkerId)
    )
    check(
      'every assigned visit references a real worker row (backfill integrity)',
      orphans.length === 0,
      orphans
    )
  } finally {
    console.log(
      `Cleanup: deleting ${createdRecordIds.length} verify records + ${createdWorkerIds.length} workers`
    )
    for (const recordId of createdRecordIds.reverse()) {
      try {
        await handler.delete(recordId as never)
      } catch (err) {
        console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
      }
    }
    // Delete team membership first (FK), then worker rows. removeDispatchWorker cascades members.
    for (const workerId of createdWorkerIds.reverse()) {
      try {
        await removeDispatchWorker(organizationId, workerId)
      } catch (err) {
        console.log(
          `  worker cleanup failed for ${workerId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    const leftover = createdWorkerIds.length
      ? await database.query.DispatchTeamMember.findMany({
          columns: { id: true },
          where: (t, { inArray }) => inArray(t.teamWorkerId, createdWorkerIds),
        })
      : []
    check('team membership rows cascade-cleaned on worker delete', leftover.length === 0)
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
