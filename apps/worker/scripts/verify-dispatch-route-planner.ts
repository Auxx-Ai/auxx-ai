// apps/worker/scripts/verify-dispatch-route-planner.ts
/**
 * Dispatch M3 "Route Planner" backend verification
 * (plans/dispatch/09-route-planner.md, route-planner build contract's "Phase 3 — verify").
 * Exercises the REAL `@auxx/lib/dispatch/route-planner/*` + `@auxx/lib/geocoding` write/read
 * paths added in Phase 1: the pure `suggestRouteOrder` NN+2-opt heuristic, `setRouteOrder`'s
 * bulk write + removed-stop null-out, `applyRouteTimes`' chained ETA math (contract item 12),
 * address-set-time visit pinning (the ADDRESS_STRUCT normalize hook + the
 * `syncVisitPinsOnAddressNormalized` listener; env-gated MapTiler + a test-only fetch
 * override), `getRoutePlannerBoard`'s day/backlog/projection split, `getRouteLegs`' Mapbox-less
 * fallback + content-addressed Redis cache, and entity migration 039 (`work_order.tags`).
 *
 * Work orders are created via `UnifiedCrudHandler.create` (the M1 number + visit auto-create
 * hooks), prefixed "[RP-verify]", and deleted at the end — `WorkOrderVisit.workOrderId` cascades
 * on `EntityInstance` delete (the `verify-dispatch-m2.ts` precedent), so per-work-order visit
 * cleanup (including raw-inserted extra visit rows) is automatic. The two `DispatchWorker` rows
 * created for the run (dev user + the WS1 "stranger" fixture) are removed explicitly.
 *
 * `apps/worker` has no direct `drizzle-orm` dependency (the `verify-dispatch-recurring.ts`/
 * `verify-dispatch-ws1.ts` precedent) — reads use `database.query.*` (operators arrive as
 * callback args, no import needed), inserts use the plain `database.insert(...).values(...)`
 * builder (no operators needed), and raw column updates (seeding `routeOrder`/lat-lng fixtures
 * directly, since those aren't exposed by any lib mutation) go through
 * `database.$client.query('UPDATE ...', [...])` (the WS1 raw-delete precedent).
 *
 * MAPBOX_ACCESS_TOKEN / MAPTILER_API_KEY are force-deleted from `process.env` at the top of this
 * file, before any lib call reads them, so the fallback/no-key paths are exercised for real, not
 * simulated — both `geocoder.ts`'s `geocode()` and `directions.ts`'s `fetchMapboxLegs()` read
 * their key/token at CALL time (no top-level `process.env` caching), so a delete at any point
 * before the first call takes effect. This is necessary because a MapTiler *test* key has since
 * been added to the root `.env` for other features; `geocoder.ts`'s `setGeocodeFetcherForTesting`
 * test seam stubs the MapTiler response for the geocode-hook sub-tests, restored to `undefined`
 * in a `finally`.
 *
 * BUG FOUND + FIXED (documented in the verify report): `autoGenerateWorkOrderNumber`
 * (packages/lib/src/resources/hooks/work-order-hooks.ts) appended `work_order_number` to the
 * values map via `{ ...values, [field.id]: recordNumber }` — LAST in iteration order. Because
 * post-write field-change hooks fire in per-field iteration order during the same create call,
 * `work_order_address`'s hook (then `geocodeOnAddressChange`, which UPDATEs existing
 * `WorkOrderVisit` rows) fired BEFORE `work_order_number`'s hook (`ensureVisitOnWorkOrderCreate`,
 * which CREATES the visit row) whenever a work order was created with both an address and any
 * other field in one `handler.create` call — the geocode UPDATE silently matched zero rows and
 * the pin was lost. Fixed by flipping the spread order so the number (and its visit-creation
 * hook) always fires first. The pin write has since moved to the address-normalize listener
 * (`syncVisitPinsOnAddressNormalized`), which fires strictly after the address field's hook
 * dispatch, so the same ordering guarantee still protects it. Section 4's `4c` sub-test
 * exercises exactly this combined-create path.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-route-planner.ts
 */

import { createHash } from 'node:crypto'
import { database, schema } from '@auxx/database'
import {
  applyRouteTimes,
  assignVisit,
  getRouteLegs,
  getRoutePlannerBoard,
  haversineMeters,
  type LatLng,
  type RouteStop,
  removeDispatchWorker,
  type SuggestStopInput,
  scheduleVisit,
  setRouteOrder,
  setVisitDuration,
  suggestRouteOrder,
  upsertDispatchWorker,
} from '@auxx/lib/dispatch'
import { setGeocodeFetcherForTesting } from '@auxx/lib/geocoding'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { migration039WorkOrderTags } from '@auxx/lib/seed/entity-migrations/migrations/039-work-order-tags'
import { getRedisData } from '@auxx/redis'

// Force-unset before any lib import/call reads them (both are read at call time — see file
// header) — a MapTiler TEST key has since been added to the root `.env` for other features, but
// this script needs the real no-key/fallback paths, not the keyed path.
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

// ── Date/window helpers ──

/** One UTC calendar day, `daysFromNow` out — mirrors the client-computed `PlannerDayWindow`. */
function dayWindow(daysFromNow: number): { from: Date; to: Date; dateKey: string } {
  const base = new Date()
  base.setUTCDate(base.getUTCDate() + daysFromNow)
  base.setUTCHours(0, 0, 0, 0)
  const from = new Date(base)
  const to = new Date(base.getTime() + 24 * 60 * 60 * 1000 - 1)
  const y = base.getUTCFullYear()
  const m = String(base.getUTCMonth() + 1).padStart(2, '0')
  const d = String(base.getUTCDate()).padStart(2, '0')
  return { from, to, dateKey: `${y}-${m}-${d}` }
}
function atHour(day: Date, hour: number): Date {
  return new Date(day.getTime() + hour * 60 * 60 * 1000)
}

// ── Env-gate helpers (MAPBOX_ACCESS_TOKEN / MAPTILER_API_KEY confirmed unset in dev .env — the
// fallback/no-key paths run for real, not simulated; these guards are defensive only). ──

async function withoutEnv<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env[name]
  delete process.env[name]
  try {
    return await fn()
  } finally {
    if (original !== undefined) process.env[name] = original
  }
}

async function withEnv<T>(name: string, value: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env[name]
  process.env[name] = value
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env[name]
    else process.env[name] = original
  }
}

/** Stub `fetch` for `geocode()` — resolves to the given coords via a fake MapTiler payload. */
function makeGeocodeStub(coords: LatLng): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => ({ features: [{ center: [coords.lng, coords.lat] }] }),
    }) as unknown as Response) as unknown as typeof fetch
}

// ── directions.ts's private hash — duplicated here to compute the EXPECTED Redis cache key
// independently (contract item 2: sha1 of sorted-key JSON of `{ depotStart, depotEnd, stops }`,
// extended in v4 plan §1.2 to rotate the key when the worker's route-home switches flip). ──

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}
function expectedCacheKey(
  organizationId: string,
  assigneeUserId: string,
  dateKey: string,
  depotStart: LatLng | null,
  depotEnd: LatLng | null,
  stops: RouteStop[]
): string {
  const input = {
    depotStart,
    depotEnd,
    stops: stops.map((s) => ({ visitId: s.visitId, lat: s.lat, lng: s.lng })),
  }
  const hash = createHash('sha1')
    .update(JSON.stringify(sortKeysDeep(input)))
    .digest('hex')
  return `dispatch:route:${organizationId}:${assigneeUserId}:${dateKey}:${hash}`
}

/** directions.ts's fallback ETA formula (contract item 1), reimplemented as an independent
 * oracle: 40 km/h, 180s floor, zero-second depot-less first leg. */
function expectedLegSeconds(prev: LatLng | null, stop: LatLng): number {
  if (!prev) return 0
  const FALLBACK_SPEED_MPS = 40_000 / 3_600
  return Math.max(180, Math.round(haversineMeters(prev, stop) / FALLBACK_SPEED_MPS))
}

function totalRouteDistance(depot: LatLng | null, order: LatLng[]): number {
  let total = 0
  let prev: LatLng | null = depot
  for (const stop of order) {
    if (prev) total += haversineMeters(prev, stop)
    prev = stop
  }
  return total
}

// ── DB helpers (M2/WS1 precedent) ──

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
  entityType: string,
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

/**
 * Visit pins now land via the address-normalize listener's fire-and-forget chain
 * (`syncVisitPinsOnAddressNormalized`, visit-hooks.ts) — strictly AFTER the save response, not
 * inline in it — so section 4's coord assertions poll briefly instead of reading immediately.
 */
async function waitForVisitCoords(visitId: string, expected: LatLng, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let visit = await getVisitById(visitId)
  while (
    (visit.latitude !== expected.lat || visit.longitude !== expected.lng) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    visit = await getVisitById(visitId)
  }
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

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — M2/WS1 precedent)
  const userId = user.id

  // WS1's "stranger" fixture: a real `User` row belonging to NO organization — used here as a
  // second worker (assignee-narrowing tests) without disturbing any real org membership.
  const otherUserId = 'AOE6LhgqU5DMxA2oJlOC6xnfAGhnFeHM'
  const otherUser = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.id, otherUserId),
  })
  if (!otherUser) throw new Error(`Stranger fixture user ${otherUserId} not found`)
  console.log(`Org ${organizationId}, dev user ${userId}, stranger user ${otherUserId}`)

  check('MAPBOX_ACCESS_TOKEN unset in the test env', !process.env.MAPBOX_ACCESS_TOKEN)
  check('MAPTILER_API_KEY unset in the test env', !process.env.MAPTILER_API_KEY)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const createdRecordIds: string[] = []
  const workerIds: string[] = []

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. suggestRouteOrder — NN+2-opt heuristic (pure, no I/O)
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: suggestRouteOrder heuristic')

    const depot: LatLng = { lat: 37.0, lng: -122.0 }
    const r = 0.02
    const angleStop = (deg: number) => ({
      lat: depot.lat + r * Math.sin((deg * Math.PI) / 180),
      lng: depot.lng + r * Math.cos((deg * Math.PI) / 180),
    })
    const S0 = angleStop(0)
    const S60 = angleStop(60)
    const S120 = angleStop(120)
    const S180 = angleStop(180)
    const S240 = angleStop(240)
    const S300 = angleStop(300)

    // 1a: a deliberately-bad "star" order (each hop crosses the circle) vs the heuristic.
    const zigzagIds = ['S0', 'S180', 'S60', 'S240', 'S120', 'S300']
    const coordsById: Record<string, LatLng> = {
      S0,
      S60,
      S120,
      S180,
      S240,
      S300,
    }
    const zigzagStops: SuggestStopInput[] = zigzagIds.map((id) => ({
      visitId: id,
      lat: coordsById[id]!.lat,
      lng: coordsById[id]!.lng,
    }))
    const badTotal = totalRouteDistance(
      depot,
      zigzagIds.map((id) => coordsById[id]!)
    )
    const suggested1 = suggestRouteOrder(depot, zigzagStops)
    const suggestedTotal = totalRouteDistance(
      depot,
      suggested1.map((id) => coordsById[id]!)
    )
    check(
      'suggested order is a permutation of the input stops',
      suggested1.length === 6 && new Set(suggested1).size === 6,
      suggested1
    )
    check(
      'NN+2-opt strictly beats the deliberately-bad zigzag order',
      suggestedTotal < badTotal * 0.8,
      { badTotal, suggestedTotal }
    )

    // 1b: null-coord stops are excluded from the heuristic and appended, in original relative
    // order, at the end.
    const naturalStops: SuggestStopInput[] = ['S0', 'S60', 'S120', 'S180', 'S240', 'S300'].map(
      (id) => ({ visitId: id, lat: coordsById[id]!.lat, lng: coordsById[id]!.lng })
    )
    const withNulls: SuggestStopInput[] = [
      naturalStops[0]!,
      naturalStops[1]!,
      { visitId: 'N1', lat: null, lng: null },
      naturalStops[2]!,
      naturalStops[3]!,
      naturalStops[4]!,
      naturalStops[5]!,
      { visitId: 'N2', lat: null, lng: null },
    ]
    const suggested2 = suggestRouteOrder(depot, withNulls)
    check(
      'null-coord stops appended at the end, in original relative order',
      suggested2.length === 8 && suggested2[6] === 'N1' && suggested2[7] === 'N2',
      suggested2
    )
    check(
      'geocoded stops still all present ahead of the null-coord tail',
      new Set(suggested2.slice(0, 6)).size === 6 &&
        ['S0', 'S60', 'S120', 'S180', 'S240', 'S300'].every((id) =>
          suggested2.slice(0, 6).includes(id)
        ),
      suggested2
    )

    // 1c: deterministic across two calls with identical input.
    const suggestedAgain = suggestRouteOrder(depot, zigzagStops)
    check(
      'suggestRouteOrder is deterministic for identical input',
      JSON.stringify(suggestedAgain) === JSON.stringify(suggested1),
      { suggested1, suggestedAgain }
    )

    // ══════════════════════════════════════════════════════════════════════
    // Shared fixture: one DispatchWorker row per test user (needed for applyRouteTimes'
    // worker lookup + getRoutePlannerBoard's workers array).
    // ══════════════════════════════════════════════════════════════════════
    const w1 = await upsertDispatchWorker({
      organizationId,
      userId,
      isActive: true,
      color: '#3366ff',
    })
    workerIds.push(w1.id)
    const w2 = await upsertDispatchWorker({
      organizationId,
      userId: otherUserId,
      isActive: true,
      color: '#22cc88',
    })
    workerIds.push(w2.id)

    // ══════════════════════════════════════════════════════════════════════
    // 2. setRouteOrder — bulk ordering + removed-visit null-out + window/assignee scoping
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: setRouteOrder')
    const win2 = dayWindow(200)

    const woA = await handler.create('work_order', {
      work_order_title: '[RP-verify] setRouteOrder A',
    })
    createdRecordIds.push(woA.recordId)
    const vA = await getVisit(woA.instance.id)
    await assignVisit({ organizationId, userId, visitId: vA.id, assigneeUserId: userId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vA.id,
      startTime: atHour(win2.from, 9),
      endTime: atHour(win2.from, 10),
    })

    const woB = await handler.create('work_order', {
      work_order_title: '[RP-verify] setRouteOrder B',
    })
    createdRecordIds.push(woB.recordId)
    const vB = await getVisit(woB.instance.id)
    await assignVisit({ organizationId, userId, visitId: vB.id, assigneeUserId: userId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vB.id,
      startTime: atHour(win2.from, 11),
      endTime: atHour(win2.from, 12),
    })

    const woC = await handler.create('work_order', {
      work_order_title: '[RP-verify] setRouteOrder C',
    })
    createdRecordIds.push(woC.recordId)
    const vC = await getVisit(woC.instance.id)
    await assignVisit({ organizationId, userId, visitId: vC.id, assigneeUserId: userId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vC.id,
      startTime: atHour(win2.from, 13),
      endTime: atHour(win2.from, 14),
    })

    // vD: same worker+day, HAS a routeOrder, but is OMITTED from the reorder call -> nulled.
    const woD = await handler.create('work_order', {
      work_order_title: '[RP-verify] setRouteOrder D (removed)',
    })
    createdRecordIds.push(woD.recordId)
    const vD = await getVisit(woD.instance.id)
    await assignVisit({ organizationId, userId, visitId: vD.id, assigneeUserId: userId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vD.id,
      startTime: atHour(win2.from, 15),
      endTime: atHour(win2.from, 16),
    })
    await setVisitRouteOrder(vD.id, 5)

    // vE: DIFFERENT assignee, same day+has a routeOrder, omitted -> must stay untouched.
    const woE = await handler.create('work_order', {
      work_order_title: '[RP-verify] setRouteOrder E (other worker)',
    })
    createdRecordIds.push(woE.recordId)
    const vE = await getVisit(woE.instance.id)
    await assignVisit({ organizationId, userId, visitId: vE.id, assigneeUserId: otherUserId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vE.id,
      startTime: atHour(win2.from, 9),
      endTime: atHour(win2.from, 10),
    })
    await setVisitRouteOrder(vE.id, 7)

    // vF: SAME assignee, OUTSIDE the window, has a routeOrder, omitted -> must stay untouched
    // (the null-out is window-scoped).
    const woF = await handler.create('work_order', {
      work_order_title: '[RP-verify] setRouteOrder F (out of window)',
    })
    createdRecordIds.push(woF.recordId)
    const vF = await getVisit(woF.instance.id)
    await assignVisit({ organizationId, userId, visitId: vF.id, assigneeUserId: userId })
    const win2Next = dayWindow(201)
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vF.id,
      startTime: atHour(win2Next.from, 9),
      endTime: atHour(win2Next.from, 10),
    })
    await setVisitRouteOrder(vF.id, 9)

    await setRouteOrder({
      organizationId,
      userId,
      assigneeUserId: userId,
      window: { from: win2.from, to: win2.to },
      dateKey: win2.dateKey,
      visitIds: [vC.id, vA.id, vB.id],
    })

    const [rA, rB, rC, rD, rE, rF] = await Promise.all(
      [vA, vB, vC, vD, vE, vF].map((v) => getVisitById(v.id))
    )
    check('bulk ordering: vC (index 0) -> routeOrder 0', rC.routeOrder === 0, rC.routeOrder)
    check('bulk ordering: vA (index 1) -> routeOrder 1', rA.routeOrder === 1, rA.routeOrder)
    check('bulk ordering: vB (index 2) -> routeOrder 2', rB.routeOrder === 2, rB.routeOrder)
    check(
      'removed-visit null-out: vD (same worker+day, omitted) -> nulled',
      rD.routeOrder === null,
      rD.routeOrder
    )
    check(
      'different assignee untouched: vE keeps its routeOrder (7)',
      rE.routeOrder === 7,
      rE.routeOrder
    )
    check(
      'window bounds respected: vF (out-of-window, omitted) keeps its routeOrder (9)',
      rF.routeOrder === 9,
      rF.routeOrder
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. applyRouteTimes — chained ETA math (contract item 12) + mirror/roll-up
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: applyRouteTimes')
    await withoutEnv('MAPBOX_ACCESS_TOKEN', async () => {
      const win3 = dayWindow(210)

      const woG = await handler.create('work_order', {
        work_order_title: '[RP-verify] applyRouteTimes G',
      })
      createdRecordIds.push(woG.recordId)
      const vG = await getVisit(woG.instance.id)
      await assignVisit({ organizationId, userId, visitId: vG.id, assigneeUserId: userId })

      const woH = await handler.create('work_order', {
        work_order_title: '[RP-verify] applyRouteTimes H',
      })
      createdRecordIds.push(woH.recordId)
      const vH = await getVisit(woH.instance.id)
      await assignVisit({ organizationId, userId, visitId: vH.id, assigneeUserId: userId })

      const woI = await handler.create('work_order', {
        work_order_title: '[RP-verify] applyRouteTimes I',
      })
      createdRecordIds.push(woI.recordId)
      const vI = await getVisit(woI.instance.id)
      await assignVisit({ organizationId, userId, visitId: vI.id, assigneeUserId: userId })

      const G: LatLng = { lat: 39.0, lng: -104.9 }
      const H: LatLng = { lat: 39.0, lng: -104.899 } // ~86m from G — exercises the 180s floor
      const I: LatLng = { lat: 39.05, lng: -104.8 } // ~9.9km from H — well above the floor
      await setVisitCoords(vG.id, G.lat, G.lng)
      await setVisitCoords(vH.id, H.lat, H.lng)
      await setVisitCoords(vI.id, I.lat, I.lng)

      const firstDeparture = atHour(win3.from, 8)
      // plan 20 §4.1a: `applyRouteTimes` reads durations server-side from the visit's own
      // `durationMinutes` column (not client input) — seed them explicitly here so the
      // independent oracle below can compute exact expected spans.
      await setVisitDuration({ organizationId, userId, visitId: vG.id, durationMinutes: 20 })
      await setVisitDuration({ organizationId, userId, visitId: vH.id, durationMinutes: 15 })
      await setVisitDuration({ organizationId, userId, visitId: vI.id, durationMinutes: 25 })

      await applyRouteTimes({
        organizationId,
        userId,
        assigneeUserId: userId,
        dateKey: win3.dateKey,
        firstDeparture,
        visitIds: [vG.id, vH.id, vI.id],
      })

      // Independent oracle (contract item 12): depot is null for this org (no
      // documents.business address configured), so the first leg is the documented
      // zero-second depot-less leg.
      const leg1 = expectedLegSeconds(null, G)
      const leg2 = expectedLegSeconds(G, H)
      const leg3 = expectedLegSeconds(H, I)
      check('leg1 is exactly zero (no depot)', leg1 === 0, leg1)
      check('leg2 hits the 180s floor (stops ~86m apart)', leg2 === 180, leg2)
      check('leg3 exceeds the 180s floor (stops ~9.9km apart)', leg3 > 180, leg3)

      const start1 = new Date(firstDeparture.getTime() + leg1 * 1000)
      const end1 = new Date(start1.getTime() + 20 * 60_000)
      const start2 = new Date(end1.getTime() + leg2 * 1000)
      const end2 = new Date(start2.getTime() + 15 * 60_000)
      const start3 = new Date(end2.getTime() + leg3 * 1000)
      const end3 = new Date(start3.getTime() + 25 * 60_000)

      const [afterG, afterH, afterI] = await Promise.all(
        [vG, vH, vI].map((v) => getVisitById(v.id))
      )
      check(
        'depot-less first stop: startTime_1 = firstDeparture exactly',
        afterG.startTime?.getTime() === start1.getTime(),
        { got: afterG.startTime, expected: start1 }
      )
      check('endTime_1 = startTime_1 + duration_1', afterG.endTime?.getTime() === end1.getTime())
      check(
        'startTime_2 = departure_1 (endTime_1) + leg2Seconds',
        afterH.startTime?.getTime() === start2.getTime(),
        { got: afterH.startTime, expected: start2 }
      )
      check('endTime_2 = startTime_2 + duration_2', afterH.endTime?.getTime() === end2.getTime())
      check(
        'startTime_3 = departure_2 (endTime_2) + leg3Seconds',
        afterI.startTime?.getTime() === start3.getTime(),
        { got: afterI.startTime, expected: start3 }
      )
      check('endTime_3 = startTime_3 + duration_3', afterI.endTime?.getTime() === end3.getTime())

      // Mirror/roll-up fire exactly like a manual reschedule (scheduleVisit per row).
      for (const [label, wo, expectedStart] of [
        ['G', woG, start1],
        ['H', woH, start2],
        ['I', woI, start3],
      ] as const) {
        const mirror = await fieldValueByAttr(
          organizationId,
          'work_order',
          wo.instance.id,
          'work_order_scheduled_start'
        )
        check(
          `mirror: wo${label}.work_order_scheduled_start matches its visit's startTime`,
          sameInstant(mirror?.valueDate, expectedStart),
          mirror?.valueDate
        )
        check(
          `roll-up: wo${label}.work_order_status -> scheduled`,
          (await woStatus(organizationId, wo.instance.id)) === 'scheduled'
        )
      }
    })

    // ══════════════════════════════════════════════════════════════════════
    // 4. address-geocode visit pinning (normalize hook + syncVisitPinsOnAddressNormalized
    //    listener) — env-gated, injectable-fetch stub, all-visit-rows fan-out
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: address-geocode visit pinning')

    // 4a: no MAPTILER_API_KEY -> address write leaves coords null, never throws.
    await withoutEnv('MAPTILER_API_KEY', async () => {
      const woJ = await handler.create('work_order', {
        work_order_title: '[RP-verify] geocode 4a no-key',
        work_order_address: {
          street1: '1 No Key Way',
          city: 'Nowhere',
          state: 'TX',
          zipCode: '00000',
          country: 'US',
        },
      })
      createdRecordIds.push(woJ.recordId)
      const vJ = await getVisit(woJ.instance.id)
      check('4a: create with address + no MAPTILER_API_KEY does not throw (reached here)', true)
      check(
        '4a: visit stays unpinned (latitude/longitude null)',
        vJ.latitude === null && vJ.longitude === null,
        vJ
      )
    })

    // 4b: stubbed geocoder — address SET (create) then CHANGED, coords land on ALL the WO's
    // visit rows both times, with different coords the second time.
    await withEnv('MAPTILER_API_KEY', 'rp-verify-dummy-key', async () => {
      try {
        const stub1: LatLng = { lat: 40.7128, lng: -74.006 } // NYC
        const stub2: LatLng = { lat: 34.0522, lng: -118.2437 } // LA

        const woK = await handler.create('work_order', {
          work_order_title: '[RP-verify] geocode 4b',
        })
        createdRecordIds.push(woK.recordId)
        const vK1 = await getVisit(woK.instance.id)
        // A second visit row for the SAME work order — proves "ALL the WO's visit rows" fan-out.
        const [vK2] = await database
          .insert(schema.WorkOrderVisit)
          .values({
            organizationId,
            workOrderId: woK.instance.id,
            status: 'scheduled',
            timezone: 'UTC',
            updatedAt: new Date(),
          })
          .returning()
        if (!vK2) throw new Error('Failed to insert the second WorkOrderVisit fixture')

        setGeocodeFetcherForTesting(makeGeocodeStub(stub1))
        await handler.update(woK.recordId, {
          work_order_address: {
            street1: '350 5th Ave',
            city: 'New York',
            state: 'NY',
            zipCode: '10118',
            country: 'US',
          },
        })
        const [afterK1a, afterK2a] = await Promise.all([
          waitForVisitCoords(vK1.id, stub1),
          waitForVisitCoords(vK2.id, stub1),
        ])
        check(
          '4b (address create): visit 1 latitude/longitude = stubbed coords',
          afterK1a.latitude === stub1.lat && afterK1a.longitude === stub1.lng,
          afterK1a
        )
        check(
          '4b (address create): visit 2 (extra row, same WO) ALSO got the stubbed coords',
          afterK2a.latitude === stub1.lat && afterK2a.longitude === stub1.lng,
          afterK2a
        )

        setGeocodeFetcherForTesting(makeGeocodeStub(stub2))
        await handler.update(woK.recordId, {
          work_order_address: {
            street1: '200 N Spring St',
            city: 'Los Angeles',
            state: 'CA',
            zipCode: '90012',
            country: 'US',
          },
        })
        const [afterK1b, afterK2b] = await Promise.all([
          waitForVisitCoords(vK1.id, stub2),
          waitForVisitCoords(vK2.id, stub2),
        ])
        check(
          '4b (address change): visit 1 updated to the NEW stubbed coords',
          afterK1b.latitude === stub2.lat && afterK1b.longitude === stub2.lng,
          afterK1b
        )
        check(
          '4b (address change): visit 2 ALSO updated to the NEW stubbed coords',
          afterK2b.latitude === stub2.lat && afterK2b.longitude === stub2.lng,
          afterK2b
        )

        // 4c: combined create (title + address in ONE handler.create call) — regression
        // coverage for the field-ordering bug found+fixed this session (see file header).
        const stub3: LatLng = { lat: 47.6062, lng: -122.3321 } // Seattle
        setGeocodeFetcherForTesting(makeGeocodeStub(stub3))
        const woL = await handler.create('work_order', {
          work_order_title: '[RP-verify] geocode 4c combined-create',
          work_order_address: {
            street1: '600 4th Ave',
            city: 'Seattle',
            state: 'WA',
            zipCode: '98104',
            country: 'US',
          },
        })
        createdRecordIds.push(woL.recordId)
        const vL = await waitForVisitCoords((await getVisit(woL.instance.id)).id, stub3)
        check(
          '4c: address set in the SAME create() call still geocodes the auto-created visit row',
          vL.latitude === stub3.lat && vL.longitude === stub3.lng,
          vL
        )
      } finally {
        setGeocodeFetcherForTesting(undefined)
      }
    })

    // ══════════════════════════════════════════════════════════════════════
    // 5. getRoutePlannerBoard — day visits + backlog split, tags/address, workerIds narrowing
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: getRoutePlannerBoard')
    const win5 = dayWindow(220)

    const woM = await handler.create('work_order', {
      work_order_title: '[RP-verify] board M (userId, tags+address)',
      work_order_tags: ['north-region', 'urgent'],
      work_order_address: {
        street1: '100 Board St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'US',
      },
    })
    createdRecordIds.push(woM.recordId)
    const vM = await getVisit(woM.instance.id)
    await assignVisit({ organizationId, userId, visitId: vM.id, assigneeUserId: userId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vM.id,
      startTime: atHour(win5.from, 9),
      endTime: atHour(win5.from, 10),
    })
    await setVisitRouteOrder(vM.id, 2)
    await setVisitCoords(vM.id, 30.27, -97.74)

    const woN = await handler.create('work_order', {
      work_order_title: '[RP-verify] board N (otherUserId)',
    })
    createdRecordIds.push(woN.recordId)
    const vN = await getVisit(woN.instance.id)
    await assignVisit({ organizationId, userId, visitId: vN.id, assigneeUserId: otherUserId })
    await scheduleVisit({
      organizationId,
      userId,
      visitId: vN.id,
      startTime: atHour(win5.from, 11),
      endTime: atHour(win5.from, 12),
    })

    const woO = await handler.create('work_order', {
      work_order_title: '[RP-verify] board O (backlog)',
    })
    createdRecordIds.push(woO.recordId)
    const vO = await getVisit(woO.instance.id) // stays unscheduled -> backlog

    const board = await getRoutePlannerBoard(organizationId, {
      from: win5.from,
      to: win5.to,
      dateKey: win5.dateKey,
    })
    const boardVisitIds = new Set(board.visits.map((v) => v.id))
    check('day visits include the userId-assigned visit', boardVisitIds.has(vM.id))
    check(
      'day visits include the otherUserId-assigned visit (unfiltered by default)',
      boardVisitIds.has(vN.id)
    )
    const backlogIds = new Set(board.backlog.map((v) => v.id))
    check('backlog includes the unscheduled visit', backlogIds.has(vO.id))
    check('backlog EXCLUDES scheduled visits', !backlogIds.has(vM.id) && !backlogIds.has(vN.id))

    const vMRow = board.visits.find((v) => v.id === vM.id)
    check('routeOrder rides along on the visit row', vMRow?.routeOrder === 2, vMRow?.routeOrder)
    check(
      'latitude/longitude ride along on the visit row',
      vMRow?.latitude === 30.27 && vMRow?.longitude === -97.74,
      vMRow
    )

    const woMProj = board.workOrders.find((w) => w.id === woM.instance.id)
    check(
      'tags[] present on the projection',
      !!woMProj &&
        woMProj.tags.length === 2 &&
        new Set(woMProj.tags).has('north-region') &&
        new Set(woMProj.tags).has('urgent'),
      woMProj?.tags
    )
    check(
      'addressText present + formatted on the projection',
      !!woMProj?.addressText?.includes('Austin') && !!woMProj?.addressText?.includes('78701'),
      woMProj?.addressText
    )

    check(
      'workers array includes both workers before any filter',
      board.workers.some((w) => w.userId === userId) &&
        board.workers.some((w) => w.userId === otherUserId)
    )
    for (const w of board.workers) {
      check(
        `availabilityStart shape ('HH:mm' | null) for worker ${w.userId}`,
        w.availabilityStart === null || /^\d{2}:\d{2}$/.test(w.availabilityStart),
        w.availabilityStart
      )
    }

    const boardFiltered = await getRoutePlannerBoard(
      organizationId,
      { from: win5.from, to: win5.to, dateKey: win5.dateKey },
      [userId]
    )
    check(
      'workerIds narrows the workers array to ONLY the given worker',
      boardFiltered.workers.length === 1 && boardFiltered.workers[0]?.userId === userId,
      boardFiltered.workers
    )
    const filteredVisitIds = new Set(boardFiltered.visits.map((v) => v.id))
    check(
      'workerIds does NOT narrow visits/backlog (otherUserId visit still present)',
      filteredVisitIds.has(vM.id) && filteredVisitIds.has(vN.id)
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6. directions fallback (no Mapbox token) + content-addressed Redis cache
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: directions fallback + redis cache')
    await withoutEnv('MAPBOX_ACCESS_TOKEN', async () => {
      const dateKey6 = 'rp-verify-section6'
      const stopsV1: RouteStop[] = [
        { visitId: 'rp-verify-s6-a', lat: 41.8781, lng: -87.6298 },
        { visitId: 'rp-verify-s6-b', lat: 41.88, lng: -87.62 },
        { visitId: 'rp-verify-s6-c', lat: 41.9, lng: -87.6 },
      ]

      const result1 = await getRouteLegs(organizationId, userId, dateKey6, null, null, stopsV1)
      check('fallback: source = fallback (no Mapbox token)', result1.source === 'fallback')
      check('fallback: one leg per stop', result1.legs.length === stopsV1.length)
      check(
        'fallback: first leg (no depot) = 0 seconds, single-point geometry',
        result1.legs[0]?.seconds === 0 && result1.legs[0]?.geometry.length === 1
      )
      const expLeg2 = expectedLegSeconds(stopsV1[0]!, stopsV1[1]!)
      const expLeg3 = expectedLegSeconds(stopsV1[1]!, stopsV1[2]!)
      check(
        'fallback: leg 2 ETA = haversine@40km/h with 180s floor',
        result1.legs[1]?.seconds === expLeg2,
        { got: result1.legs[1]?.seconds, expected: expLeg2 }
      )
      check(
        'fallback: leg 3 ETA = haversine@40km/h with 180s floor',
        result1.legs[2]?.seconds === expLeg3,
        { got: result1.legs[2]?.seconds, expected: expLeg3 }
      )
      check(
        'fallback: non-first legs carry a two-point straight line',
        result1.legs[1]?.geometry.length === 2
      )

      const key1 = expectedCacheKey(organizationId, userId, dateKey6, null, null, stopsV1)
      const cached1 = await getRedisData(key1)
      check(
        'redis cache key exists after the first call',
        cached1 !== null && cached1 !== undefined,
        key1
      )
      check(
        'cached value deep-equals the returned RouteGeometry',
        JSON.stringify(cached1) === JSON.stringify(result1)
      )

      const result2 = await getRouteLegs(organizationId, userId, dateKey6, null, null, stopsV1)
      check(
        'second call with identical input returns a deep-equal result (cache hit)',
        JSON.stringify(result2) === JSON.stringify(result1)
      )

      const stopsReordered = [stopsV1[1]!, stopsV1[0]!, stopsV1[2]!]
      const key2 = expectedCacheKey(organizationId, userId, dateKey6, null, null, stopsReordered)
      check('reordering stops changes the cache key', key2 !== key1, { key1, key2 })
      await getRouteLegs(organizationId, userId, dateKey6, null, null, stopsReordered)
      const cached2 = await getRedisData(key2)
      check(
        'the new key is cached after the reordered call',
        cached2 !== null && cached2 !== undefined
      )
      const cached1Again = await getRedisData(key1)
      check(
        'the original key is untouched (no invalidation on reorder)',
        JSON.stringify(cached1Again) === JSON.stringify(cached1)
      )
    })

    // ══════════════════════════════════════════════════════════════════════
    // 7. Entity migration 039 (work_order.tags) — idempotency
    // ══════════════════════════════════════════════════════════════════════
    console.log('7: migration 039 idempotency')
    const run1 = await migration039WorkOrderTags.up(database, organizationId)
    check(
      'migration039 run 1: alreadyUpToDate (this org already has work_order.tags)',
      run1.alreadyUpToDate === true,
      run1
    )
    const run2 = await migration039WorkOrderTags.up(database, organizationId)
    check(
      'migration039 run 2: alreadyUpToDate (idempotent re-run)',
      run2.alreadyUpToDate === true,
      run2
    )

    const workOrderDefId = await entityDefId(organizationId, 'work_order')
    const tagsField = workOrderDefId
      ? await database.query.CustomField.findFirst({
          columns: { id: true },
          where: (t, { and, eq }) =>
            and(eq(t.entityDefinitionId, workOrderDefId), eq(t.systemAttribute, 'work_order_tags')),
        })
      : null
    check('work_order.tags CustomField row exists after the migration', !!tagsField, tagsField)
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

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
