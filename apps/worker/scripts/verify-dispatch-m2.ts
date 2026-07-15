// apps/worker/scripts/verify-dispatch-m2.ts
/**
 * Dispatch M2a backend end-to-end verification (plans/dispatch/07-m2-build.md §H).
 * Exercises the REAL `@auxx/lib/dispatch` write paths added in M2a: `DispatchWorker` CRUD
 * (unique `(organizationId, userId)` upsert-on-conflict), the visit mutations
 * (`scheduleVisit`/`assignVisit`/`unscheduleVisit`/`setVisitStatus`), the mirror
 * (`mirrorVisitOntoWorkOrder`, next-upcoming-aware with its canceled-visit fallback), the
 * baked-in status roll-up (`rollUpWorkOrderStatus`, forward-only guard + reset triggers),
 * `dispatchVisit` (reject paths + stamp + in-app Notification + email enqueue), `getBoard`
 * (range + backlog + slim work-order projections + active-worker filter), and
 * `listVisitsForWorkOrder` ordering.
 *
 * Work orders are created via the same `UnifiedCrudHandler` path as verify-dispatch-m1.ts
 * (number hook + visit auto-create hook), prefixed "[M2-verify]", and deleted at the end —
 * `WorkOrderVisit.workOrderId` cascades on `EntityInstance` delete, so per-work-order visit
 * cleanup is automatic. The one `DispatchWorker` row created for the run is removed
 * explicitly (also exercises `removeDispatchWorker`).
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-m2.ts
 */

import { database, schema } from '@auxx/database'
import {
  assignVisit,
  dispatchVisit,
  getBoard,
  listDispatchWorkers,
  listVisitsForWorkOrder,
  removeDispatchWorker,
  scheduleVisit,
  setVisitStatus,
  setWorkerActive,
  unscheduleVisit,
  upsertDispatchWorker,
} from '@auxx/lib/dispatch'
import { BadRequestError } from '@auxx/lib/errors'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

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

async function fieldValueByAttr(
  organizationId: string,
  entityType: 'work_order' | 'contact',
  instanceId: string,
  systemAttribute: string
) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  if (!field) return null
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, field.id)),
  })
  return fv ?? null
}

async function woStatus(organizationId: string, workOrderInstanceId: string) {
  const fv = await fieldValueByAttr(
    organizationId,
    'work_order',
    workOrderInstanceId,
    'work_order_status'
  )
  return fv?.optionId ?? null
}

/** `FieldValue.valueDate` is stored/read in `mode: 'string'` — compare as epoch millis. */
function sameInstant(valueDate: string | null | undefined, expected: Date): boolean {
  return !!valueDate && new Date(valueDate).getTime() === expected.getTime()
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as M1/availability scripts)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []
  let workerId: string | undefined

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Worker CRUD
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: DispatchWorker CRUD')
    const w1 = await upsertDispatchWorker({
      organizationId,
      userId,
      isActive: true,
      color: '#3366ff',
    })
    workerId = w1.id
    check(
      'upsert creates a row',
      w1.userId === userId && w1.color === '#3366ff' && w1.isActive === true
    )

    const w2 = await upsertDispatchWorker({ organizationId, userId, color: '#ff0000' })
    check('second upsert updates the SAME row (no duplicate)', w2.id === w1.id, {
      w1: w1.id,
      w2: w2.id,
    })
    check('second upsert writes only the given field (color)', w2.color === '#ff0000')
    check('second upsert leaves omitted fields untouched (isActive)', w2.isActive === true)

    const rowsForKey = await database.query.DispatchWorker.findMany({
      where: (t, { and, eq }) => and(eq(t.organizationId, organizationId), eq(t.userId, userId)),
    })
    check(
      'unique (organizationId, userId) — exactly one row',
      rowsForKey.length === 1,
      rowsForKey.length
    )

    const listed = await database.query.DispatchWorker.findMany({
      where: (t, { eq }) => eq(t.organizationId, organizationId),
    })
    check(
      'row present in the org',
      listed.some((w) => w.id === w1.id)
    )

    // listDispatchWorkers join shape (via the lib function, not raw query)
    const withUser = await listDispatchWorkers(organizationId)
    const joined = withUser.find((w) => w.id === w1.id)
    check(
      'listDispatchWorkers join shape carries user email/name',
      joined?.user?.email === 'm4rkuskk@gmail.com' && !!joined?.user?.name,
      joined?.user
    )

    const deactivated = await setWorkerActive(organizationId, w1.id, false)
    check('setWorkerActive(false)', deactivated.isActive === false)
    const reactivated = await setWorkerActive(organizationId, w1.id, true)
    check('setWorkerActive(true)', reactivated.isActive === true)

    // ══════════════════════════════════════════════════════════════════════
    // 2/3/6. Full visit lifecycle: mirror + roll-up + forward-only guard + dispatch
    // ══════════════════════════════════════════════════════════════════════
    console.log('2/3/6: visit lifecycle (schedule/assign/dispatch/status/cancel/unschedule)')
    const woB = await handler.create('work_order', { work_order_title: '[M2-verify] WO lifecycle' })
    createdRecordIds.push(woB.recordId)
    const visitB0 = await getVisit(woB.instance.id)
    check('auto-created visit starts unscheduled', visitB0.startTime === null)
    check('WO status starts new', (await woStatus(organizationId, woB.instance.id)) === 'new')

    let dispatchRejectedUnscheduled = false
    try {
      await dispatchVisit({ organizationId, userId, visitId: visitB0.id })
    } catch (err) {
      dispatchRejectedUnscheduled = err instanceof BadRequestError
    }
    check('dispatchVisit rejects an unscheduled visit', dispatchRejectedUnscheduled)

    const start1 = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end1 = new Date(start1.getTime() + 60 * 60 * 1000)
    const scheduled = await scheduleVisit({
      organizationId,
      userId,
      visitId: visitB0.id,
      startTime: start1,
      endTime: end1,
    })
    check(
      'scheduleVisit sets startTime/endTime',
      scheduled.startTime?.getTime() === start1.getTime()
    )
    check(
      'schedule ⇒ work_order_status scheduled',
      (await woStatus(organizationId, woB.instance.id)) === 'scheduled'
    )
    const mirrorStart = await fieldValueByAttr(
      organizationId,
      'work_order',
      woB.instance.id,
      'work_order_scheduled_start'
    )
    check(
      'mirror: work_order_scheduled_start matches',
      sameInstant(mirrorStart?.valueDate, start1),
      mirrorStart?.valueDate
    )

    let dispatchRejectedUnassigned = false
    try {
      await dispatchVisit({ organizationId, userId, visitId: visitB0.id })
    } catch (err) {
      dispatchRejectedUnassigned = err instanceof BadRequestError
    }
    check('dispatchVisit rejects an unassigned (but scheduled) visit', dispatchRejectedUnassigned)

    const assigned = await assignVisit({
      organizationId,
      userId,
      visitId: visitB0.id,
      assigneeUserId: userId,
    })
    check('assignVisit sets assigneeUserId', assigned.assigneeUserId === userId)
    const mirrorAssignee = await fieldValueByAttr(
      organizationId,
      'work_order',
      woB.instance.id,
      'work_order_assignee'
    )
    check('mirror: work_order_assignee matches', mirrorAssignee?.actorId === userId)
    check(
      'assignVisit has no roll-up rule of its own (status unchanged)',
      (await woStatus(organizationId, woB.instance.id)) === 'scheduled'
    )

    const dispatched1 = await dispatchVisit({ organizationId, userId, visitId: visitB0.id })
    check('dispatchVisit stamps dispatchedAt', dispatched1.dispatchedAt !== null)
    check(
      'dispatch ⇒ work_order_status dispatched',
      (await woStatus(organizationId, woB.instance.id)) === 'dispatched'
    )
    check('dispatchVisit did not throw (email enqueue asserted as no-throw only)', true)

    const notificationsAfterFirst = await database.query.Notification.findMany({
      where: (t, { and, eq }) =>
        and(
          eq(t.entityId, woB.instance.id),
          eq(t.entityType, 'work_order'),
          eq(t.type, 'WORK_ORDER_DISPATCHED')
        ),
    })
    check(
      'dispatchVisit creates a Notification row (type WORK_ORDER_DISPATCHED, userId = assignee)',
      notificationsAfterFirst.length === 1 && notificationsAfterFirst[0]?.userId === userId,
      notificationsAfterFirst
    )

    const dispatched2 = await dispatchVisit({ organizationId, userId, visitId: visitB0.id })
    check(
      're-dispatch re-stamps dispatchedAt',
      dispatched2.dispatchedAt !== null &&
        dispatched2.dispatchedAt.getTime() >= dispatched1.dispatchedAt!.getTime()
    )
    const notificationsAfterSecond = await database.query.Notification.findMany({
      where: (t, { and, eq }) =>
        and(
          eq(t.entityId, woB.instance.id),
          eq(t.entityType, 'work_order'),
          eq(t.type, 'WORK_ORDER_DISPATCHED')
        ),
    })
    check(
      're-dispatch re-notifies (a second Notification row)',
      notificationsAfterSecond.length === 2
    )

    await setVisitStatus({ organizationId, userId, visitId: visitB0.id, status: 'en_route' })
    check(
      'en_route ⇒ work_order_status en_route',
      (await woStatus(organizationId, woB.instance.id)) === 'en_route'
    )
    await setVisitStatus({ organizationId, userId, visitId: visitB0.id, status: 'on_site' })
    check(
      'on_site ⇒ work_order_status on_site',
      (await woStatus(organizationId, woB.instance.id)) === 'on_site'
    )
    await setVisitStatus({ organizationId, userId, visitId: visitB0.id, status: 'done' })
    check(
      'done ⇒ work_order_status completed',
      (await woStatus(organizationId, woB.instance.id)) === 'completed'
    )

    const guardVisit = await setVisitStatus({
      organizationId,
      userId,
      visitId: visitB0.id,
      status: 'en_route',
    })
    check("visit's own status DOES move (en_route)", guardVisit.status === 'en_route')
    check(
      'forward-only guard: work_order_status stays completed (does not move backward)',
      (await woStatus(organizationId, woB.instance.id)) === 'completed'
    )

    await setVisitStatus({ organizationId, userId, visitId: visitB0.id, status: 'canceled' })
    check(
      'canceled resets work_order_status to new (bypasses forward-only guard)',
      (await woStatus(organizationId, woB.instance.id)) === 'new'
    )

    const rescheduledStart = new Date(start1.getTime() + 24 * 60 * 60 * 1000)
    const rescheduledEnd = new Date(rescheduledStart.getTime() + 60 * 60 * 1000)
    const rescheduled = await scheduleVisit({
      organizationId,
      userId,
      visitId: visitB0.id,
      startTime: rescheduledStart,
      endTime: rescheduledEnd,
      assigneeUserId: userId,
    })
    check(
      'rescheduling a canceled visit restores scheduled status and the new time',
      rescheduled.status === 'scheduled' &&
        rescheduled.startTime?.getTime() === rescheduledStart.getTime() &&
        rescheduled.endTime?.getTime() === rescheduledEnd.getTime(),
      rescheduled
    )
    check(
      'rescheduling a canceled visit restores work_order_status scheduled',
      (await woStatus(organizationId, woB.instance.id)) === 'scheduled'
    )

    const unscheduled = await unscheduleVisit({ organizationId, userId, visitId: visitB0.id })
    check(
      'unscheduleVisit clears startTime/endTime',
      unscheduled.startTime === null && unscheduled.endTime === null
    )
    check(
      'unscheduleVisit resets work_order_status to new',
      (await woStatus(organizationId, woB.instance.id)) === 'new'
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. Mirror is next-upcoming-aware (fallback rules on cancel)
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: mirror next-upcoming-aware + canceled-fallback')
    const woC = await handler.create('work_order', { work_order_title: '[M2-verify] WO mirror' })
    createdRecordIds.push(woC.recordId)
    const visitC = await getVisit(woC.instance.id)

    const mirrorStartInitial = await fieldValueByAttr(
      organizationId,
      'work_order',
      woC.instance.id,
      'work_order_scheduled_start'
    )
    check(
      'unscheduled visit ⇒ mirrors null',
      mirrorStartInitial === null || mirrorStartInitial.valueDate === null,
      mirrorStartInitial
    )

    const startC = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const endC = new Date(startC.getTime() + 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visitC.id,
      startTime: startC,
      endTime: endC,
    })
    const mirrorStartScheduled = await fieldValueByAttr(
      organizationId,
      'work_order',
      woC.instance.id,
      'work_order_scheduled_start'
    )
    check(
      'schedule ⇒ mirrors populate',
      sameInstant(mirrorStartScheduled?.valueDate, startC),
      mirrorStartScheduled?.valueDate
    )

    await setVisitStatus({ organizationId, userId, visitId: visitC.id, status: 'canceled' })
    const mirrorStartCanceled = await fieldValueByAttr(
      organizationId,
      'work_order',
      woC.instance.id,
      'work_order_scheduled_start'
    )
    check(
      'cancel ⇒ mirrors null again (resolveMirrorSourceVisit fallback excludes canceled)',
      mirrorStartCanceled === null || mirrorStartCanceled.valueDate === null,
      mirrorStartCanceled?.valueDate
    )

    // ══════════════════════════════════════════════════════════════════════
    // 5. getBoard: range + backlog + slim projections + active-worker filter
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: getBoard')
    const contact = await handler.create('contact', {
      first_name: '[M2-verify]',
      last_name: 'BoardContact',
    })
    createdRecordIds.push(contact.recordId)
    const contactDefId = await entityDefId(organizationId, 'contact')
    const contactRecordId = `${contactDefId}:${contact.instance.id}`

    const woInRange = await handler.create('work_order', {
      work_order_title: '[M2-verify] WO board in-range',
      work_order_contact: contactRecordId,
    })
    createdRecordIds.push(woInRange.recordId)
    const visitInRange = await getVisit(woInRange.instance.id)
    const rangeFrom = new Date()
    const rangeTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const inRangeStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visitInRange.id,
      startTime: inRangeStart,
      endTime: new Date(inRangeStart.getTime() + 60 * 60 * 1000),
    })

    const woOutOfRange = await handler.create('work_order', {
      work_order_title: '[M2-verify] WO board out-of-range',
    })
    createdRecordIds.push(woOutOfRange.recordId)
    const visitOutOfRange = await getVisit(woOutOfRange.instance.id)
    const outOfRangeStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visitOutOfRange.id,
      startTime: outOfRangeStart,
      endTime: new Date(outOfRangeStart.getTime() + 60 * 60 * 1000),
    })

    const woBacklog = await handler.create('work_order', {
      work_order_title: '[M2-verify] WO board backlog',
    })
    createdRecordIds.push(woBacklog.recordId)
    const visitBacklog = await getVisit(woBacklog.instance.id)

    const board = await getBoard(organizationId, { from: rangeFrom, to: rangeTo })
    const boardVisitIds = new Set(board.visits.map((v) => v.id))
    check('getBoard includes the in-range scheduled visit', boardVisitIds.has(visitInRange.id))
    check(
      'getBoard EXCLUDES the out-of-range scheduled visit',
      !boardVisitIds.has(visitOutOfRange.id)
    )
    check(
      'getBoard includes the unscheduled backlog visit regardless of range',
      boardVisitIds.has(visitBacklog.id)
    )

    const boardWoInRange = board.workOrders.find((w) => w.id === woInRange.instance.id)
    check(
      'slim work order carries a WO- number',
      !!boardWoInRange?.number?.startsWith('WO-'),
      boardWoInRange?.number
    )
    check(
      'slim work order carries status',
      boardWoInRange?.status === 'scheduled',
      boardWoInRange?.status
    )
    check(
      'slim work order carries contactDisplayName',
      boardWoInRange?.contactDisplayName === contact.instance.displayName,
      { got: boardWoInRange?.contactDisplayName, expected: contact.instance.displayName }
    )

    check(
      'getBoard workers includes the active worker',
      board.workers.some((w) => w.id === workerId)
    )
    await setWorkerActive(organizationId, workerId!, false)
    const boardInactive = await getBoard(organizationId, { from: rangeFrom, to: rangeTo })
    check(
      'getBoard workers EXCLUDES a deactivated worker',
      !boardInactive.workers.some((w) => w.id === workerId)
    )
    await setWorkerActive(organizationId, workerId!, true)

    // ══════════════════════════════════════════════════════════════════════
    // 7. listVisitsForWorkOrder ordering
    // ══════════════════════════════════════════════════════════════════════
    console.log('7: listVisitsForWorkOrder ordering')
    const woE = await handler.create('work_order', { work_order_title: '[M2-verify] WO ordering' })
    createdRecordIds.push(woE.recordId)
    const visitE0 = await getVisit(woE.instance.id) // unscheduled — expected LAST

    const laterStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const [visitE2] = await database
      .insert(schema.WorkOrderVisit)
      .values({
        organizationId,
        workOrderId: woE.instance.id,
        status: 'scheduled',
        timezone: 'UTC',
        startTime: laterStart,
        endTime: new Date(laterStart.getTime() + 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .returning()

    const soonerStart = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)
    const [visitE1] = await database
      .insert(schema.WorkOrderVisit)
      .values({
        organizationId,
        workOrderId: woE.instance.id,
        status: 'scheduled',
        timezone: 'UTC',
        startTime: soonerStart,
        endTime: new Date(soonerStart.getTime() + 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .returning()

    const ordered = await listVisitsForWorkOrder(organizationId, woE.instance.id)
    check(
      'ordering: scheduled-soonest first, unscheduled last',
      ordered.length === 3 &&
        ordered[0]?.id === visitE1!.id &&
        ordered[1]?.id === visitE2!.id &&
        ordered[2]?.id === visitE0.id,
      ordered.map((v) => ({ id: v.id, startTime: v.startTime }))
    )
  } finally {
    // ── Cleanup ──
    console.log(`Cleanup: deleting ${createdRecordIds.length} verify records`)
    for (const recordId of createdRecordIds.reverse()) {
      try {
        await handler.delete(recordId as never)
      } catch (err) {
        console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
      }
    }
    if (workerId) {
      await removeDispatchWorker(organizationId, workerId)
      const remaining = await database.query.DispatchWorker.findMany({
        where: (t, { eq }) => eq(t.organizationId, organizationId),
      })
      check('removeDispatchWorker deletes the row', !remaining.some((w) => w.id === workerId))
    }
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
