// apps/worker/scripts/verify-dispatch-series-end.ts
/**
 * Series-end symmetry verification (plans/dispatch/36-series-end-symmetry.md §C). Exercises
 * the REAL write paths in `packages/lib/src/dispatch/`:
 *
 * - `cancelVisitFollowing` (recurring/engagement-actions.ts): `until` stamp + tail delete +
 *   the new synchronous exhaustion check (must NOT end an engagement that still has upcoming
 *   occurrences).
 * - `restoreVisit` (visit-mutations.ts): visit-only restore leaves `until`; `resumeSeries`
 *   clears `until` + regenerates the tail; rejected off the series boundary and on an ended
 *   engagement.
 * - `setSeriesEnd` (recurring/rule-mutations.ts): shorten deletes the tail, extend/clear
 *   regenerates, past / pre-`effectiveFrom` / ended-engagement writes rejected.
 * - `maybeEndExhaustedEngagement` (recurring/materialize.ts): an empty generation window
 *   (`until < effectiveFrom`, the WO-0002 specimen) auto-ends the engagement as soon as no
 *   future scheduled rows remain.
 *
 * Work orders are created via `UnifiedCrudHandler.create` (M1 hooks), prefixed
 * "[series-end-verify]", and deleted at the end — `WorkOrderVisit.workOrderId` AND
 * `RecurrenceRule.subjectId` cascade on `EntityInstance` delete (the
 * `verify-dispatch-recurring.ts` precedent). No dispatch/notification/money path is touched,
 * so no queue pausing is needed (unlike `verify-dispatch-scheduling-fixes.ts`).
 *
 * Timing: the dev org has no `OperatingHours` row so the org resolves to 'UTC' (asserted as a
 * precondition); all rules here are created with `timezone: 'UTC'` and day math is plain UTC.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-series-end.ts
 */

import { database } from '@auxx/database'
import {
  cancelVisitFollowing,
  getWorkOrderStatus,
  materializeVisits,
  restoreVisit,
  setRecurrenceRule,
  setSeriesEnd,
  setVisitStatus,
} from '@auxx/lib/dispatch'
import { BadRequestError } from '@auxx/lib/errors'
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

async function getVisitsSorted(workOrderInstanceId: string) {
  return database.query.WorkOrderVisit.findMany({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
    orderBy: (t, { asc }) => [asc(t.occurrenceDate), asc(t.startTime)],
  })
}

async function getRule(workOrderInstanceId: string) {
  const rule = await database.query.RecurrenceRule.findFirst({
    where: (t, { eq }) => eq(t.subjectId, workOrderInstanceId),
  })
  if (!rule) throw new Error(`No rule for work order ${workOrderInstanceId}`)
  return rule
}

async function getPattern(workOrderInstanceId: string): Promise<RecurrencePattern> {
  return (await getRule(workOrderInstanceId)).pattern as RecurrencePattern
}

async function expectThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err ?? new Error('threw a falsy value')
  }
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

  const todayIso = isoDate(new Date())
  const anchorIso = addDaysToIso(todayIso, 3)
  const weekday = weekdayOfIso(anchorIso)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []

  async function createRecurringWO(title: string, pattern: RecurrencePattern) {
    const wo = await handler.create('work_order', {
      work_order_title: `[series-end-verify] ${title}`,
    })
    createdRecordIds.push(wo.recordId)
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo.instance.id,
      pattern,
      template: { startMinute: 720, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: anchorIso,
    })
    return wo
  }

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Skip-future stamps `until`, deletes the tail, does NOT end an engagement that
    //    still has upcoming occurrences; visit-only restore leaves `until` in place.
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: skip-future → restore (visit only)')
    const weekly: RecurrencePattern = { frequency: 'weekly', interval: 1, weekdays: [weekday] }
    const wo1 = await createRecurringWO('skip-future restore', weekly)
    const rows1 = (await getVisitsSorted(wo1.instance.id)).filter((r) => r.recurrenceRuleId)
    check('setup: horizon materialized several occurrences', rows1.length >= 4, rows1.length)
    const target1 = rows1[2]!

    await cancelVisitFollowing({ organizationId, userId, visitId: target1.id })
    const after1 = await getVisitsSorted(wo1.instance.id)
    check(
      'target tombstoned (canceled)',
      after1.find((r) => r.id === target1.id)?.status === 'canceled'
    )
    check(
      'later scheduled rows deleted',
      after1.filter(
        (r) =>
          r.occurrenceDate && target1.occurrenceDate && r.occurrenceDate > target1.occurrenceDate
      ).length === 0
    )
    check(
      'pattern.until = target occurrenceDate',
      (await getPattern(wo1.instance.id)).until === target1.occurrenceDate
    )
    check(
      'exhaustion check did NOT end the engagement (upcoming occurrences remain)',
      (await getWorkOrderStatus(organizationId, userId, wo1.instance.id)) === 'active'
    )

    await restoreVisit({ organizationId, userId, visitId: target1.id })
    const restored1 = (await getVisitsSorted(wo1.instance.id)).find((r) => r.id === target1.id)
    check('visit-only restore: status → scheduled in place', restored1?.status === 'scheduled')
    check(
      'visit-only restore leaves pattern.until (series still ends there)',
      (await getPattern(wo1.instance.id)).until === target1.occurrenceDate
    )
    await materializeVisits(await getRule(wo1.instance.id), { userId })
    check(
      're-materialize regenerates nothing past until',
      (await getVisitsSorted(wo1.instance.id)).filter(
        (r) =>
          r.occurrenceDate && target1.occurrenceDate && r.occurrenceDate > target1.occurrenceDate
      ).length === 0
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. Boundary restore with resumeSeries clears `until` + regenerates the tail;
    //    resumeSeries off the boundary is rejected.
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: skip-future → restore + resume')
    await cancelVisitFollowing({ organizationId, userId, visitId: target1.id })
    await restoreVisit({ organizationId, userId, visitId: target1.id, resumeSeries: true })
    const pattern2 = await getPattern(wo1.instance.id)
    check('resume clears pattern.until (open-ended again)', pattern2.until === undefined, pattern2)
    const resumed2 = await getVisitsSorted(wo1.instance.id)
    check(
      'resume regenerates the tail past the old boundary',
      resumed2.some(
        (r) =>
          r.status === 'scheduled' &&
          r.occurrenceDate &&
          target1.occurrenceDate &&
          r.occurrenceDate > target1.occurrenceDate
      )
    )
    check(
      'restored boundary row not duplicated',
      resumed2.filter((r) => r.occurrenceDate === target1.occurrenceDate).length === 1
    )

    const nonBoundary2 = resumed2.find((r) => r.recurrenceRuleId && r.status === 'scheduled')!
    await setVisitStatus({ organizationId, userId, visitId: nonBoundary2.id, status: 'canceled' })
    const err2 = await expectThrow(() =>
      restoreVisit({ organizationId, userId, visitId: nonBoundary2.id, resumeSeries: true })
    )
    check(
      'resumeSeries off the boundary rejected (BadRequest)',
      err2 instanceof BadRequestError,
      err2
    )
    await restoreVisit({ organizationId, userId, visitId: nonBoundary2.id })

    // ══════════════════════════════════════════════════════════════════════
    // 3. setSeriesEnd: shorten deletes the tail; invalid writes rejected; clear regenerates.
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: setSeriesEnd')
    const rows3 = (await getVisitsSorted(wo1.instance.id)).filter(
      (r) => r.recurrenceRuleId && r.status === 'scheduled'
    )
    const cutoff3 = rows3[1]!.occurrenceDate!
    await setSeriesEnd({
      organizationId,
      userId,
      workOrderInstanceId: wo1.instance.id,
      until: cutoff3,
    })
    check('shorten stamps pattern.until', (await getPattern(wo1.instance.id)).until === cutoff3)
    check(
      'shorten deletes scheduled rows past the end',
      (await getVisitsSorted(wo1.instance.id)).filter(
        (r) => r.status === 'scheduled' && r.occurrenceDate && r.occurrenceDate > cutoff3
      ).length === 0
    )

    const errPast = await expectThrow(() =>
      setSeriesEnd({
        organizationId,
        userId,
        workOrderInstanceId: wo1.instance.id,
        until: addDaysToIso(todayIso, -1),
      })
    )
    check('past end date rejected', errPast instanceof BadRequestError, errPast)

    // effectiveFrom is the anchor (today+3); today+1 is >= today but before it.
    const errWindow = await expectThrow(() =>
      setSeriesEnd({
        organizationId,
        userId,
        workOrderInstanceId: wo1.instance.id,
        until: addDaysToIso(todayIso, 1),
      })
    )
    check('end date before effectiveFrom rejected', errWindow instanceof BadRequestError, errWindow)

    await setSeriesEnd({
      organizationId,
      userId,
      workOrderInstanceId: wo1.instance.id,
      until: null,
    })
    check('clear removes pattern.until', (await getPattern(wo1.instance.id)).until === undefined)
    check(
      'clear regenerates the tail',
      (await getVisitsSorted(wo1.instance.id)).some(
        (r) => r.status === 'scheduled' && r.occurrenceDate && r.occurrenceDate > cutoff3
      )
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. Empty generation window (until < effectiveFrom, the WO-0002 specimen) auto-ends the
    //    engagement once no future scheduled rows remain; ended engagements reject both
    //    setSeriesEnd and resumeSeries.
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: window-empty auto-end')
    const bounded: RecurrencePattern = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [weekday],
      until: addDaysToIso(anchorIso, 7), // exactly two occurrences: anchor, anchor+7
    }
    const wo4 = await createRecurringWO('window empty', bounded)
    const rows4 = (await getVisitsSorted(wo4.instance.id)).filter((r) => r.recurrenceRuleId)
    check('setup: bounded series materialized 2 occurrences', rows4.length === 2, rows4.length)
    for (const row of rows4) {
      await setVisitStatus({ organizationId, userId, visitId: row.id, status: 'canceled' })
    }
    check(
      'skips alone do not end the series early (until still ahead)',
      (await getWorkOrderStatus(organizationId, userId, wo4.instance.id)) === 'active'
    )

    // Scope-edit re-anchor past the pattern's own end — legal, but the window is now empty
    // and nothing is upcoming, so the synchronous exhaustion check must end the engagement.
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo4.instance.id,
      pattern: bounded,
      template: { startMinute: 720, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: addDaysToIso(anchorIso, 14),
    })
    check(
      'empty-window scope edit auto-ends the engagement',
      (await getWorkOrderStatus(organizationId, userId, wo4.instance.id)) === 'ended'
    )

    const errEnded = await expectThrow(() =>
      setSeriesEnd({
        organizationId,
        userId,
        workOrderInstanceId: wo4.instance.id,
        until: addDaysToIso(anchorIso, 30),
      })
    )
    check('setSeriesEnd on an ended engagement rejected', errEnded instanceof BadRequestError)

    const boundary4 = (await getVisitsSorted(wo4.instance.id)).find(
      (r) => r.occurrenceDate === bounded.until
    )!
    const errResumeEnded = await expectThrow(() =>
      restoreVisit({ organizationId, userId, visitId: boundary4.id, resumeSeries: true })
    )
    check(
      'resumeSeries on an ended engagement rejected',
      errResumeEnded instanceof BadRequestError,
      errResumeEnded
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
