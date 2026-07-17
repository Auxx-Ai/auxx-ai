// apps/worker/scripts/verify-dispatch-scheduling-fixes.ts
/**
 * Dispatch scheduling/recurrence fixes verification (plans/dispatch/30-scheduling-recurrence-
 * fixes.md §4, items 1-7). Exercises the REAL write paths added by that plan in
 * `packages/lib/src/dispatch/`: `restoreVisit`/`addVisit` (visit-mutations.ts), the transition
 * guard + `dispatchedAt`-clearing in `setVisitStatus`/`unscheduleVisit` (+ the series-visit
 * unschedule rejection), the status+day-window guard in `dispatchVisit` (notify.ts), and
 * create-time adoption of standalone scheduled visits in `setRecurrenceRule`
 * (recurring/rule-mutations.ts).
 *
 * Work orders are created via `UnifiedCrudHandler.create` (the M1 number + visit auto-create
 * hooks), prefixed "[scheduling-fixes-verify]", and deleted at the end —
 * `WorkOrderVisit.workOrderId` AND `RecurrenceRule.subjectId` both cascade on `EntityInstance`
 * delete (the `verify-dispatch-recurring.ts` precedent), so per-work-order visit/rule cleanup
 * is automatic. `Notification` rows created by `dispatchVisit` are NOT cascade-cleaned
 * (`entityId` is a plain text column, not an FK) — same as the existing `verify-dispatch-m2.ts`
 * precedent, left as-is.
 *
 * Timing: the dev org (Marki Corp, `u45w22ft66ymiaa19ohs7m9f`) has no `OperatingHours` row, so
 * `resolveOrgTimezone` (the same helper `notify.ts` calls) resolves to `'UTC'` — asserted below
 * as a precondition. All day-boundary instants are then built via plain UTC midday arithmetic
 * (`middayUtc`), which is both "the org timezone" and host-timezone-independent, matching the
 * `verify-dispatch-recurring.ts` convention.
 *
 * ⚠️ SAFETY: the dev `.env` is LIVE — `dispatchVisit` sends a real in-app Notification and may
 * enqueue a real dispatch email (gated on `notification.dispatch.email`, default on). The email
 * queue is PAUSED for the whole run (the `verify-money-payment-receipt.ts` pattern) and every
 * `visit-dispatched` job enqueued by a positive dispatch is found (by `workOrderUrl` match — the
 * job has no deterministic id) and removed before the queue resumes in `finally`. No charge/
 * money path is touched.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-scheduling-fixes.ts
 */

import { database } from '@auxx/database'
import {
  addVisit,
  cancelVisitFollowing,
  dispatchVisit,
  materializeVisits,
  restoreVisit,
  scheduleVisit,
  setRecurrenceRule,
  setVisitStatus,
  unscheduleVisit,
} from '@auxx/lib/dispatch'
import { BadRequestError } from '@auxx/lib/errors'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import type { RecurrencePattern } from '@auxx/lib/recurrence'
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

// ── Date helpers (plain UTC math — no reliance on the engine's own date-fns helpers, the
// verify-dispatch-recurring.ts precedent) ──

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
}
function weekdayOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}
/** Midday UTC instant for a local ISO date — startMinute 720 under the 'UTC' org timezone. */
function middayUtc(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`)
}

// ── DB helpers ──

async function getVisit(workOrderInstanceId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  if (!visit) throw new Error(`No visit found for work order ${workOrderInstanceId}`)
  return visit
}

async function getVisitsSorted(workOrderInstanceId: string) {
  return database.query.WorkOrderVisit.findMany({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
    orderBy: (t, { asc }) => [asc(t.occurrenceDate), asc(t.startTime)],
  })
}

/** Same source `notify.ts`'s `resolveOrgTimezone` reads (first weekly `OperatingHours` row for
 * the org subject, `'UTC'` fallback) — reimplemented here (not exported from the dispatch
 * barrel) so the script resolves "today"/"tomorrow" identically to the code under test. */
async function resolveOrgTimezoneLocal(organizationId: string): Promise<string> {
  const row = await database.query.OperatingHours.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.organizationId, organizationId),
        eq(t.subjectType, 'organization'),
        eq(t.kind, 'weekly')
      ),
    columns: { timezone: true },
  })
  return row?.timezone ?? 'UTC'
}

async function expectThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err ?? new Error('threw a falsy value')
  }
}

/** Find + remove the `visit-dispatched` email job(s) a positive `dispatchVisit` call enqueued.
 * The job has no deterministic id (`enqueueEmailJob` isn't called with an `idempotencyKey`), so
 * it's located by its `workOrderUrl` payload — safe because the queue is paused for the whole
 * run and every work order title/id here is verify-run-scoped. Returns the count removed (used
 * as a positive assertion that the send path really was reached). */
async function drainDispatchEmailJobs(workOrderInstanceId: string): Promise<number> {
  const queue = getQueue(Queues.emailQueue)
  const jobs = await queue.getJobs(['waiting', 'paused', 'delayed'])
  const matches = jobs.filter((job) => {
    const data = job.data as { emailType?: string; payload?: Record<string, unknown> }
    const url = data.payload?.workOrderUrl
    return (
      data.emailType === 'visit-dispatched' &&
      typeof url === 'string' &&
      url.includes(workOrderInstanceId)
    )
  })
  for (const job of matches) await job.remove()
  return matches.length
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as M1/M2)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const timezone = await resolveOrgTimezoneLocal(organizationId)
  if (timezone !== 'UTC') {
    throw new Error(
      `Expected the dev org to resolve to 'UTC' (no OperatingHours row) — got '${timezone}'. ` +
        `This script's day-boundary math assumes UTC; update it before relying on results.`
    )
  }
  const todayIso = isoDate(new Date())
  const tomorrowIso = addDaysToIso(todayIso, 1)
  const yesterdayIso = addDaysToIso(todayIso, -1)
  const plus3Iso = addDaysToIso(todayIso, 3)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []
  const dispatchDrainTargets: string[] = []

  async function createWO(title: string) {
    const wo = await handler.create('work_order', {
      work_order_title: `[scheduling-fixes-verify] ${title}`,
    })
    createdRecordIds.push(wo.recordId)
    return wo
  }

  // PAUSE the email queue for the whole run — the dev worker is live and would otherwise send
  // every `visit-dispatched` email a positive dispatch enqueues. Paused, jobs stay queued and
  // inspectable; drained per-check below and swept again + resumed in `finally`.
  await getQueue(Queues.emailQueue).pause()

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Restore: dispatch → cancel (dispatchedAt clears) → restore in place; restore on a
    //    non-canceled visit rejected.
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: restore')
    const wo1 = await createWO('restore')
    const visit1 = await getVisit(wo1.instance.id)
    const start1 = middayUtc(todayIso)
    const end1 = new Date(start1.getTime() + 60 * 60_000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visit1.id,
      startTime: start1,
      endTime: end1,
      assigneeUserId: userId,
    })
    const dispatched1 = await dispatchVisit({ organizationId, userId, visitId: visit1.id })
    check('setup: dispatch stamps dispatchedAt', dispatched1.dispatchedAt !== null)
    dispatchDrainTargets.push(wo1.instance.id)
    const drained1 = await drainDispatchEmailJobs(wo1.instance.id)
    check('setup: dispatch email enqueued (and drained, not sent)', drained1 >= 1, drained1)

    const canceled1 = await setVisitStatus({
      organizationId,
      userId,
      visitId: visit1.id,
      status: 'canceled',
    })
    check('cancel sets status = canceled', canceled1.status === 'canceled')
    check('cancel clears dispatchedAt', canceled1.dispatchedAt === null, canceled1.dispatchedAt)

    const restored1 = await restoreVisit({ organizationId, userId, visitId: visit1.id })
    check('restore: same row id', restored1.id === visit1.id)
    check('restore: status -> scheduled', restored1.status === 'scheduled')
    check(
      'restore: startTime unchanged',
      restored1.startTime?.getTime() === start1.getTime(),
      restored1.startTime
    )
    check('restore: isDetached unchanged (false, rule-less)', restored1.isDetached === false)
    check('restore: dispatchedAt still null', restored1.dispatchedAt === null)

    const errRestoreNonCanceled = await expectThrow(() =>
      restoreVisit({ organizationId, userId, visitId: visit1.id })
    )
    check(
      'restore on a non-canceled (scheduled) visit -> BadRequestError',
      errRestoreNonCanceled instanceof BadRequestError,
      errRestoreNonCanceled
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. unscheduleVisit also clears dispatchedAt (cancel's clearing already proven in #1).
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: unschedule clears dispatchedAt')
    const wo2 = await createWO('unschedule clears dispatchedAt')
    const visit2 = await getVisit(wo2.instance.id)
    const start2 = middayUtc(todayIso)
    const end2 = new Date(start2.getTime() + 60 * 60_000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visit2.id,
      startTime: start2,
      endTime: end2,
      assigneeUserId: userId,
    })
    const dispatched2 = await dispatchVisit({ organizationId, userId, visitId: visit2.id })
    check('setup: dispatch stamps dispatchedAt', dispatched2.dispatchedAt !== null)
    dispatchDrainTargets.push(wo2.instance.id)
    await drainDispatchEmailJobs(wo2.instance.id)

    const unscheduled2 = await unscheduleVisit({ organizationId, userId, visitId: visit2.id })
    check('unschedule clears dispatchedAt', unscheduled2.dispatchedAt === null)
    check(
      'unschedule clears startTime/endTime',
      unscheduled2.startTime === null && unscheduled2.endTime === null
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. Transition guard: done -> * rejected; canceled -> en_route rejected; canceled ->
    //    scheduled rejected (only restoreVisit revives); same-status write is a no-op.
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: transition guard')
    const wo3a = await createWO('transition guard: done terminal')
    const visit3a = await getVisit(wo3a.instance.id)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visit3a.id,
      startTime: middayUtc(todayIso),
      endTime: new Date(middayUtc(todayIso).getTime() + 30 * 60_000),
    })
    const done3a = await setVisitStatus({
      organizationId,
      userId,
      visitId: visit3a.id,
      status: 'done',
    })
    check('setup: status -> done', done3a.status === 'done')
    const errDoneToScheduled = await expectThrow(() =>
      setVisitStatus({ organizationId, userId, visitId: visit3a.id, status: 'scheduled' })
    )
    check(
      'done -> scheduled rejected',
      errDoneToScheduled instanceof BadRequestError,
      errDoneToScheduled
    )
    const errDoneToCanceled = await expectThrow(() =>
      setVisitStatus({ organizationId, userId, visitId: visit3a.id, status: 'canceled' })
    )
    check(
      'done -> canceled rejected',
      errDoneToCanceled instanceof BadRequestError,
      errDoneToCanceled
    )
    const doneAgain = await setVisitStatus({
      organizationId,
      userId,
      visitId: visit3a.id,
      status: 'done',
    })
    check('same-status (done) write is a no-op, no throw', doneAgain.status === 'done')

    const wo3b = await createWO('transition guard: canceled')
    const visit3b = await getVisit(wo3b.instance.id)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visit3b.id,
      startTime: middayUtc(todayIso),
      endTime: new Date(middayUtc(todayIso).getTime() + 30 * 60_000),
    })
    const canceled3b = await setVisitStatus({
      organizationId,
      userId,
      visitId: visit3b.id,
      status: 'canceled',
    })
    check('setup: status -> canceled', canceled3b.status === 'canceled')
    const errCanceledToEnRoute = await expectThrow(() =>
      setVisitStatus({ organizationId, userId, visitId: visit3b.id, status: 'en_route' })
    )
    check(
      'canceled -> en_route rejected',
      errCanceledToEnRoute instanceof BadRequestError,
      errCanceledToEnRoute
    )
    const errCanceledToScheduled = await expectThrow(() =>
      setVisitStatus({ organizationId, userId, visitId: visit3b.id, status: 'scheduled' })
    )
    check(
      'canceled -> scheduled via setVisitStatus rejected (must use restoreVisit)',
      errCanceledToScheduled instanceof BadRequestError,
      errCanceledToScheduled
    )
    const canceledAgain = await setVisitStatus({
      organizationId,
      userId,
      visitId: visit3b.id,
      status: 'canceled',
    })
    check('same-status (canceled) write is a no-op, no throw', canceledAgain.status === 'canceled')

    // ══════════════════════════════════════════════════════════════════════
    // 4. Dispatch window: today OK, tomorrow OK, +3d rejected, yesterday rejected, canceled/
    //    done rejected.
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: dispatch window')
    async function makeAssignedVisit(dateIso: string, label: string) {
      const wo = await createWO(`dispatch window: ${label}`)
      const visit = await getVisit(wo.instance.id)
      const start = middayUtc(dateIso)
      const end = new Date(start.getTime() + 60 * 60_000)
      await scheduleVisit({
        organizationId,
        userId,
        visitId: visit.id,
        startTime: start,
        endTime: end,
        assigneeUserId: userId,
      })
      return { wo, visitId: visit.id }
    }

    const today4 = await makeAssignedVisit(todayIso, 'today')
    const dispatchedToday = await dispatchVisit({
      organizationId,
      userId,
      visitId: today4.visitId,
    })
    check('dispatch OK for a visit starting today', dispatchedToday.dispatchedAt !== null)
    dispatchDrainTargets.push(today4.wo.instance.id)
    const drainedToday = await drainDispatchEmailJobs(today4.wo.instance.id)
    check('today dispatch enqueued its email (drained, not sent)', drainedToday >= 1, drainedToday)

    const tomorrow4 = await makeAssignedVisit(tomorrowIso, 'tomorrow')
    const dispatchedTomorrow = await dispatchVisit({
      organizationId,
      userId,
      visitId: tomorrow4.visitId,
    })
    check('dispatch OK for a visit starting tomorrow', dispatchedTomorrow.dispatchedAt !== null)
    dispatchDrainTargets.push(tomorrow4.wo.instance.id)
    const drainedTomorrow = await drainDispatchEmailJobs(tomorrow4.wo.instance.id)
    check(
      'tomorrow dispatch enqueued its email (drained, not sent)',
      drainedTomorrow >= 1,
      drainedTomorrow
    )

    const plus3_4 = await makeAssignedVisit(plus3Iso, '+3 days')
    const errPlus3 = await expectThrow(() =>
      dispatchVisit({ organizationId, userId, visitId: plus3_4.visitId })
    )
    check(
      'dispatch rejected for a visit +3 days out',
      errPlus3 instanceof BadRequestError,
      errPlus3
    )

    const yesterday4 = await makeAssignedVisit(yesterdayIso, 'yesterday')
    const errYesterday = await expectThrow(() =>
      dispatchVisit({ organizationId, userId, visitId: yesterday4.visitId })
    )
    check(
      'dispatch rejected for a visit that started yesterday',
      errYesterday instanceof BadRequestError,
      errYesterday
    )

    const canceled4 = await makeAssignedVisit(todayIso, 'canceled')
    await setVisitStatus({
      organizationId,
      userId,
      visitId: canceled4.visitId,
      status: 'canceled',
    })
    const errCanceledDispatch = await expectThrow(() =>
      dispatchVisit({ organizationId, userId, visitId: canceled4.visitId })
    )
    check(
      'dispatch rejected for a canceled visit',
      errCanceledDispatch instanceof BadRequestError,
      errCanceledDispatch
    )

    const done4 = await makeAssignedVisit(todayIso, 'done')
    await setVisitStatus({ organizationId, userId, visitId: done4.visitId, status: 'done' })
    const errDoneDispatch = await expectThrow(() =>
      dispatchVisit({ organizationId, userId, visitId: done4.visitId })
    )
    check(
      'dispatch rejected for a done visit',
      errDoneDispatch instanceof BadRequestError,
      errDoneDispatch
    )

    // ══════════════════════════════════════════════════════════════════════
    // 5. Adoption at rule CREATE: matching startMinute adopts non-detached; mismatched
    //    startMinute adopts detached; rule EDIT never adopts.
    // ══════════════════════════════════════════════════════════════════════
    console.log('5a: adoption on create — matching template slot')
    const wo5 = await createWO('adoption matching')
    const visit5 = await getVisit(wo5.instance.id)
    const anchorDate5 = addDaysToIso(todayIso, 10)
    const weekday5 = weekdayOfIso(anchorDate5)
    const matchStart5 = middayUtc(anchorDate5) // 12:00 UTC = startMinute 720
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visit5.id,
      startTime: matchStart5,
      endTime: new Date(matchStart5.getTime() + 60 * 60_000),
    })
    const pattern5: RecurrencePattern = { frequency: 'weekly', interval: 1, weekdays: [weekday5] }
    const rule5 = await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo5.instance.id,
      pattern: pattern5,
      template: { startMinute: 720, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: anchorDate5,
    })
    const wo5RowsAfterCreate = await getVisitsSorted(wo5.instance.id)
    const adopted5 = wo5RowsAfterCreate.find((r) => r.id === visit5.id)
    check(
      'adoption: pre-existing standalone row adopted (recurrenceRuleId set)',
      adopted5?.recurrenceRuleId === rule5.id,
      adopted5
    )
    check(
      "adoption: occurrenceDate = the visit's own local date",
      adopted5?.occurrenceDate === anchorDate5,
      adopted5?.occurrenceDate
    )
    check(
      'adoption: isDetached = false (time matches the template slot)',
      adopted5?.isDetached === false,
      adopted5
    )
    const dupRows5 = wo5RowsAfterCreate.filter((r) => r.occurrenceDate === anchorDate5)
    check('adoption: no duplicate row for the adopted date', dupRows5.length === 1, dupRows5.length)

    console.log('5b: adoption on create — mismatched template slot (detached)')
    const wo5b = await createWO('adoption mismatch')
    const visit5b = await getVisit(wo5b.instance.id)
    const anchorDate5b = addDaysToIso(todayIso, 11)
    const weekday5b = weekdayOfIso(anchorDate5b)
    const mismatchStart5b = new Date(`${anchorDate5b}T09:00:00.000Z`) // 540min, template will be 720
    await scheduleVisit({
      organizationId,
      userId,
      visitId: visit5b.id,
      startTime: mismatchStart5b,
      endTime: new Date(mismatchStart5b.getTime() + 30 * 60_000),
    })
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo5b.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [weekday5b] },
      template: { startMinute: 720, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: anchorDate5b,
    })
    const wo5bRows = await getVisitsSorted(wo5b.instance.id)
    const adopted5b = wo5bRows.find((r) => r.id === visit5b.id)
    check(
      'adoption: mismatched-time row still adopted (recurrenceRuleId set)',
      adopted5b?.recurrenceRuleId != null,
      adopted5b
    )
    check(
      "adoption: occurrenceDate = the visit's own local date",
      adopted5b?.occurrenceDate === anchorDate5b,
      adopted5b?.occurrenceDate
    )
    check(
      'adoption: isDetached = true (time does NOT match the template slot)',
      adopted5b?.isDetached === true,
      adopted5b
    )

    console.log('5c: rule EDIT never adopts')
    const extraVisit5c = await addVisit({
      organizationId,
      userId,
      workOrderInstanceId: wo5.instance.id,
    })
    const extraDate5c = addDaysToIso(todayIso, 12)
    const extraStart5c = middayUtc(extraDate5c)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: extraVisit5c.id,
      startTime: extraStart5c,
      endTime: new Date(extraStart5c.getTime() + 60 * 60_000),
    })
    // Template-only edit on the ALREADY-EXISTING rule from 5a — a standalone scheduled visit
    // present at edit time must stay rule-less (adoption is create-only).
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo5.instance.id,
      pattern: pattern5,
      template: { startMinute: 720, durationMinutes: 90 },
      timezone: 'UTC',
      effectiveFrom: anchorDate5,
    })
    const wo5RowsAfterEdit = await getVisitsSorted(wo5.instance.id)
    const extraAfterEdit5c = wo5RowsAfterEdit.find((r) => r.id === extraVisit5c.id)
    check(
      'rule edit does NOT adopt a standalone scheduled visit present at edit time',
      extraAfterEdit5c?.recurrenceRuleId == null,
      extraAfterEdit5c
    )
    check('the un-adopted extra visit survives the edit', extraAfterEdit5c != null)

    // ══════════════════════════════════════════════════════════════════════
    // 6. addVisit: rule-less unscheduled row on a recurring WO survives regeneration untouched
    //    (no occurrenceDate, doesn't block/consume any rule date).
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: addVisit extra survives regeneration')
    const wo6 = await createWO('add visit extra')
    const pattern6: RecurrencePattern = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [weekdayOfIso(todayIso)],
    }
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
      pattern: pattern6,
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo6RowsInitial = await getVisitsSorted(wo6.instance.id)
    const ruleRowCountInitial = wo6RowsInitial.filter((r) => r.recurrenceRuleId != null).length
    check('setup: rule materializes at least one row', ruleRowCountInitial > 0, ruleRowCountInitial)

    const extra6 = await addVisit({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
    })
    check(
      'addVisit creates a rule-less, unscheduled, occurrenceDate-less row',
      extra6.recurrenceRuleId == null && extra6.startTime == null && extra6.occurrenceDate == null,
      extra6
    )

    // Template-edit regeneration — must not delete/adopt/otherwise touch the extra row.
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
      pattern: pattern6,
      template: { startMinute: 540, durationMinutes: 75 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo6RowsAfter = await getVisitsSorted(wo6.instance.id)
    const extraAfter6 = wo6RowsAfter.find((r) => r.id === extra6.id)
    check('extra row survives a template-edit regeneration', extraAfter6 != null, extraAfter6)
    check(
      'extra row still rule-less/unscheduled/occurrenceDate-less after regeneration',
      extraAfter6?.recurrenceRuleId == null &&
        extraAfter6?.startTime == null &&
        extraAfter6?.occurrenceDate == null,
      extraAfter6
    )
    const ruleRowCountAfter = wo6RowsAfter.filter((r) => r.recurrenceRuleId != null).length
    check(
      'rule-linked row count unaffected by the extra row (nothing blocked)',
      ruleRowCountAfter === ruleRowCountInitial,
      { ruleRowCountInitial, ruleRowCountAfter }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 7. Series backlog ban: unscheduleVisit on a rule-linked visit is rejected.
    // ══════════════════════════════════════════════════════════════════════
    console.log('7: series backlog ban')
    const wo7 = await createWO('series backlog ban')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo7.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [weekdayOfIso(todayIso)] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo7Rows = await getVisitsSorted(wo7.instance.id)
    const seriesVisit7 = wo7Rows.find((r) => r.recurrenceRuleId != null)
    check('setup: a series-linked visit exists', seriesVisit7 != null, wo7Rows.length)
    const errSeriesUnschedule = await expectThrow(() =>
      unscheduleVisit({ organizationId, userId, visitId: seriesVisit7!.id })
    )
    check(
      'unscheduleVisit rejected on a series-linked visit',
      errSeriesUnschedule instanceof BadRequestError,
      errSeriesUnschedule
    )

    // ══════════════════════════════════════════════════════════════════════
    // 8. cancelVisitFollowing ("Skip this and future visits"): tombstones the target, stamps
    //    pattern.until = its occurrenceDate (count stripped), deletes LATER scheduled series
    //    rows, leaves earlier/done rows + rule-less extras alone, and a re-materialize never
    //    regenerates past the stamp.
    // ══════════════════════════════════════════════════════════════════════
    console.log('8: cancel this-and-following')
    const wo8 = await createWO('cancel following')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo8.instance.id,
      // Daily + count so the window holds several rows and the count-strip is provable.
      pattern: { frequency: 'daily', interval: 1, count: 10 },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo8Rows = await getVisitsSorted(wo8.instance.id)
    const seriesRows8 = wo8Rows.filter((r) => r.recurrenceRuleId != null)
    check('setup: several series rows materialized', seriesRows8.length >= 4, seriesRows8.length)
    const [first8, target8] = seriesRows8
    if (!first8 || !target8) throw new Error('section 8 setup failed')

    // Earlier occurrence goes done — must survive the cut untouched.
    await setVisitStatus({ organizationId, userId, visitId: first8.id, status: 'done' })
    // Deliberate rule-less extra — must survive too.
    const extra8 = await addVisit({ organizationId, userId, workOrderInstanceId: wo8.instance.id })

    // Rule-less rows are rejected before anything is written.
    const errCancelExtra = await expectThrow(() =>
      cancelVisitFollowing({ organizationId, userId, visitId: extra8.id })
    )
    check(
      'cancelVisitFollowing rejected on a rule-less visit',
      errCancelExtra instanceof BadRequestError,
      errCancelExtra
    )

    await cancelVisitFollowing({ organizationId, userId, visitId: target8.id })
    const rowsAfter8 = await getVisitsSorted(wo8.instance.id)
    const targetAfter8 = rowsAfter8.find((r) => r.id === target8.id)
    check('target occurrence is tombstoned (canceled)', targetAfter8?.status === 'canceled')
    const laterScheduled8 = rowsAfter8.filter(
      (r) =>
        r.recurrenceRuleId != null &&
        r.status === 'scheduled' &&
        r.occurrenceDate != null &&
        target8.occurrenceDate != null &&
        r.occurrenceDate > target8.occurrenceDate
    )
    check('all later scheduled series rows deleted', laterScheduled8.length === 0, laterScheduled8)
    check(
      'earlier done occurrence untouched',
      rowsAfter8.find((r) => r.id === first8.id)?.status === 'done'
    )
    check(
      'rule-less extra visit untouched',
      rowsAfter8.some((r) => r.id === extra8.id)
    )

    const rule8 = await database.query.RecurrenceRule.findFirst({
      where: (t, { eq }) => eq(t.subjectId, wo8.instance.id),
    })
    const pattern8 = rule8?.pattern as RecurrencePattern | undefined
    check(
      'pattern.until stamped with the target occurrenceDate',
      pattern8?.until === target8.occurrenceDate,
      pattern8
    )
    check('pattern.count stripped (until/count are exclusive)', pattern8?.count === undefined)

    // The sweep path must not resurrect anything past the stamp.
    if (rule8) await materializeVisits(rule8, { userId })
    const rowsReswept8 = await getVisitsSorted(wo8.instance.id)
    const regenerated8 = rowsReswept8.filter(
      (r) =>
        r.recurrenceRuleId != null &&
        r.occurrenceDate != null &&
        target8.occurrenceDate != null &&
        r.occurrenceDate > target8.occurrenceDate
    )
    check('re-materialize regenerates nothing past until', regenerated8.length === 0, regenerated8)
    check(
      'tombstone still blocks its own date after re-materialize (no duplicate row)',
      rowsReswept8.filter((r) => r.occurrenceDate === target8.occurrenceDate).length === 1
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
    // Defensive second sweep in case a check threw before its own drain ran.
    for (const workOrderInstanceId of dispatchDrainTargets) {
      try {
        await drainDispatchEmailJobs(workOrderInstanceId)
      } catch {
        // best-effort
      }
    }
    await getQueue(Queues.emailQueue)
      .resume()
      .catch(() => {})
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
