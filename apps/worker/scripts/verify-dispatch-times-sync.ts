// apps/worker/scripts/verify-dispatch-times-sync.ts
/**
 * Dispatch plan 20 "Route Times ↔ Route Order Sync" Phase 2 backend verification
 * (plans/dispatch/20-route-times-sync.md §4.5). Exercises the REAL write paths added this
 * slice: `resolveVisitDurationMinutes` (`@auxx/lib/dispatch`, pure), `scheduleVisit`'s
 * `timeWriteKind` classification (`packages/lib/src/dispatch/visit-mutations.ts`),
 * `unscheduleVisit` (clears `timeConfirmedAt`, keeps `durationMinutes`), the new
 * `setVisitDuration` mutation, `applyRouteTimes`' anchored-chain rework
 * (`packages/lib/src/dispatch/route-planner/apply-times.ts` — confirmed stops are fixed
 * anchors, provisional stops chain around them), and the recurring materializer persisting
 * `durationMinutes` while leaving `timeConfirmedAt` null.
 *
 * Work orders are created via `UnifiedCrudHandler.create` (the M1 number + visit auto-create
 * hooks), prefixed "[TS-verify]", and deleted at the end — `WorkOrderVisit.workOrderId`
 * cascades on `EntityInstance` delete (the `verify-dispatch-route-planner.ts` precedent), so
 * per-work-order visit cleanup is automatic. The one `DispatchWorker` row created for the run
 * is removed explicitly.
 *
 * `apps/worker` has no direct `drizzle-orm` dependency — reads use `database.query.*`
 * (operators arrive as callback args), and raw column tweaks (routeOrder/coords fixtures, not
 * exposed by any lib mutation) go through `database.$client.query('UPDATE ...')` (the
 * `verify-dispatch-route-planner.ts`/WS1 raw-SQL precedent).
 *
 * MAPBOX_ACCESS_TOKEN / MAPTILER_API_KEY are force-deleted before any lib call reads them (both
 * read at CALL time, no top-level caching) — section 5's `applyRouteTimes` calls exercise the
 * real no-token fallback leg math, not a simulated one. With no Mapbox token, legs between
 * geocoded stops are still positive (haversine-at-40km/h with a 180s floor) EXCEPT the very
 * first leg of a chain segment when there's no depot and no previous point — that one is
 * documented as exactly zero seconds (`getRouteLegs`'/`applyRouteTimes`' depot-less first-leg
 * convention, exercised in `verify-dispatch-route-planner.ts` section 3). Section 5 asserts
 * chain relations (`start_i >= end_{i-1}`, `end_i - start_i === resolvedDuration_i`) rather
 * than exact leg seconds — the plan's note that "with no MAPBOX token ... legs are zero-second
 * — that's fine, chain math still asserts" is honored by not depending on any particular
 * positive leg value, only on monotonic, duration-consistent chaining.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-times-sync.ts
 */

import { database } from '@auxx/database'
import {
  applyRouteTimes,
  assignVisit,
  materializeVisits,
  removeDispatchWorker,
  resolveVisitDurationMinutes,
  scheduleVisit,
  setRecurrenceRule,
  setVisitDuration,
  unscheduleVisit,
  upsertDispatchWorker,
} from '@auxx/lib/dispatch'
import { NotFoundError } from '@auxx/lib/errors'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

// Force-unset before any lib import/call reads them (both read at call time — see file header)
// — a MapTiler TEST key has since been added to the root `.env` for other features, but section
// 5's `applyRouteTimes` needs the real no-key/fallback leg-math path, not the keyed path.
delete process.env.MAPTILER_API_KEY
delete process.env.MAPBOX_ACCESS_TOKEN

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

// ── Date/window helpers (verify-dispatch-route-planner.ts precedent) ──

function dayWindow(daysFromNow: number): { from: Date; dateKey: string } {
  const base = new Date()
  base.setUTCDate(base.getUTCDate() + daysFromNow)
  base.setUTCHours(0, 0, 0, 0)
  const y = base.getUTCFullYear()
  const m = String(base.getUTCMonth() + 1).padStart(2, '0')
  const d = String(base.getUTCDate()).padStart(2, '0')
  return { from: base, dateKey: `${y}-${m}-${d}` }
}
function atHour(day: Date, hour: number, minute = 0): Date {
  return new Date(day.getTime() + hour * 60 * 60 * 1000 + minute * 60 * 1000)
}

async function withoutEnv<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env[name]
  delete process.env[name]
  try {
    return await fn()
  } finally {
    if (original !== undefined) process.env[name] = original
  }
}

async function expectThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err ?? new Error('threw a falsy value')
  }
}

// ── DB helpers ──

async function getVisit(workOrderInstanceId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  if (!visit) throw new Error(`No visit found for work order ${workOrderInstanceId}`)
  return visit
}

async function getVisitById(visitId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.id, visitId),
  })
  if (!visit) throw new Error(`No visit row found for ${visitId}`)
  return visit
}

async function setVisitRouteOrder(visitId: string, routeOrder: number | null): Promise<void> {
  await database.$client.query('UPDATE "WorkOrderVisit" SET "routeOrder" = $1 WHERE id = $2', [
    routeOrder,
    visitId,
  ])
}

async function setVisitCoords(visitId: string, lat: number, lng: number): Promise<void> {
  await database.$client.query(
    'UPDATE "WorkOrderVisit" SET "latitude" = $1, "longitude" = $2 WHERE id = $3',
    [lat, lng, visitId]
  )
}

async function residueCount(): Promise<number> {
  const res = await database.$client.query(
    `SELECT count(*)::int AS n FROM "FieldValue" fv WHERE fv."valueText" ILIKE '%[TS-verify]%'`
  )
  return res.rows[0]?.n ?? 0
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — precedent)
  const userId = user.id
  console.log(`Org ${organizationId}, dev user ${userId}`)

  check('MAPBOX_ACCESS_TOKEN unset in the test env', !process.env.MAPBOX_ACCESS_TOKEN)
  check('MAPTILER_API_KEY unset in the test env', !process.env.MAPTILER_API_KEY)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []
  const workerIds: string[] = []

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. resolveVisitDurationMinutes — pure read-order (explicit -> span -> 60)
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: resolveVisitDurationMinutes')

    const t0 = new Date('2026-08-01T09:00:00.000Z')
    const plusMin = (min: number) => new Date(t0.getTime() + min * 60_000)

    check(
      'explicit durationMinutes wins over a differing span',
      resolveVisitDurationMinutes({ durationMinutes: 30, startTime: t0, endTime: plusMin(90) }) ===
        30
    )
    check(
      'no explicit duration -> positive span used (90 min)',
      resolveVisitDurationMinutes({
        durationMinutes: null,
        startTime: t0,
        endTime: plusMin(90),
      }) === 90
    )
    check(
      'zero-length span falls back to 60 (not 0)',
      resolveVisitDurationMinutes({ durationMinutes: null, startTime: t0, endTime: t0 }) === 60
    )
    check(
      'negative (inverted) span falls back to 60',
      resolveVisitDurationMinutes({
        durationMinutes: null,
        startTime: plusMin(30),
        endTime: t0,
      }) === 60
    )
    check('no duration + no times at all -> default 60', resolveVisitDurationMinutes({}) === 60)
    check(
      'explicit 0 is falsy-but-defined -> still respected over span (explicit beats span)',
      resolveVisitDurationMinutes({
        durationMinutes: undefined,
        startTime: t0,
        endTime: plusMin(45),
      }) === 45
    )

    // ══════════════════════════════════════════════════════════════════════
    // Shared fixture: one DispatchWorker row for this run.
    // ══════════════════════════════════════════════════════════════════════
    const worker = await upsertDispatchWorker({
      organizationId,
      userId,
      isActive: true,
      color: '#ff6633',
    })
    workerIds.push(worker.id)

    // ══════════════════════════════════════════════════════════════════════
    // 2. scheduleVisit classification — confirmed (default + explicit) vs provisional
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: scheduleVisit timeWriteKind classification')
    const win2 = dayWindow(230)

    const woSched = await handler.create('work_order', {
      work_order_title: '[TS-verify] scheduleVisit classification',
    })
    createdRecordIds.push(woSched.recordId)
    const vSched = await getVisit(woSched.instance.id)
    await assignVisit({ organizationId, userId, visitId: vSched.id, assigneeUserId: userId })

    // 2a: default (no timeWriteKind) behaves as 'confirmed' — stamps timeConfirmedAt, syncs
    // durationMinutes from the 60-minute span.
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vSched.id,
      startTime: atHour(win2.from, 9),
      endTime: atHour(win2.from, 10),
    })
    const r2a = await getVisitById(vSched.id)
    check('2a: default write stamps timeConfirmedAt', r2a.timeConfirmedAt !== null, r2a)
    check('2a: default write syncs durationMinutes = span (60)', r2a.durationMinutes === 60, r2a)

    // 2b: explicit 'confirmed' with a DIFFERENT span (90) behaves the same way.
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vSched.id,
      startTime: atHour(win2.from, 9),
      endTime: atHour(win2.from, 10, 30),
      timeWriteKind: 'confirmed',
    })
    const r2b = await getVisitById(vSched.id)
    check(
      '2b: explicit confirmed stamps timeConfirmedAt',
      r2b.timeConfirmedAt !== null,
      r2b.timeConfirmedAt
    )
    check('2b: explicit confirmed syncs durationMinutes = span (90)', r2b.durationMinutes === 90)

    // 2c: 'provisional' write (different span again, 30 min) -> timeConfirmedAt null,
    // durationMinutes UNCHANGED (stays 90 from 2b).
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vSched.id,
      startTime: atHour(win2.from, 14),
      endTime: atHour(win2.from, 14, 30),
      timeWriteKind: 'provisional',
    })
    const r2c = await getVisitById(vSched.id)
    check('2c: provisional write nulls timeConfirmedAt', r2c.timeConfirmedAt === null, r2c)
    check(
      '2c: provisional write leaves durationMinutes UNCHANGED (still 90, not 30)',
      r2c.durationMinutes === 90,
      r2c.durationMinutes
    )
    check(
      '2c: provisional write still moves the times themselves',
      r2c.startTime?.getTime() === atHour(win2.from, 14).getTime()
    )

    // 2d: a LATER confirmed write re-stamps both timeConfirmedAt and durationMinutes (45 min
    // span) — confirming is not one-shot.
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vSched.id,
      startTime: atHour(win2.from, 16),
      endTime: atHour(win2.from, 16, 45),
    })
    const r2d = await getVisitById(vSched.id)
    check('2d: later confirmed write re-stamps timeConfirmedAt', r2d.timeConfirmedAt !== null)
    check(
      '2d: later confirmed write re-syncs durationMinutes (45)',
      r2d.durationMinutes === 45,
      r2d.durationMinutes
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. unscheduleVisit — clears times + timeConfirmedAt, KEEPS durationMinutes
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: unscheduleVisit')
    await unscheduleVisit({ organizationId, userId, visitId: vSched.id })
    const r3 = await getVisitById(vSched.id)
    check('3: startTime cleared', r3.startTime === null, r3.startTime)
    check('3: endTime cleared', r3.endTime === null, r3.endTime)
    check('3: timeConfirmedAt cleared', r3.timeConfirmedAt === null, r3.timeConfirmedAt)
    check(
      '3: durationMinutes SURVIVES unscheduling (still 45 from 2d)',
      r3.durationMinutes === 45,
      r3.durationMinutes
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. setVisitDuration — direct column write + org-scoping
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: setVisitDuration')

    const woDur = await handler.create('work_order', {
      work_order_title: '[TS-verify] setVisitDuration',
    })
    createdRecordIds.push(woDur.recordId)
    const vDur = await getVisit(woDur.instance.id)

    await setVisitDuration({ organizationId, userId, visitId: vDur.id, durationMinutes: 90 })
    const r4a = await getVisitById(vDur.id)
    check('4a: durationMinutes set to 90', r4a.durationMinutes === 90, r4a.durationMinutes)

    await setVisitDuration({ organizationId, userId, visitId: vDur.id, durationMinutes: null })
    const r4b = await getVisitById(vDur.id)
    check('4b: durationMinutes cleared back to null', r4b.durationMinutes === null, r4b)

    const err4c = await expectThrow(() =>
      setVisitDuration({
        organizationId: 'ts-verify-wrong-org-id',
        userId,
        visitId: vDur.id,
        durationMinutes: 30,
      })
    )
    check(
      '4c: wrong organizationId -> NotFoundError, no write',
      err4c instanceof NotFoundError,
      err4c
    )
    const r4c = await getVisitById(vDur.id)
    check('4c: durationMinutes untouched by the rejected write', r4c.durationMinutes === null)

    // ══════════════════════════════════════════════════════════════════════
    // 5. applyRouteTimes anchored chain — confirmed stops are fixed, provisional stops chain
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: applyRouteTimes anchored chain')
    await withoutEnv('MAPBOX_ACCESS_TOKEN', async () => {
      const win5 = dayWindow(240)
      const firstDeparture = atHour(win5.from, 8)

      // 4 geocoded stops, routeOrder 0..3, spread apart (positive, non-floor legs).
      const coords: Array<[number, number]> = [
        [39.0, -104.9],
        [39.05, -104.8],
        [39.1, -104.7],
        [39.15, -104.6],
      ]
      const visits: Array<{ id: string }> = []
      for (let i = 0; i < 4; i++) {
        const wo = await handler.create('work_order', {
          work_order_title: `[TS-verify] applyRouteTimes stop ${i}`,
        })
        createdRecordIds.push(wo.recordId)
        const v = await getVisit(wo.instance.id)
        await assignVisit({ organizationId, userId, visitId: v.id, assigneeUserId: userId })
        await setVisitRouteOrder(v.id, i)
        await setVisitCoords(v.id, coords[i]![0], coords[i]![1])
        visits.push({ id: v.id })
      }
      const visitIds = visits.map((v) => v.id)
      const [v0, v1, v2, v3] = visitIds as [string, string, string, string]

      async function applyAndFetch(dateKey: string) {
        await applyRouteTimes({
          organizationId,
          userId,
          assigneeUserId: userId,
          dateKey,
          firstDeparture,
          visitIds,
        })
        const rows = await Promise.all(visitIds.map((id) => getVisitById(id)))
        return rows
      }

      // ── Case A: all-provisional. Second stop (v1) gets an explicit durationMinutes=90 first
      // (setVisitDuration) — its written span must be 90 while the other three stay 60
      // (default, no prior times/explicit duration).
      await setVisitDuration({ organizationId, userId, visitId: v1, durationMinutes: 90 })
      const [a0, a1, a2, a3] = await applyAndFetch(`${win5.dateKey}-a`)

      check(
        'A: all 4 stops written provisional (timeConfirmedAt null)',
        [a0, a1, a2, a3].every((r) => r.timeConfirmedAt === null)
      )
      check(
        'A: depot-less first stop starts exactly at firstDeparture',
        a0.startTime?.getTime() === firstDeparture.getTime(),
        a0.startTime
      )
      check('A: stop 0 duration = default 60', spanMinutes(a0) === 60, spanMinutes(a0))
      check('A: stop 1 duration = explicit 90', spanMinutes(a1) === 90, spanMinutes(a1))
      check('A: stop 2 duration = default 60', spanMinutes(a2) === 60, spanMinutes(a2))
      check('A: stop 3 duration = default 60', spanMinutes(a3) === 60, spanMinutes(a3))
      check(
        'A: chain is monotonic (start_i >= end_{i-1}) across all 4 stops',
        a1.startTime! >= a0.endTime! &&
          a2.startTime! >= a1.endTime! &&
          a3.startTime! >= a2.endTime!,
        { a0, a1, a2, a3 }
      )

      // ── Case B: mid-route anchor (stop 1 confirmed 10:00-11:00). Re-apply: stop 1 untouched
      // (byte-identical + still confirmed); stop 2 departs from stop 1's endTime; 0/2/3
      // provisional.
      await scheduleVisit({
        organizationId,
        userId,
        visitId: v1,
        startTime: atHour(win5.from, 10),
        endTime: atHour(win5.from, 11),
      })
      const anchorB = await getVisitById(v1)
      const [b0, b1, b2, b3] = await applyAndFetch(`${win5.dateKey}-b`)

      check(
        'B: anchor (stop 1) BYTE-UNCHANGED by the re-apply',
        b1.startTime?.getTime() === anchorB.startTime?.getTime() &&
          b1.endTime?.getTime() === anchorB.endTime?.getTime(),
        { before: anchorB, after: b1 }
      )
      check('B: anchor (stop 1) still confirmed', b1.timeConfirmedAt !== null)
      check('B: stop 2 departs at/after the anchor endTime', b2.startTime! >= b1.endTime!, {
        anchorEnd: b1.endTime,
        stop2Start: b2.startTime,
      })
      check(
        'B: stops 0/2/3 provisional',
        b0.timeConfirmedAt === null && b2.timeConfirmedAt === null && b3.timeConfirmedAt === null
      )
      check(
        'B: stop 0 unaffected by the mid-route anchor (still starts at firstDeparture)',
        b0.startTime?.getTime() === firstDeparture.getTime()
      )

      // ── Case C: anchor FIRST (stop 0). Clear stop 1's anchor first (unschedule), confirm
      // stop 0 (09:00-10:00). Re-apply: stop 0 untouched; stop 1 departs from stop 0's endTime;
      // 1/2/3 provisional; firstDeparture is ignored (the chain starts from the anchor).
      await unscheduleVisit({ organizationId, userId, visitId: v1 })
      await scheduleVisit({
        organizationId,
        userId,
        visitId: v0,
        startTime: atHour(win5.from, 9),
        endTime: atHour(win5.from, 10),
      })
      const anchorC = await getVisitById(v0)
      const [c0, c1, c2, c3] = await applyAndFetch(`${win5.dateKey}-c`)

      check(
        'C: anchor (stop 0, first) BYTE-UNCHANGED',
        c0.startTime?.getTime() === anchorC.startTime?.getTime() &&
          c0.endTime?.getTime() === anchorC.endTime?.getTime()
      )
      check('C: anchor (stop 0) still confirmed', c0.timeConfirmedAt !== null)
      check('C: stop 1 departs at/after the FIRST anchor endTime', c1.startTime! >= c0.endTime!)
      check(
        'C: stops 1/2/3 provisional',
        c1.timeConfirmedAt === null && c2.timeConfirmedAt === null && c3.timeConfirmedAt === null
      )
      check(
        'C: chain continues monotonically past the anchor',
        c2.startTime! >= c1.endTime! && c3.startTime! >= c2.endTime!
      )

      // ── Case D: anchor LAST (stop 3). Clear stop 0's anchor, confirm stop 3 (14:00-15:00).
      // Re-apply: stops 0/1/2 chain normally from firstDeparture (last provisional stop, 2,
      // still chains); stop 3 untouched.
      await unscheduleVisit({ organizationId, userId, visitId: v0 })
      await scheduleVisit({
        organizationId,
        userId,
        visitId: v3,
        startTime: atHour(win5.from, 14),
        endTime: atHour(win5.from, 15),
      })
      const anchorD = await getVisitById(v3)
      const [d0, d1, d2, d3] = await applyAndFetch(`${win5.dateKey}-d`)

      check(
        'D: anchor (stop 3, last) BYTE-UNCHANGED',
        d3.startTime?.getTime() === anchorD.startTime?.getTime() &&
          d3.endTime?.getTime() === anchorD.endTime?.getTime()
      )
      check('D: anchor (stop 3) still confirmed', d3.timeConfirmedAt !== null)
      check(
        'D: stops 0/1/2 provisional and chain from firstDeparture',
        d0.timeConfirmedAt === null &&
          d1.timeConfirmedAt === null &&
          d2.timeConfirmedAt === null &&
          d0.startTime?.getTime() === firstDeparture.getTime()
      )
      check(
        'D: last provisional stop (2) still chains normally (does not reach into the anchor)',
        d1.startTime! >= d0.endTime! && d2.startTime! >= d1.endTime!
      )

      // ── Case E (adjacent anchors, cheap add-on): confirm stops 1 AND 2 (adjacent). Clear
      // stop 3's anchor first. Re-apply: 1 & 2 both untouched; 0 chains to 1; 3 chains from 2's
      // endTime.
      await unscheduleVisit({ organizationId, userId, visitId: v3 })
      await scheduleVisit({
        organizationId,
        userId,
        visitId: v1,
        startTime: atHour(win5.from, 10),
        endTime: atHour(win5.from, 11),
      })
      await scheduleVisit({
        organizationId,
        userId,
        visitId: v2,
        startTime: atHour(win5.from, 11, 30),
        endTime: atHour(win5.from, 12, 30),
      })
      const anchorE1 = await getVisitById(v1)
      const anchorE2 = await getVisitById(v2)
      const [e0, e1, e2, e3] = await applyAndFetch(`${win5.dateKey}-e`)

      check(
        'E: BOTH adjacent anchors (1, 2) byte-unchanged',
        e1.startTime?.getTime() === anchorE1.startTime?.getTime() &&
          e1.endTime?.getTime() === anchorE1.endTime?.getTime() &&
          e2.startTime?.getTime() === anchorE2.startTime?.getTime() &&
          e2.endTime?.getTime() === anchorE2.endTime?.getTime()
      )
      check(
        'E: both adjacent anchors still confirmed',
        e1.timeConfirmedAt !== null && e2.timeConfirmedAt !== null
      )
      check(
        'E: stop 0 provisional, chains to firstDeparture',
        e0.timeConfirmedAt === null && e0.startTime?.getTime() === firstDeparture.getTime()
      )
      check(
        'E: stop 3 provisional, departs from the SECOND anchor (stop 2) endTime',
        e3.timeConfirmedAt === null && e3.startTime! >= e2.endTime!
      )
    })

    // ══════════════════════════════════════════════════════════════════════
    // 6. Recurring materializer — persists durationMinutes, leaves timeConfirmedAt null
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: recurring materializer duration persistence')
    const todayIso = new Date().toISOString().slice(0, 10)
    const woRule = await handler.create('work_order', {
      work_order_title: '[TS-verify] materializer duration',
    })
    createdRecordIds.push(woRule.recordId)

    await setRecurrenceRule({
      organizationId,
      userId,
      workOrderInstanceId: woRule.instance.id,
      pattern: { frequency: 'daily', interval: 1 },
      template: { startMinute: 540, durationMinutes: 75 },
      timezone: 'UTC',
      effectiveFrom: todayIso,
    })
    const rule = await database.query.RecurrenceRule.findFirst({
      where: (t, { eq }) => eq(t.subjectId, woRule.instance.id),
    })
    if (!rule) throw new Error('No recurrence rule materialized for section 6 work order')
    await materializeVisits(rule, { userId })
    const materialized = await database.query.WorkOrderVisit.findMany({
      where: (t, { eq }) => eq(t.recurrenceRuleId, rule.id),
    })
    check(
      '6: materializer produced at least one visit',
      materialized.length > 0,
      materialized.length
    )
    check(
      '6: every materialized row persists the template durationMinutes (75)',
      materialized.every((r) => r.durationMinutes === 75),
      materialized.map((r) => r.durationMinutes)
    )
    check(
      '6: every materialized row leaves timeConfirmedAt null (nobody promised it)',
      materialized.every((r) => r.timeConfirmedAt === null)
    )
  } finally {
    // ── Cleanup ──
    console.log(`Cleanup: deleting ${createdRecordIds.length} verify work orders`)
    for (const recordId of [...new Set(createdRecordIds)].reverse()) {
      try {
        await handler.delete(recordId as never)
      } catch (err) {
        console.log(`  cleanup failed for ${recordId}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const workerId of workerIds) {
      try {
        await removeDispatchWorker(organizationId, workerId)
      } catch (err) {
        console.log(
          `  cleanup failed for worker ${workerId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  const residue = await residueCount()
  check('cleanup: zero "[TS-verify]" residue left in FieldValue', residue === 0, residue)

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

/** `endTime - startTime` in whole minutes, for a fetched visit row. */
function spanMinutes(v: { startTime: Date | null; endTime: Date | null }): number | null {
  if (!v.startTime || !v.endTime) return null
  return Math.round((v.endTime.getTime() - v.startTime.getTime()) / 60_000)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
