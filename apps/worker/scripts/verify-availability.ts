// apps/worker/scripts/verify-availability.ts
/**
 * Availability module (slice 1) end-to-end verification (plans/dispatch/05-availability.md §F).
 * Exercises the REAL `@auxx/lib/availability` write/read paths against the reshaped
 * `OperatingHours` table (migration 0274): weekly-hours round-trip + split shifts + closed
 * days, transactional replace-all (including concurrent-save race safety), server-side
 * validation, exception materialization + contiguous regrouping, exception-group non-merging,
 * `deleteException` subject scoping, and `resolveAvailability` precedence
 * (subject exception > org exception > subject weekly > org weekly fallback).
 *
 * Creates `OperatingHours` rows for one org (+ its one worker) and deletes them all at the
 * end via the public API (`saveWeeklyHours(..., { days: [] })` + `deleteException`) — no raw
 * `drizzle-orm` import, since `apps/worker` doesn't declare it as a direct dependency. Touches
 * no other table.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-availability.ts
 */

import { database, type schema } from '@auxx/database'
import {
  type AvailabilitySubject,
  addException,
  deleteException,
  getWeeklyHours,
  listExceptions,
  resolveAvailability,
  resolveAvailabilityForSubjects,
  saveWeeklyHours,
  type TimeRange,
  type WeeklyHours,
} from '@auxx/lib/availability'
import { BadRequestError } from '@auxx/lib/errors'

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

type OperatingHoursRow = typeof schema.OperatingHours.$inferSelect

/** Raw `OperatingHours` rows for a subject, scoped by `kind` — no drizzle-orm import needed
 * (uses the relational query builder's callback `where` form). */
async function rawRows(
  organizationId: string,
  subjectType: 'organization' | 'worker',
  userId: string | null,
  kind: 'weekly' | 'exception'
): Promise<OperatingHoursRow[]> {
  return database.query.OperatingHours.findMany({
    where: (t, { and, eq }) => {
      const base = and(
        eq(t.organizationId, organizationId),
        eq(t.subjectType, subjectType),
        eq(t.kind, kind)
      )!
      return subjectType === 'worker' ? and(base, eq(t.userId, userId!))! : base
    },
  })
}

async function rawRowsByLabel(organizationId: string, label: string): Promise<OperatingHoursRow[]> {
  return database.query.OperatingHours.findMany({
    where: (t, { and, eq }) =>
      and(
        eq(t.organizationId, organizationId),
        eq(t.subjectType, 'organization'),
        eq(t.kind, 'exception'),
        eq(t.label, label)
      ),
  })
}

function rangesEqual(a: TimeRange[], b: TimeRange[]): boolean {
  if (a.length !== b.length) return false
  return a.every((r, i) => r.start === b[i]!.start && r.end === b[i]!.end)
}

/** Sorted `(dayOfWeek, start, end)` triples — used to compare a raw row set against a payload. */
function weeklyShape(rows: OperatingHoursRow[]): string[] {
  return rows
    .map((r) => `${r.dayOfWeek}:${r.startMinute}-${r.endMinute}`)
    .sort((a, b) => a.localeCompare(b))
}

function weeklyPayloadShape(weekly: WeeklyHours): string[] {
  return weekly.days
    .flatMap((day) => day.ranges.map((r) => `${day.dayOfWeek}:${r.start}-${r.end}`))
    .sort((a, b) => a.localeCompare(b))
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as M1/MQ1 scripts)
  const userId = user.id
  console.log(`Org ${organizationId}, worker user ${userId}`)

  const orgSubject: AvailabilitySubject = { type: 'organization', organizationId }
  const workerSubject: AvailabilitySubject = { type: 'worker', organizationId, userId }

  const preExisting = await database.query.OperatingHours.findMany({
    where: (t, { eq }) => eq(t.organizationId, organizationId),
    columns: { id: true },
  })
  if (preExisting.length > 0) {
    console.log(
      `WARNING: org already has ${preExisting.length} OperatingHours row(s) — cleanup at the end will remove them too.`
    )
  }

  try {
    // ── 1: Weekly round-trip + split shifts + closed days ──────────────────
    console.log('1: weekly round-trip + split shifts + closed days')
    const weekly1: WeeklyHours = {
      timezone: 'America/New_York',
      days: [
        {
          dayOfWeek: 1,
          ranges: [
            { start: 780, end: 1020 },
            { start: 540, end: 720 },
          ],
        }, // Mon, unsorted input
        { dayOfWeek: 3, ranges: [{ start: 600, end: 960 }] }, // Wed
      ],
    }
    await saveWeeklyHours(orgSubject, weekly1)
    const got1 = await getWeeklyHours(orgSubject)
    check('getWeeklyHours returns non-null', got1 !== null, got1)
    check('exactly 2 days present (Mon, Wed)', got1?.days.length === 2, got1?.days)
    const mon1 = got1?.days.find((d) => d.dayOfWeek === 1)
    const wed1 = got1?.days.find((d) => d.dayOfWeek === 3)
    check(
      'Monday ranges sorted by start [540-720, 780-1020]',
      !!mon1 &&
        rangesEqual(mon1.ranges, [
          { start: 540, end: 720 },
          { start: 780, end: 1020 },
        ]),
      mon1?.ranges
    )
    check(
      'Wednesday range [600-960]',
      !!wed1 && rangesEqual(wed1.ranges, [{ start: 600, end: 960 }]),
      wed1?.ranges
    )
    check('no other days present', (got1?.days.length ?? 0) === 2)

    const raw1 = await rawRows(organizationId, 'organization', null, 'weekly')
    check('3 raw weekly rows (2 Mon + 1 Wed)', raw1.length === 3, raw1.length)
    check(
      'timezone stamped America/New_York on every row',
      raw1.every((r) => r.timezone === 'America/New_York'),
      raw1.map((r) => r.timezone)
    )

    // ── 2: Replace-all ───────────────────────────────────────────────────────
    console.log('2: replace-all')
    const weekly2: WeeklyHours = {
      timezone: 'America/New_York',
      days: [{ dayOfWeek: 2, ranges: [{ start: 540, end: 1020 }] }], // Tue only
    }
    await saveWeeklyHours(orgSubject, weekly2)
    const got2 = await getWeeklyHours(orgSubject)
    check(
      'getWeeklyHours returns only Tue',
      got2?.days.length === 1 && got2.days[0]?.dayOfWeek === 2,
      got2?.days
    )
    const raw2 = await rawRows(organizationId, 'organization', null, 'weekly')
    check('raw row count = 1, no leftovers', raw2.length === 1, raw2.length)

    // ── 3: Transactional replace-all under concurrency ──────────────────────
    console.log('3: transactional replace-all under concurrency (5 iterations)')
    const payloadA: WeeklyHours = {
      timezone: 'America/New_York',
      days: [0, 1, 2, 3, 4].map((d) => ({ dayOfWeek: d, ranges: [{ start: 540, end: 1020 }] })),
    } // 5 ranges, Sun-Thu
    const payloadB: WeeklyHours = {
      timezone: 'America/New_York',
      days: [
        {
          dayOfWeek: 5,
          ranges: [
            { start: 480, end: 720 },
            { start: 780, end: 1020 },
          ],
        },
        { dayOfWeek: 6, ranges: [{ start: 540, end: 900 }] },
      ],
    } // 3 ranges, Fri/Sat
    const shapeA = weeklyPayloadShape(payloadA)
    const shapeB = weeklyPayloadShape(payloadB)

    let allRacesClean = true
    for (let i = 0; i < 5; i++) {
      await Promise.allSettled([
        saveWeeklyHours(orgSubject, payloadA),
        saveWeeklyHours(orgSubject, payloadB),
      ])
      const raw3 = await rawRows(organizationId, 'organization', null, 'weekly')
      const shape3 = weeklyShape(raw3)
      const matchesA =
        shape3.length === shapeA.length && shape3.every((s, idx) => s === shapeA[idx])
      const matchesB =
        shape3.length === shapeB.length && shape3.every((s, idx) => s === shapeB[idx])
      if (!matchesA && !matchesB) {
        allRacesClean = false
        console.log(`  iteration ${i}: rows did not match either payload cleanly`, shape3)
      }
    }
    check('all 5 concurrent-save iterations left exactly one payload, no interleave', allRacesClean)

    // ── 4: Server-side validation (worker subject — untouched so far) ───────
    console.log('4: server-side validation')
    const invalidCases: Array<{ name: string; weekly: WeeklyHours }> = [
      {
        name: 'inverted range (end<=start)',
        weekly: { timezone: 'UTC', days: [{ dayOfWeek: 1, ranges: [{ start: 600, end: 600 }] }] },
      },
      {
        name: 'overlapping ranges same day',
        weekly: {
          timezone: 'UTC',
          days: [
            {
              dayOfWeek: 1,
              ranges: [
                { start: 540, end: 700 },
                { start: 600, end: 800 },
              ],
            },
          ],
        },
      },
      {
        name: 'out-of-bounds minutes (1500)',
        weekly: { timezone: 'UTC', days: [{ dayOfWeek: 1, ranges: [{ start: 0, end: 1500 }] }] },
      },
      {
        name: 'bad dayOfWeek 7',
        weekly: { timezone: 'UTC', days: [{ dayOfWeek: 7, ranges: [{ start: 540, end: 600 }] }] },
      },
    ]
    for (const { name, weekly } of invalidCases) {
      const before = await rawRows(organizationId, 'worker', userId, 'weekly')
      let threw: unknown = null
      try {
        await saveWeeklyHours(workerSubject, weekly)
      } catch (err) {
        threw = err
      }
      const after = await rawRows(organizationId, 'worker', userId, 'weekly')
      check(`${name} throws BadRequestError`, threw instanceof BadRequestError, threw)
      check(`${name}: no rows changed by the failed save`, after.length === before.length, {
        before: before.length,
        after: after.length,
      })
    }

    // ── 5: Exception materialization + regroup ──────────────────────────────
    console.log('5: exception materialization + regroup')
    await addException(orgSubject, {
      dateFrom: '2026-12-25',
      dateTo: '2026-12-26',
      label: 'Holidays',
      isAvailable: false,
    })
    const rawHolidays = await rawRowsByLabel(organizationId, 'Holidays')
    check(
      '2 raw exception rows, one per date',
      rawHolidays.length === 2 &&
        new Set(rawHolidays.map((r) => r.date)).size === 2 &&
        rawHolidays.every((r) => r.isAvailable === false),
      rawHolidays.map((r) => ({ date: r.date, isAvailable: r.isAvailable }))
    )

    const groups5 = await listExceptions(orgSubject)
    const holidaysGroup = groups5.find((g) => g.dateFrom === '2026-12-25')
    check(
      'listExceptions regroups to ONE Holidays group',
      !!holidaysGroup &&
        holidaysGroup.dateTo === '2026-12-26' &&
        holidaysGroup.isAvailable === false &&
        holidaysGroup.ids.length === 2,
      holidaysGroup
    )

    // ── 6: Special-hours multi-range ─────────────────────────────────────────
    console.log('6: special-hours multi-range')
    await addException(orgSubject, {
      dateFrom: '2027-01-04',
      dateTo: '2027-01-06',
      label: 'Inventory',
      isAvailable: true,
      ranges: [
        { start: 540, end: 720 },
        { start: 780, end: 900 },
      ],
    })
    const rawInventory = await rawRowsByLabel(organizationId, 'Inventory')
    check('6 raw rows (2 ranges x 3 dates)', rawInventory.length === 6, rawInventory.length)

    const groups6 = await listExceptions(orgSubject)
    const inventoryGroup = groups6.find((g) => g.dateFrom === '2027-01-04')
    check(
      'listExceptions regroups Inventory to ONE group, 2 ranges, 6 ids',
      !!inventoryGroup &&
        inventoryGroup.dateTo === '2027-01-06' &&
        inventoryGroup.isAvailable === true &&
        rangesEqual(inventoryGroup.ranges, [
          { start: 540, end: 720 },
          { start: 780, end: 900 },
        ]) &&
        inventoryGroup.ids.length === 6,
      inventoryGroup
    )

    // ── 7: No false merging ──────────────────────────────────────────────────
    console.log('7: no false merging')
    await addException(orgSubject, {
      dateFrom: '2026-12-28',
      label: 'Blackout day',
      isAvailable: false,
    })
    const groups7 = await listExceptions(orgSubject)
    check('3 groups total now', groups7.length === 3, groups7.length)
    const holidaysAfter = groups7.find((g) => g.dateFrom === '2026-12-25')
    const blackoutAfter = groups7.find((g) => g.dateFrom === '2026-12-28')
    check(
      'Holidays group unchanged (still 12/25-26, did not merge with 12/28)',
      !!holidaysAfter && holidaysAfter.dateTo === '2026-12-26' && holidaysAfter.ids.length === 2,
      holidaysAfter
    )
    check(
      'Blackout day is its own group',
      !!blackoutAfter && blackoutAfter.dateTo === '2026-12-28' && blackoutAfter.ids.length === 1,
      blackoutAfter
    )

    // ── 8: addException validation ───────────────────────────────────────────
    console.log('8: addException validation')
    const rawExceptionsBefore8 = await rawRows(organizationId, 'organization', null, 'exception')
    const addExceptionCases: Array<{ name: string; input: Parameters<typeof addException>[1] }> = [
      {
        name: 'isAvailable:true with no ranges',
        input: { dateFrom: '2026-06-01', isAvailable: true },
      },
      {
        name: 'overlapping ranges',
        input: {
          dateFrom: '2026-06-02',
          isAvailable: true,
          ranges: [
            { start: 540, end: 700 },
            { start: 600, end: 800 },
          ],
        },
      },
      {
        name: 'dateTo before dateFrom',
        input: { dateFrom: '2026-06-05', dateTo: '2026-06-01', isAvailable: false },
      },
      {
        name: 'span > 366 days',
        input: { dateFrom: '2026-06-01', dateTo: '2028-01-01', isAvailable: false },
      },
    ]
    for (const { name, input } of addExceptionCases) {
      let threw: unknown = null
      try {
        await addException(orgSubject, input)
      } catch (err) {
        threw = err
      }
      check(`${name} throws BadRequestError`, threw instanceof BadRequestError, threw)
    }
    const rawExceptionsAfter8 = await rawRows(organizationId, 'organization', null, 'exception')
    check(
      'no exception rows created by the failed addException calls',
      rawExceptionsAfter8.length === rawExceptionsBefore8.length,
      { before: rawExceptionsBefore8.length, after: rawExceptionsAfter8.length }
    )

    // ── 9: deleteException scoping ───────────────────────────────────────────
    console.log('9: deleteException scoping')
    const holidaysIds = holidaysAfter!.ids
    await deleteException(workerSubject, holidaysIds)
    const groupsAfterWorkerDelete = await listExceptions(orgSubject)
    check(
      'worker-subject delete does NOT remove org rows',
      groupsAfterWorkerDelete.some((g) => g.dateFrom === '2026-12-25'),
      groupsAfterWorkerDelete
    )
    await deleteException(orgSubject, holidaysIds)
    const groupsAfterOrgDelete = await listExceptions(orgSubject)
    check(
      'org-subject delete removes the rows',
      !groupsAfterOrgDelete.some((g) => g.dateFrom === '2026-12-25'),
      groupsAfterOrgDelete
    )

    // ── 10: resolveAvailability precedence ───────────────────────────────────
    console.log('10: resolveAvailability precedence')
    // Deterministic org weekly schedule: Mon-Fri 9:00-17:00, for a clean Mon-Fri window.
    const orgWeeklyForResolve: WeeklyHours = {
      timezone: 'America/New_York',
      days: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, ranges: [{ start: 540, end: 1020 }] })),
    }
    await saveWeeklyHours(orgSubject, orgWeeklyForResolve)
    const window = { from: '2026-11-02', to: '2026-11-06' } // Mon-Fri, no pre-existing exceptions in range

    // 10a: worker has no weekly rows -> org weekly inheritance
    const resolved10a = await resolveAvailability(workerSubject, window)
    check(
      '10a: worker inherits org weekly (all 5 weekdays 540-1020)',
      resolved10a.length === 5 &&
        resolved10a.every((d) => rangesEqual(d.ranges, [{ start: 540, end: 1020 }])),
      resolved10a
    )

    // 10b: org closed-exception on 2026-11-04 (Wed) -> empty for every subject
    await addException(orgSubject, {
      dateFrom: '2026-11-04',
      label: 'Org holiday',
      isAvailable: false,
    })
    const resolved10b = await resolveAvailability(workerSubject, window)
    const wed10b = resolved10b.find((d) => d.date === '2026-11-04')
    const mon10b = resolved10b.find((d) => d.date === '2026-11-02')
    check(
      '10b: org exception -> worker resolves EMPTY on 11-04',
      !!wed10b && wed10b.ranges.length === 0,
      wed10b
    )
    check(
      '10b: unaffected weekday (11-02) still inherits org weekly',
      !!mon10b && rangesEqual(mon10b.ranges, [{ start: 540, end: 1020 }]),
      mon10b
    )

    // 10c: worker special-hours exception on the SAME date -> subject beats org exception
    await addException(workerSubject, {
      dateFrom: '2026-11-04',
      label: 'Worker override',
      isAvailable: true,
      ranges: [{ start: 600, end: 840 }],
    })
    const resolved10c = await resolveAvailability(workerSubject, window)
    const wed10c = resolved10c.find((d) => d.date === '2026-11-04')
    check(
      '10c: worker exception beats org exception on 11-04',
      !!wed10c && rangesEqual(wed10c.ranges, [{ start: 600, end: 840 }]),
      wed10c
    )

    // 10d: worker gets its own weekly rows (Saturday only) -> org weekly fallback stops applying
    await saveWeeklyHours(workerSubject, {
      timezone: 'America/New_York',
      days: [{ dayOfWeek: 6, ranges: [{ start: 600, end: 900 }] }],
    })
    const resolved10d = await resolveAvailability(workerSubject, window)
    const mon10d = resolved10d.find((d) => d.date === '2026-11-02') // Monday, org has it open, worker doesn't
    const wed10d = resolved10d.find((d) => d.date === '2026-11-04') // still the worker's own exception
    check(
      '10d: worker weekly rows present -> Monday resolves EMPTY (no org fallback)',
      !!mon10d && mon10d.ranges.length === 0,
      mon10d
    )
    check(
      '10d: worker exception date (11-04) still resolves to the exception ranges',
      !!wed10d && rangesEqual(wed10d.ranges, [{ start: 600, end: 840 }]),
      wed10d
    )

    // ── 10e: batched resolve parity ──────────────────────────────────────────
    // Exercises `resolveAvailabilityForSubjects` against the richest state from step 10:
    // org weekly + org closed-exception + worker special-hours exception + worker weekly.
    console.log('10e: resolveAvailabilityForSubjects parity')
    const [batchOrg, batchWorker] = await resolveAvailabilityForSubjects(
      [orgSubject, workerSubject],
      window
    )
    const soloOrg = await resolveAvailability(orgSubject, window)
    const soloWorker = await resolveAvailability(workerSubject, window)
    check(
      '10e: batch [org, worker] matches individual org resolve',
      JSON.stringify(batchOrg) === JSON.stringify(soloOrg),
      { batchOrg, soloOrg }
    )
    check(
      '10e: batch [org, worker] matches individual worker resolve',
      JSON.stringify(batchWorker) === JSON.stringify(soloWorker),
      { batchWorker, soloWorker }
    )
    const [orgOnly] = await resolveAvailabilityForSubjects([orgSubject], window)
    check(
      '10e: org-only batch matches individual org resolve',
      JSON.stringify(orgOnly) === JSON.stringify(soloOrg),
      orgOnly
    )
    check(
      '10e: empty batch returns []',
      (await resolveAvailabilityForSubjects([], window)).length === 0
    )
    const mixedOrgRejected = await resolveAvailabilityForSubjects(
      [orgSubject, { type: 'organization', organizationId: 'someone-elses-org' }],
      window
    ).then(
      () => false,
      (err) => err instanceof BadRequestError
    )
    check('10e: mixed-organization batch throws BadRequestError', mixedOrgRejected)

    // ── 11: getWeeklyHours null ───────────────────────────────────────────────
    console.log('11: getWeeklyHours null for a subject with zero weekly rows')
    await saveWeeklyHours(workerSubject, { timezone: 'America/New_York', days: [] })
    const got11 = await getWeeklyHours(workerSubject)
    check('getWeeklyHours returns null with zero weekly rows', got11 === null, got11)
  } finally {
    // ── Cleanup: public API only (saveWeeklyHours empty-days replace + deleteException) ──
    await saveWeeklyHours(orgSubject, { timezone: 'UTC', days: [] })
    await saveWeeklyHours(workerSubject, { timezone: 'UTC', days: [] })
    const orgExceptionIds = (await listExceptions(orgSubject)).flatMap((g) => g.ids)
    if (orgExceptionIds.length > 0) await deleteException(orgSubject, orgExceptionIds)
    const workerExceptionIds = (await listExceptions(workerSubject)).flatMap((g) => g.ids)
    if (workerExceptionIds.length > 0) await deleteException(workerSubject, workerExceptionIds)

    const remaining = await database.query.OperatingHours.findMany({
      where: (t, { eq }) => eq(t.organizationId, organizationId),
      columns: { id: true },
    })
    console.log(`Cleanup: ${remaining.length} OperatingHours row(s) remain for the org (expect 0)`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
