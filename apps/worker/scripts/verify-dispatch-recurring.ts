// apps/worker/scripts/verify-dispatch-recurring.ts
/**
 * Dispatch M2c recurring-engine backend verification
 * (plans/dispatch/06-recurring-engine.md §7). Exercises the REAL write paths in
 * `packages/lib/src/dispatch/recurring/`: `setRecurrenceRule` (create + three-way edits +
 * regeneration), `pauseEngagement`/`resumeEngagement`/`endEngagement`, `materializeVisits`,
 * `sweepRecurringVisits`, and the pure `expandOccurrences` core (`@auxx/lib/recurrence`) for
 * deterministic date-math assertions (biweekly alignment, monthly day-31 clamp, nth-weekday,
 * count-tail completion). Also exercises the `rejectManualEngagementStatus` SystemHook (both
 * fieldId- and systemAttribute-keyed write forms) and the recurring-jobType early-return in
 * `rollUpWorkOrderStatus`/the mirror's next-upcoming resolution.
 *
 * Work orders are created via `UnifiedCrudHandler.create` (the M1 number + visit auto-create
 * hooks), prefixed "[recurring-verify]", and deleted at the end — `WorkOrderVisit.workOrderId`
 * AND `RecurrenceRule.subjectId` both cascade on `EntityInstance` delete, so per-work-order
 * visit/rule cleanup is automatic (`verify-dispatch-m2.ts` cascade precedent).
 *
 * Timing: all rules use `timezone: 'UTC'` so `todayLocalDate('UTC')` reduces to
 * `new Date().toISOString().slice(0, 10)` — no host-timezone dependence.
 *
 * NOTE: `sweepRecurringVisits()` has no org filter by design (matches the real daily job) —
 * calling it here also re-materializes/exhaustion-checks any OTHER active recurring rule in
 * the DB. Harmless/idempotent for unrelated rules; flagged here for transparency.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-recurring.ts
 */

import { database } from '@auxx/database'
import {
  materializeVisits,
  pauseEngagement,
  resumeEngagement,
  scheduleVisit,
  setRecurrenceRule,
  setVisitStatus,
  sweepRecurringVisits,
} from '@auxx/lib/dispatch'
import { BadRequestError } from '@auxx/lib/errors'
import { expandOccurrences, type RecurrencePattern } from '@auxx/lib/recurrence'
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

// ── Date helpers (plain math — no reliance on the engine's own date-fns helpers) ──

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
function expectedStartInstant(occurrenceDateIso: string, startMinute: number): Date {
  const hh = String(Math.floor(startMinute / 60)).padStart(2, '0')
  const mm = String(startMinute % 60).padStart(2, '0')
  return new Date(`${occurrenceDateIso}T${hh}:${mm}:00.000Z`)
}
/** Sunday-start week bucket, matching `expand.ts`'s `ALIGNMENT_WEEK_START = 0` convention. */
function startOfWeekSundayIso(iso: string): string {
  return addDaysToIso(iso, -weekdayOfIso(iso))
}
function weekIndexDiff(candidateIso: string, anchorIso: string): number {
  const a = new Date(`${startOfWeekSundayIso(anchorIso)}T00:00:00.000Z`).getTime()
  const c = new Date(`${startOfWeekSundayIso(candidateIso)}T00:00:00.000Z`).getTime()
  return Math.round((c - a) / (7 * 24 * 60 * 60 * 1000))
}
/** Expected occurrence dates for a weekly/every-N-weeks pattern over `[anchorIso, anchorIso+days]`
 * inclusive, reimplemented independently of `expand.ts` for a true cross-check. */
function expectedIntervalWeeklyDates(
  anchorIso: string,
  days: number,
  weekdays: number[],
  interval: number
): string[] {
  const out: string[] = []
  for (let i = 0; i <= days; i++) {
    const iso = addDaysToIso(anchorIso, i)
    if (!weekdays.includes(weekdayOfIso(iso))) continue
    if (weekIndexDiff(iso, anchorIso) % interval === 0) out.push(iso)
  }
  return out
}

// ── DB helpers ──

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function customFieldId(organizationId: string, entityType: string, systemAttribute: string) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  return field?.id ?? null
}

async function fieldValueByAttr(
  organizationId: string,
  entityType: 'work_order',
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

async function woJobType(organizationId: string, workOrderInstanceId: string) {
  const fv = await fieldValueByAttr(
    organizationId,
    'work_order',
    workOrderInstanceId,
    'work_order_job_type'
  )
  return fv?.optionId ?? null
}

async function getMirror(organizationId: string, workOrderInstanceId: string) {
  const start = await fieldValueByAttr(
    organizationId,
    'work_order',
    workOrderInstanceId,
    'work_order_scheduled_start'
  )
  const end = await fieldValueByAttr(
    organizationId,
    'work_order',
    workOrderInstanceId,
    'work_order_scheduled_end'
  )
  const assignee = await fieldValueByAttr(
    organizationId,
    'work_order',
    workOrderInstanceId,
    'work_order_assignee'
  )
  return { start, end, assignee }
}

function isNullMirrorValue(fv: { valueDate?: string | null; actorId?: string | null } | null) {
  return fv === null || (fv.valueDate == null && fv.actorId == null)
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
  if (!rule) throw new Error(`No recurrence rule for work order ${workOrderInstanceId}`)
  return rule
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
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as M1/M2)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const todayIso = isoDate(new Date())
  const yesterdayIso = addDaysToIso(todayIso, -1)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []

  async function createWO(title: string) {
    const wo = await handler.create('work_order', {
      work_order_title: `[recurring-verify] ${title}`,
    })
    createdRecordIds.push(wo.recordId)
    return wo
  }

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Rule create (weekly Tue+Thu, 9:00 AM, 60min) — materializes to ~56d
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: rule create (weekly Tue+Thu)')
    const wo1 = await createWO('weekly Tue+Thu')
    const pattern1: RecurrencePattern = { frequency: 'weekly', interval: 1, weekdays: [2, 4] }
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo1.instance.id,
      pattern: pattern1,
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo1Rows = await getVisitsSorted(wo1.instance.id)
    const wo1Rule = await getRule(wo1.instance.id)

    check(
      'status flipped to active',
      (await woStatus(organizationId, wo1.instance.id)) === 'active'
    )
    check(
      'jobType flipped to recurring',
      (await woJobType(organizationId, wo1.instance.id)) === 'recurring'
    )
    check(
      'placeholder unscheduled visit is gone',
      !wo1Rows.some((r) => r.recurrenceRuleId === null && r.startTime === null),
      wo1Rows.length
    )
    check(
      'materializedUntil set to ~today+56d',
      !!wo1Rule.materializedUntil &&
        wo1Rule.materializedUntil.getTime() > Date.now() + 54 * 24 * 60 * 60 * 1000,
      wo1Rule.materializedUntil
    )
    const wo1AllTue4hu = wo1Rows.every((r) => [2, 4].includes(weekdayOfIso(r.occurrenceDate!)))
    check('every row lands on Tue or Thu', wo1AllTue4hu)
    const wo1AllInWindow = wo1Rows.every(
      (r) => r.occurrenceDate! >= todayIso && r.occurrenceDate! <= addDaysToIso(todayIso, 56)
    )
    check('every occurrenceDate within [today, today+56d]', wo1AllInWindow)
    const wo1AllCorrectStart = wo1Rows.every(
      (r) => r.startTime!.getTime() === expectedStartInstant(r.occurrenceDate!, 540).getTime()
    )
    check('every startTime = occurrenceDate @ 9:00 UTC', wo1AllCorrectStart)
    const expected1 = expectedIntervalWeeklyDates(todayIso, 55, [2, 4], 1) // day 56 boundary is time-of-day-ambiguous
    const actual1WithinSafeWindow = wo1Rows
      .filter((r) => r.occurrenceDate! <= addDaysToIso(todayIso, 55))
      .map((r) => r.occurrenceDate!)
    check(
      'occurrenceDate set matches plain-date-math weekly expectation (safe window)',
      JSON.stringify(actual1WithinSafeWindow) === JSON.stringify(expected1),
      { actual: actual1WithinSafeWindow, expected: expected1 }
    )
    check(
      'rows all have durationMinutes = 60',
      wo1Rows.every((r) => r.endTime!.getTime() === r.startTime!.getTime() + 60 * 60_000)
    )

    // ══════════════════════════════════════════════════════════════════════
    // 2. Biweekly cadence alignment — exact alternating-week date list
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: biweekly cadence alignment')
    const wo2 = await createWO('biweekly Wed')
    const pattern2: RecurrencePattern = { frequency: 'weekly', interval: 2, weekdays: [3] }
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo2.instance.id,
      pattern: pattern2,
      template: { startMinute: 600, durationMinutes: 45 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo2Rows = await getVisitsSorted(wo2.instance.id)
    const expected2 = expectedIntervalWeeklyDates(todayIso, 55, [3], 2)
    const actual2 = wo2Rows
      .filter((r) => r.occurrenceDate! <= addDaysToIso(todayIso, 55))
      .map((r) => r.occurrenceDate!)
    check(
      'biweekly dates exactly match alternating-week expectation',
      JSON.stringify(actual2) === JSON.stringify(expected2),
      { actual: actual2, expected: expected2 }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. Monthly day-31 clamp — pure expansion (deterministic fixed dates) + DB sanity
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: monthly day-31 clamp')
    const leapFeb = expandOccurrences(
      { frequency: 'monthly', interval: 1, monthDay: 31 },
      {
        anchor: '2024-01-31',
        timezone: 'UTC',
        from: new Date('2024-02-01T00:00:00.000Z'),
        to: new Date('2024-03-01T00:00:00.000Z'),
        startMinute: 540,
      }
    )
    check(
      'Jan-31 monthly clamps to Feb 29 in a leap year',
      leapFeb.length === 1 && leapFeb[0]?.occurrenceDate === '2024-02-29',
      leapFeb
    )
    const nonLeapFeb = expandOccurrences(
      { frequency: 'monthly', interval: 1, monthDay: 31 },
      {
        anchor: '2025-01-31',
        timezone: 'UTC',
        from: new Date('2025-02-01T00:00:00.000Z'),
        to: new Date('2025-03-01T00:00:00.000Z'),
        startMinute: 540,
      }
    )
    check(
      'Jan-31 monthly clamps to Feb 28 in a non-leap year',
      nonLeapFeb.length === 1 && nonLeapFeb[0]?.occurrenceDate === '2025-02-28',
      nonLeapFeb
    )

    const wo3 = await createWO('monthly day-31 DB sanity')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo3.instance.id,
      pattern: { frequency: 'monthly', interval: 1, monthDay: 31 },
      template: { startMinute: 480, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo3Rows = await getVisitsSorted(wo3.instance.id)
    function daysInMonthUtc(year: number, monthIndex0: number) {
      return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
    }
    const wo3Clamped = wo3Rows.every((r) => {
      const d = new Date(`${r.occurrenceDate}T00:00:00.000Z`)
      const expectedDay = Math.min(31, daysInMonthUtc(d.getUTCFullYear(), d.getUTCMonth()))
      return d.getUTCDate() === expectedDay
    })
    check(
      'materialized monthly rows land on min(31, daysInMonth) (DB end-to-end sanity)',
      wo3Rows.length > 0 && wo3Clamped,
      wo3Rows.map((r) => r.occurrenceDate)
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. nth-weekday — pure expansion only (2nd Tuesday, last Friday of March 2024)
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: nth-weekday expansion')
    const secondTuesday = expandOccurrences(
      { frequency: 'monthly', interval: 1, nthWeekday: { nth: 2, weekday: 2 } },
      {
        anchor: '2023-01-01',
        timezone: 'UTC',
        from: new Date('2024-03-01T00:00:00.000Z'),
        to: new Date('2024-03-31T23:59:59.000Z'),
        startMinute: 540,
      }
    )
    check(
      '2nd Tuesday of March 2024 = Mar 12',
      secondTuesday.length === 1 && secondTuesday[0]?.occurrenceDate === '2024-03-12',
      secondTuesday
    )
    const lastFriday = expandOccurrences(
      { frequency: 'monthly', interval: 1, nthWeekday: { nth: -1, weekday: 5 } },
      {
        anchor: '2023-01-01',
        timezone: 'UTC',
        from: new Date('2024-03-01T00:00:00.000Z'),
        to: new Date('2024-03-31T23:59:59.000Z'),
        startMinute: 540,
      }
    )
    check(
      'last Friday of March 2024 = Mar 29',
      lastFriday.length === 1 && lastFriday[0]?.occurrenceDate === '2024-03-29',
      lastFriday
    )

    // ══════════════════════════════════════════════════════════════════════
    // 5. Skip consumes a count slot
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: skip consumes a count slot')
    const wo5 = await createWO('count-4 skip')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo5.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [1], count: 4 },
      template: { startMinute: 540, durationMinutes: 30 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo5RowsInitial = await getVisitsSorted(wo5.instance.id)
    check('count=4 materializes exactly 4 rows', wo5RowsInitial.length === 4, wo5RowsInitial.length)

    const canceledRow = wo5RowsInitial[1]!
    await setVisitStatus({ organizationId, userId, visitId: canceledRow.id, status: 'canceled' })

    const wo5Rule = await getRule(wo5.instance.id)
    await materializeVisits(wo5Rule, { userId })
    const wo5RowsAfter = await getVisitsSorted(wo5.instance.id)
    check(
      'total rows never exceed count after re-materialize',
      wo5RowsAfter.length === 4,
      wo5RowsAfter.length
    )
    const canceledDateRows = wo5RowsAfter.filter(
      (r) => r.occurrenceDate === canceledRow.occurrenceDate
    )
    check(
      'canceled date is never re-inserted (still exactly 1 row, still canceled)',
      canceledDateRows.length === 1 && canceledDateRows[0]?.status === 'canceled',
      canceledDateRows
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6. Detached semantics: survives template-only edit, dies on pattern edit
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: detached semantics')
    const wo6 = await createWO('detach Fri->Sat')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [5] },
      template: { startMinute: 600, durationMinutes: 45 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo6RowsInitial = await getVisitsSorted(wo6.instance.id)
    const detachTarget = wo6RowsInitial[2]!
    const detachedNewStart = new Date(detachTarget.startTime!.getTime() + 2 * 60 * 60_000)
    const detachedNewEnd = new Date(detachedNewStart.getTime() + 45 * 60_000)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: detachTarget.id,
      startTime: detachedNewStart,
      endTime: detachedNewEnd,
    })
    const detachedRowAfterReschedule = await database.query.WorkOrderVisit.findFirst({
      where: (t, { eq }) => eq(t.id, detachTarget.id),
    })
    check(
      'scheduleVisit sets isDetached=true on a series row',
      detachedRowAfterReschedule?.isDetached === true &&
        detachedRowAfterReschedule.occurrenceDate === detachTarget.occurrenceDate,
      detachedRowAfterReschedule
    )

    // Template-only edit (same pattern, new startMinute)
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [5] },
      template: { startMinute: 660, durationMinutes: 45 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo6RowsAfterTemplateEdit = await getVisitsSorted(wo6.instance.id)
    const detachedAfterTemplateEdit = wo6RowsAfterTemplateEdit.find((r) => r.id === detachTarget.id)
    check(
      'detached row survives a template-only edit with its rescheduled time unchanged',
      detachedAfterTemplateEdit?.startTime?.getTime() === detachedNewStart.getTime() &&
        detachedAfterTemplateEdit.isDetached === true,
      detachedAfterTemplateEdit
    )
    const nonDetachedSiblings = wo6RowsAfterTemplateEdit.filter((r) => r.id !== detachTarget.id)
    check(
      'non-detached siblings regenerated with the new startMinute (11:00 UTC)',
      nonDetachedSiblings.length > 0 &&
        nonDetachedSiblings.every(
          (r) => r.startTime!.getTime() === expectedStartInstant(r.occurrenceDate!, 660).getTime()
        ),
      nonDetachedSiblings.map((r) => r.startTime)
    )

    // Pattern edit (different weekday set) — detached row must die
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo6.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [6] },
      template: { startMinute: 660, durationMinutes: 45 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo6RowsAfterPatternEdit = await getVisitsSorted(wo6.instance.id)
    check(
      'detached row is deleted by a pattern edit',
      !wo6RowsAfterPatternEdit.some((r) => r.id === detachTarget.id)
    )
    check(
      'rows now follow the new weekday pattern (Sat)',
      wo6RowsAfterPatternEdit.length > 0 &&
        wo6RowsAfterPatternEdit.every((r) => weekdayOfIso(r.occurrenceDate!) === 6)
    )

    // ══════════════════════════════════════════════════════════════════════
    // 7. effectiveFrom regeneration ("this and following")
    // ══════════════════════════════════════════════════════════════════════
    console.log('7: effectiveFrom regeneration (this and following)')
    const wo7 = await createWO('effectiveFrom anchor edit')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo7.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [0] },
      template: { startMinute: 480, durationMinutes: 30 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo7RowsInitial = await getVisitsSorted(wo7.instance.id)
    const anchorRow = wo7RowsInitial[3]!
    const anchorDate = anchorRow.occurrenceDate!

    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo7.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [0] },
      template: { startMinute: 900, durationMinutes: 30 },
      timezone: 'UTC',
      effectiveFrom: anchorDate,
    })
    const wo7RowsAfter = await getVisitsSorted(wo7.instance.id)
    const beforeAnchor = wo7RowsAfter.filter((r) => r.occurrenceDate! < anchorDate)
    const atOrAfterAnchor = wo7RowsAfter.filter((r) => r.occurrenceDate! >= anchorDate)
    check(
      'rows before the anchor keep the OLD startMinute (8:00 UTC)',
      beforeAnchor.length > 0 &&
        beforeAnchor.every(
          (r) => r.startTime!.getTime() === expectedStartInstant(r.occurrenceDate!, 480).getTime()
        ),
      beforeAnchor.map((r) => [r.occurrenceDate, r.startTime])
    )
    check(
      'rows at/after the anchor have the NEW startMinute (15:00 UTC)',
      atOrAfterAnchor.length > 0 &&
        atOrAfterAnchor.every(
          (r) => r.startTime!.getTime() === expectedStartInstant(r.occurrenceDate!, 900).getTime()
        ),
      atOrAfterAnchor.map((r) => [r.occurrenceDate, r.startTime])
    )

    // ══════════════════════════════════════════════════════════════════════
    // 8. Pause: future scheduled (incl. detached) deleted; done/canceled survive
    // ══════════════════════════════════════════════════════════════════════
    console.log('8: pause engagement')
    const wo8 = await createWO('pause/resume')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo8.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] },
      template: { startMinute: 300, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo8RowsInitial = await getVisitsSorted(wo8.instance.id)
    check(
      'enough rows to run the pause scenario',
      wo8RowsInitial.length >= 5,
      wo8RowsInitial.length
    )
    const doneRow = wo8RowsInitial[0]!
    const canceledRow8 = wo8RowsInitial[1]!
    const detachedFutureRow = wo8RowsInitial[2]!
    const plainFutureRow = wo8RowsInitial[3]!
    const crossBoundaryRow = wo8RowsInitial[4]!

    await setVisitStatus({ organizationId, userId, visitId: doneRow.id, status: 'done' })
    // A real `done` visit is always in the past — resolveMirrorSourceVisit's "upcoming" query
    // only excludes `status: 'canceled'`, so a future-dated `done` row would otherwise still
    // resolve as next-upcoming. Backdate it to model a realistically-completed visit.
    await database.$client.query('UPDATE "WorkOrderVisit" SET "startTime" = $1 WHERE id = $2', [
      new Date(Date.now() - 24 * 60 * 60_000),
      doneRow.id,
    ])
    await setVisitStatus({ organizationId, userId, visitId: canceledRow8.id, status: 'canceled' })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: detachedFutureRow.id,
      startTime: new Date(detachedFutureRow.startTime!.getTime() + 60 * 60_000),
      endTime: new Date(detachedFutureRow.endTime!.getTime() + 60 * 60_000),
    })
    // Cross-boundary edge: detach then backdate occurrenceDate into the past while startTime
    // stays in the future.
    await scheduleVisit({
      organizationId,
      userId,
      visitId: crossBoundaryRow.id,
      startTime: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      endTime: new Date(Date.now() + 30 * 24 * 60 * 60_000 + 60 * 60_000),
    })
    // Plain SQL via `database.$client` — `apps/worker` has no direct `drizzle-orm` dependency
    // (the `verify-availability.ts` / `verify-money-mi1.ts` precedent).
    await database.$client.query(
      'UPDATE "WorkOrderVisit" SET "occurrenceDate" = $1 WHERE id = $2',
      [addDaysToIso(todayIso, -10), crossBoundaryRow.id]
    )

    await pauseEngagement({ organizationId, userId, workOrderInstanceId: wo8.instance.id })

    const wo8RowsAfterPause = await getVisitsSorted(wo8.instance.id)
    const wo8IdsAfterPause = new Set(wo8RowsAfterPause.map((r) => r.id))
    check('done row survives pause', wo8IdsAfterPause.has(doneRow.id))
    check('canceled row survives pause', wo8IdsAfterPause.has(canceledRow8.id))
    check('detached future row is deleted by pause', !wo8IdsAfterPause.has(detachedFutureRow.id))
    check(
      'plain scheduled future row is deleted by pause',
      !wo8IdsAfterPause.has(plainFutureRow.id)
    )
    check(
      'cross-boundary row (past occurrenceDate, future startTime) is ALSO deleted by pause',
      !wo8IdsAfterPause.has(crossBoundaryRow.id)
    )
    check('status -> paused', (await woStatus(organizationId, wo8.instance.id)) === 'paused')
    const wo8Mirror = await getMirror(organizationId, wo8.instance.id)
    check(
      'mirror fields nulled on pause',
      isNullMirrorValue(wo8Mirror.start) &&
        isNullMirrorValue(wo8Mirror.end) &&
        isNullMirrorValue(wo8Mirror.assignee),
      wo8Mirror
    )

    // ══════════════════════════════════════════════════════════════════════
    // 9. Resume: status -> active, rows regenerate, skipped dates stay absent
    // ══════════════════════════════════════════════════════════════════════
    console.log('9: resume engagement')
    await resumeEngagement({ organizationId, userId, workOrderInstanceId: wo8.instance.id })
    check('status -> active', (await woStatus(organizationId, wo8.instance.id)) === 'active')
    const wo8RowsAfterResume = await getVisitsSorted(wo8.instance.id)
    check(
      'rows regenerate after resume (more than the 2 surviving rows)',
      wo8RowsAfterResume.length > 2,
      wo8RowsAfterResume.length
    )
    const canceledDateAfterResume = wo8RowsAfterResume.filter(
      (r) => r.occurrenceDate === canceledRow8.occurrenceDate
    )
    check(
      'previously-canceled date stays a single canceled row (not resurrected)',
      canceledDateAfterResume.length === 1 && canceledDateAfterResume[0]?.status === 'canceled',
      canceledDateAfterResume
    )
    const doneDateAfterResume = wo8RowsAfterResume.filter(
      (r) => r.occurrenceDate === doneRow.occurrenceDate
    )
    check(
      'previously-done date stays a single done row (not duplicated)',
      doneDateAfterResume.length === 1 && doneDateAfterResume[0]?.status === 'done',
      doneDateAfterResume
    )

    // ══════════════════════════════════════════════════════════════════════
    // 10. Sweep horizon extension (active extends; paused does not)
    // ══════════════════════════════════════════════════════════════════════
    console.log('10: sweep horizon extension')
    const wo10 = await createWO('sweep active')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo10.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [3] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo10RowsFull = await getVisitsSorted(wo10.instance.id)
    const cutoffIso = addDaysToIso(todayIso, 20)
    const wo10Rule = await getRule(wo10.instance.id)
    await database.$client.query(
      'DELETE FROM "WorkOrderVisit" WHERE "recurrenceRuleId" = $1 AND "occurrenceDate" > $2',
      [wo10Rule.id, cutoffIso]
    )
    const backdated = new Date(Date.now() - 10 * 24 * 60 * 60_000)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET "materializedUntil" = $1 WHERE id = $2',
      [backdated, wo10Rule.id]
    )
    const wo10RowsReduced = await getVisitsSorted(wo10.instance.id)
    check('setup: rows beyond cutoff removed', wo10RowsReduced.length < wo10RowsFull.length, {
      before: wo10RowsFull.length,
      after: wo10RowsReduced.length,
    })

    const wo10Paused = await createWO('sweep paused')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo10Paused.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [4] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    await pauseEngagement({ organizationId, userId, workOrderInstanceId: wo10Paused.instance.id })
    const wo10PausedRule = await getRule(wo10Paused.instance.id)
    const pausedBackdated = new Date(Date.now() - 10 * 24 * 60 * 60_000)
    await database.$client.query(
      'UPDATE "RecurrenceRule" SET "materializedUntil" = $1 WHERE id = $2',
      [pausedBackdated, wo10PausedRule.id]
    )

    await sweepRecurringVisits()

    const wo10RuleAfterSweep = await getRule(wo10.instance.id)
    check(
      'active rule: sweep advances materializedUntil',
      wo10RuleAfterSweep.materializedUntil!.getTime() > backdated.getTime(),
      wo10RuleAfterSweep.materializedUntil
    )
    const wo10RowsAfterSweep = await getVisitsSorted(wo10.instance.id)
    check(
      'active rule: sweep re-inserts the missing tail rows',
      wo10RowsAfterSweep.length === wo10RowsFull.length,
      { expected: wo10RowsFull.length, actual: wo10RowsAfterSweep.length }
    )

    const wo10PausedRuleAfterSweep = await getRule(wo10Paused.instance.id)
    check(
      'paused rule: sweep does NOT extend materializedUntil',
      wo10PausedRuleAfterSweep.materializedUntil!.getTime() === pausedBackdated.getTime(),
      wo10PausedRuleAfterSweep.materializedUntil
    )

    // ══════════════════════════════════════════════════════════════════════
    // 11. Until-exhaustion flips ended
    // ══════════════════════════════════════════════════════════════════════
    console.log('11: until-exhaustion')
    const wo11 = await createWO('until exhausted')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo11.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [2], until: yesterdayIso },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo11RowsInitial = await getVisitsSorted(wo11.instance.id)
    check(
      'until already-past materializes zero rows',
      wo11RowsInitial.length === 0,
      wo11RowsInitial.length
    )
    check('status starts active', (await woStatus(organizationId, wo11.instance.id)) === 'active')

    await sweepRecurringVisits()
    check(
      'sweep flips exhausted engagement to ended',
      (await woStatus(organizationId, wo11.instance.id)) === 'ended'
    )

    // ══════════════════════════════════════════════════════════════════════
    // 12. Count-tail regression (count lands inside window + pure tail-completion)
    // ══════════════════════════════════════════════════════════════════════
    console.log('12: count-tail regression')
    const wo12 = await createWO('count-5 tail')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo12.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [1], count: 5 },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo12RowsInitial = await getVisitsSorted(wo12.instance.id)
    check(
      'count=5 materializes exactly 5 rows',
      wo12RowsInitial.length === 5,
      wo12RowsInitial.length
    )
    const wo12Rule = await getRule(wo12.instance.id)
    await materializeVisits(wo12Rule, { userId })
    const wo12RowsAfterReMaterialize = await getVisitsSorted(wo12.instance.id)
    check(
      're-materialize is stable: still exactly 5 rows, no dupes',
      wo12RowsAfterReMaterialize.length === 5 &&
        new Set(wo12RowsAfterReMaterialize.map((r) => r.occurrenceDate)).size === 5,
      wo12RowsAfterReMaterialize.length
    )

    // Pure tail-completion: a count=10 weekly series only fits 9 occurrences in a 56-day
    // window; simulate the window sliding forward by 7 days (as the real daily sweep would
    // do over a week of elapsed time) and assert the 10th occurrence completes the tail.
    const tailAnchor = '2024-01-01' // Monday
    const window1 = expandOccurrences(
      { frequency: 'weekly', interval: 1, weekdays: [1], count: 10 },
      {
        anchor: tailAnchor,
        timezone: 'UTC',
        from: new Date('2024-01-01T00:00:00.000Z'),
        to: new Date('2024-02-26T23:59:59.000Z'), // +56d (end-of-day: startMinute=540 occurs
        // *during* day 56, so the boundary instant must be later in the day than the
        // occurrence's own wall-clock time — same edge case the real sweep sidesteps by using
        // `now + 56d` at whatever time-of-day "now" is, not a day-aligned midnight cutoff).
        startMinute: 540,
        countConsumed: 0,
      }
    )
    check(
      'count=10 weekly only fits 9 occurrences in the initial 56-day window',
      window1.length === 9,
      window1.map((o) => o.occurrenceDate)
    )
    const boundary2 = '2024-01-08'
    const countConsumedForWindow2 = window1.filter((o) => o.occurrenceDate < boundary2).length
    const window2 = expandOccurrences(
      { frequency: 'weekly', interval: 1, weekdays: [1], count: 10 },
      {
        anchor: tailAnchor,
        timezone: 'UTC',
        from: new Date('2024-01-08T00:00:00.000Z'),
        to: new Date('2024-03-04T23:59:59.000Z'), // window slid forward 7 days
        startMinute: 540,
        countConsumed: countConsumedForWindow2,
      }
    )
    const newDates = window2
      .map((o) => o.occurrenceDate)
      .filter((d) => !window1.some((o) => o.occurrenceDate === d))
    check(
      'sliding the window forward completes the 10th (tail) occurrence',
      newDates.length === 1 && newDates[0] === '2024-03-04',
      { window2: window2.map((o) => o.occurrenceDate), newDates }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 13. Hook guard: manual engagement-status writes rejected (both key forms)
    // ══════════════════════════════════════════════════════════════════════
    console.log('13: hook guard (rejectManualEngagementStatus)')
    const wo13 = await createWO('hook guard')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo13.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [1] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const statusFieldId = await customFieldId(organizationId, 'work_order', 'work_order_status')
    if (!statusFieldId) throw new Error('work_order_status field not found')

    for (const guarded of ['active', 'paused', 'ended']) {
      const errAttr = await expectThrow(() =>
        handler.update(wo13.recordId, { work_order_status: guarded })
      )
      check(
        `manual work_order_status=${guarded} rejected (systemAttribute-keyed)`,
        errAttr instanceof BadRequestError,
        errAttr
      )
      const errField = await expectThrow(() =>
        handler.update(wo13.recordId, { [statusFieldId]: guarded })
      )
      check(
        `manual work_order_status=${guarded} rejected (fieldId-keyed)`,
        errField instanceof BadRequestError,
        errField
      )
    }

    await pauseEngagement({ organizationId, userId, workOrderInstanceId: wo13.instance.id })
    check(
      "engine's own write path (pauseEngagement) succeeds through the same hook",
      (await woStatus(organizationId, wo13.instance.id)) === 'paused'
    )

    // ══════════════════════════════════════════════════════════════════════
    // 14. Roll-up gate: visit status transitions don't touch recurring work_order_status
    // ══════════════════════════════════════════════════════════════════════
    console.log('14: roll-up gate (recurring jobType early-return)')
    const wo1FirstVisit = wo1Rows[0]!
    await setVisitStatus({ organizationId, userId, visitId: wo1FirstVisit.id, status: 'en_route' })
    check(
      'visit en_route on a recurring job does NOT change work_order_status',
      (await woStatus(organizationId, wo1.instance.id)) === 'active'
    )

    // ══════════════════════════════════════════════════════════════════════
    // 15. Mirror next-upcoming: earliest future visit, moves on cancel
    // ══════════════════════════════════════════════════════════════════════
    console.log('15: mirror next-upcoming')
    const wo15 = await createWO('mirror next-upcoming')
    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: wo15.instance.id,
      pattern: { frequency: 'weekly', interval: 1, weekdays: [1, 3] },
      template: { startMinute: 540, durationMinutes: 60 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const wo15Rows = await getVisitsSorted(wo15.instance.id)
    check('mirror test has at least 2 future rows', wo15Rows.length >= 2, wo15Rows.length)
    const earliest = wo15Rows[0]!
    const secondEarliest = wo15Rows[1]!
    const wo15MirrorInitial = await getMirror(organizationId, wo15.instance.id)
    check(
      'mirror start/end match the earliest future visit',
      wo15MirrorInitial.start?.valueDate != null &&
        new Date(wo15MirrorInitial.start.valueDate).getTime() === earliest.startTime!.getTime() &&
        new Date(wo15MirrorInitial.end!.valueDate!).getTime() === earliest.endTime!.getTime(),
      wo15MirrorInitial
    )

    await setVisitStatus({ organizationId, userId, visitId: earliest.id, status: 'canceled' })
    const wo15MirrorAfterCancel = await getMirror(organizationId, wo15.instance.id)
    check(
      'mirror moves to the next-earliest visit after the first is canceled',
      wo15MirrorAfterCancel.start?.valueDate != null &&
        new Date(wo15MirrorAfterCancel.start.valueDate).getTime() ===
          secondEarliest.startTime!.getTime(),
      wo15MirrorAfterCancel
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
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
