// apps/worker/scripts/verify-dispatch-paste-visits.ts
/**
 * `pasteVisits` verification (plans/dispatch/37c-calendar-create-copy-paste.md §4.4/§9 Phase
 * 3). Exercises the REAL write path `pasteVisits` (packages/lib/src/dispatch/paste-visits.ts),
 * a sequential loop over the existing `addVisit` primitive — no new scheduling logic, so this
 * script's job is checking the BATCH contract `addVisit` itself doesn't have:
 *
 * - Invariant B (decision B): a one-off work order (which already carries its auto-created
 *   first visit, `ensureVisitOnWorkOrderCreate`) gains a SECOND visit via paste without the
 *   server blocking it.
 * - A pasted copy of a series visit's time lands as a plain rule-less clone
 *   (`recurrenceRuleId: null`, `occurrenceDate: null`) on the same work order — a paste is a
 *   manual clone, never a detachment of the series itself.
 * - Per-item assignee semantics: retarget (explicit userId), clear (explicit `null`), and the
 *   omitted-key case (nothing to "keep" on a brand-new row, so it lands unassigned — same
 *   contract `addVisit`/`scheduleVisit` already have for a fresh insert).
 * - Partial failure: one bogus `workOrderInstanceId` among valid items lands in `failures` at
 *   its own index; every other item still commits (no transaction, no all-or-nothing).
 *
 * Work orders are created via `UnifiedCrudHandler.create` (M1 hooks), prefixed
 * "[paste-visits-verify]", and deleted at the end — `WorkOrderVisit.workOrderId` AND
 * `RecurrenceRule.subjectId` cascade on `EntityInstance` delete (the
 * `verify-dispatch-series-end.ts` precedent). No dispatch/notification/money path is touched
 * (fresh rows never carry a prior `dispatchedAt`, so `scheduleVisit`'s reschedule-notice guard
 * never fires), so no queue pausing is needed.
 *
 * Timing: the dev org has no `OperatingHours` row so the org resolves to 'UTC' (asserted as a
 * precondition, the `verify-dispatch-series-end.ts` precedent); all times here are plain UTC.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-paste-visits.ts
 */

import { database } from '@auxx/database'
import { pasteVisits, setRecurrenceRule } from '@auxx/lib/dispatch'
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
/** A UTC start/end pair `daysFromNow` at a fixed hour, `durationMinutes` long. */
function slot(daysFromNow: number, hour: number, durationMinutes = 60) {
  const start = new Date(`${addDaysToIso(isoDate(new Date()), daysFromNow)}T00:00:00.000Z`)
  start.setUTCHours(hour, 0, 0, 0)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return { startTime: start, endTime: end }
}

async function getVisitsSorted(workOrderInstanceId: string) {
  return database.query.WorkOrderVisit.findMany({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
    orderBy: (t, { asc }) => [asc(t.occurrenceDate), asc(t.startTime)],
  })
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const opHours = await database.query.OperatingHours.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.subjectType, 'organization')),
    columns: { timezone: true },
  })
  if (opHours?.timezone && opHours.timezone !== 'UTC') {
    throw new Error(`Expected dev org timezone 'UTC', got '${opHours.timezone}'`)
  }

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Invariant B — a one-off work order (already carries its auto-created first visit)
    //    gains a second visit via paste.
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: one-off work order gains a 2nd visit via paste (invariant B)')
    const wo1 = await handler.create('work_order', {
      work_order_title: '[paste-visits-verify] one-off invariant B',
    })
    createdRecordIds.push(wo1.recordId)
    const before1 = await getVisitsSorted(wo1.instance.id)
    check('setup: work order auto-creates exactly 1 visit', before1.length === 1, before1.length)

    const item1 = slot(5, 9)
    const result1 = await pasteVisits({
      organizationId,
      userId,
      items: [{ workOrderInstanceId: wo1.instance.id, ...item1 }],
    })
    check(
      'paste onto a one-off WO: 1 created, 0 failures',
      result1.created.length === 1 && result1.failures.length === 0,
      result1
    )
    const after1 = await getVisitsSorted(wo1.instance.id)
    check(
      'one-off WO now carries 2 visits (extra visit allowed)',
      after1.length === 2,
      after1.length
    )
    const pasted1 = after1.find((v) => v.id === result1.created[0]?.id)
    check(
      'pasted visit is a plain rule-less row, scheduled',
      pasted1?.recurrenceRuleId === null &&
        pasted1?.occurrenceDate === null &&
        pasted1?.status === 'scheduled',
      pasted1
    )
    check(
      'pasted visit times match the item',
      pasted1?.startTime?.getTime() === item1.startTime.getTime() &&
        pasted1?.endTime?.getTime() === item1.endTime.getTime()
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. Pasting a copy of a series visit produces a plain rule-less clone on the same WO.
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: paste of a series visit → plain rule-less clone')
    const todayIso = isoDate(new Date())
    const anchorIso = addDaysToIso(todayIso, 3)
    const weekday = weekdayOfIso(anchorIso)
    const wo2 = await handler.create('work_order', {
      work_order_title: '[paste-visits-verify] series clone',
    })
    createdRecordIds.push(wo2.recordId)
    const weekly: RecurrencePattern = { frequency: 'weekly', interval: 1, weekdays: [weekday] }
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo2.instance.id,
      pattern: weekly,
      template: { startMinute: 600, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: anchorIso,
    })
    const seriesRows = (await getVisitsSorted(wo2.instance.id)).filter((r) => r.recurrenceRuleId)
    check(
      'setup: series materialized at least 1 occurrence',
      seriesRows.length >= 1,
      seriesRows.length
    )
    const sourceOccurrence = seriesRows[0]!
    check(
      'setup: source occurrence carries series identity',
      sourceOccurrence.recurrenceRuleId !== null && sourceOccurrence.occurrenceDate !== null
    )

    // Copy the occurrence's time onto a NEW slot on the same day (avoids colliding with the
    // template row itself; invariant B allows the overlap regardless).
    const cloneStart = new Date(sourceOccurrence.startTime!.getTime() + 2 * 60 * 60_000)
    const cloneEnd = new Date(sourceOccurrence.endTime!.getTime() + 2 * 60 * 60_000)
    const result2 = await pasteVisits({
      organizationId,
      userId,
      items: [{ workOrderInstanceId: wo2.instance.id, startTime: cloneStart, endTime: cloneEnd }],
    })
    check(
      'paste of series-visit time: 1 created, 0 failures',
      result2.created.length === 1 && result2.failures.length === 0,
      result2
    )
    const clone2 = result2.created[0]
    check(
      'clone is rule-less (recurrenceRuleId/occurrenceDate null) — a manual clone, not a detachment',
      clone2?.recurrenceRuleId === null && clone2?.occurrenceDate === null,
      clone2
    )
    check('clone lands on the same work order', clone2?.workOrderId === wo2.instance.id)
    check('clone is scheduled', clone2?.status === 'scheduled')
    check(
      'original series occurrence untouched (still carries its series identity)',
      (await getVisitsSorted(wo2.instance.id)).find((r) => r.id === sourceOccurrence.id)
        ?.recurrenceRuleId === sourceOccurrence.recurrenceRuleId
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. Assignee semantics: retarget (explicit userId) / clear (explicit null) / omitted key
    //    (nothing to "keep" on a brand-new row — lands unassigned, same as `addVisit` today).
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: assignee semantics — retarget / clear / omitted')
    const wo3 = await handler.create('work_order', {
      work_order_title: '[paste-visits-verify] assignee semantics',
    })
    createdRecordIds.push(wo3.recordId)
    const retargetSlot = slot(6, 9)
    const clearSlot = slot(6, 11)
    const omittedSlot = slot(6, 13)
    const result3 = await pasteVisits({
      organizationId,
      userId,
      items: [
        { workOrderInstanceId: wo3.instance.id, ...retargetSlot, assigneeUserId: userId },
        { workOrderInstanceId: wo3.instance.id, ...clearSlot, assigneeUserId: null },
        { workOrderInstanceId: wo3.instance.id, ...omittedSlot },
      ],
    })
    check(
      'assignee-semantics batch: 3 created, 0 failures',
      result3.created.length === 3 && result3.failures.length === 0,
      result3
    )
    check(
      'retarget: assigneeUserId set to the given userId',
      result3.created[0]?.assigneeUserId === userId
    )
    check('clear: assigneeUserId explicitly null', result3.created[1]?.assigneeUserId === null)
    check(
      'omitted key: fresh row lands unassigned (nothing to keep)',
      result3.created[2]?.assigneeUserId === null
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. Partial failure: a bogus workOrderInstanceId among valid items lands in `failures` at
    //    its own index; the other items still commit.
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: partial failure — bogus item alongside valid items')
    const wo4 = await handler.create('work_order', {
      work_order_title: '[paste-visits-verify] partial failure',
    })
    createdRecordIds.push(wo4.recordId)
    const validSlotA = slot(7, 9)
    const validSlotB = slot(7, 11)
    const result4 = await pasteVisits({
      organizationId,
      userId,
      items: [
        { workOrderInstanceId: wo4.instance.id, ...validSlotA },
        { workOrderInstanceId: 'this-work-order-does-not-exist', ...slot(7, 10) },
        { workOrderInstanceId: wo4.instance.id, ...validSlotB },
      ],
    })
    check('partial failure: 2 created', result4.created.length === 2, result4)
    check('partial failure: exactly 1 failure', result4.failures.length === 1, result4.failures)
    check(
      'partial failure: failure is at index 1',
      result4.failures[0]?.index === 1,
      result4.failures
    )
    check(
      'partial failure: failure carries a message',
      typeof result4.failures[0]?.message === 'string' && result4.failures[0]!.message.length > 0,
      result4.failures[0]
    )
    check(
      'partial failure: the two valid items landed on the work order',
      // `status: 'scheduled'` alone doesn't distinguish these — the auto-created initial visit
      // is ALSO 'scheduled' despite carrying no time (`ensureVisitForWorkOrder`'s default).
      // `startTime` is what actually flips on a real schedule write.
      (await getVisitsSorted(wo4.instance.id)).filter((v) => v.startTime !== null).length === 2
    )
  } finally {
    console.log(`Cleanup: deleting ${createdRecordIds.length} verify records`)
    for (const recordId of createdRecordIds.reverse()) {
      try {
        await handler.delete(recordId as never)
      } catch (err) {
        console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
