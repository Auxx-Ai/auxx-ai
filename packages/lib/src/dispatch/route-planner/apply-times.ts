// packages/lib/src/dispatch/route-planner/apply-times.ts
//
// "Apply times to schedule" (plans/dispatch/09-route-planner.md §E/§F, build contract item 12;
// anchored-chain rework plans/dispatch/20-route-times-sync.md §4.4) — the only path that writes
// `startTime`/`endTime` from the planner. Walks the dispatcher-confirmed stop order as a
// sequence of segments split at CONFIRMED stops (anchors, plan 20 §4.2): an anchor's own write
// is skipped (its time is a promise, not planner math) and its `endTime` becomes the next
// segment's departure; provisional stops between anchors get chained off the same Directions
// leg durations the map preview draws from (cache-shared), written through the existing
// single-visit `scheduleVisit` with `timeWriteKind: 'provisional'` — mirror/roll-up/broadcast
// fire exactly like a manual reschedule. `routeOrder` is left untouched (already correct from
// `setRouteOrder`); only the time fields move. Conflicts (computed arrival at an anchor later
// than its confirmed `startTime`) are NOT errored here — Phase 2 only reports them, client-side,
// in the apply-times dialog preview (§4.4).

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { resolveVisitDurationMinutes } from '../types'
import { scheduleVisit } from '../visit-mutations'
import { listDispatchWorkers } from '../workers'
import { resolveRouteStart } from './depot'
import { getRouteLegs } from './directions'
import type { RouteStop } from './types'

/** Input for {@link applyRouteTimes}. */
export interface ApplyRouteTimesInput {
  organizationId: string
  userId: string
  assigneeUserId: string
  /** `yyyy-MM-dd` label of the planned day, client-resolved — the Directions cache-key day. */
  dateKey: string
  /** The confirmed first-departure time (editable default: worker availability day-start). */
  firstDeparture: Date
  /** Ordered visit ids (dispatcher-confirmed `routeOrder`). Durations are read server-side
   * from each visit's `durationMinutes` (plan 20 §4.1a) — not client input. */
  visitIds: string[]
  excludeSocketId?: string
}

/**
 * Walk the ordered stops as anchor-delimited segments (plan 20 §4.4): a stop is an ANCHOR when
 * it already has a confirmed time (`timeConfirmedAt !== null` with both `startTime`/`endTime`
 * set) — its write is skipped entirely and its `endTime` becomes the next segment's departure.
 * Provisional stops chain off the same Directions leg durations the map preview uses (contract
 * item 12): `arrival_i = departure_{i-1} + legSeconds_i`, `startTime_i = arrival_i`,
 * `endTime_i = startTime_i + durationMinutes_i` (read via {@link resolveVisitDurationMinutes}),
 * `departure_i = endTime_i` — `departure_0 = firstDeparture`. Writes through `scheduleVisit`
 * per row, in order, with `timeWriteKind: 'provisional'` (each write's mirror/roll-up/broadcast
 * still fires the same as a manual reschedule).
 */
export async function applyRouteTimes(input: ApplyRouteTimesInput): Promise<void> {
  const {
    organizationId,
    userId,
    assigneeUserId,
    dateKey,
    firstDeparture,
    visitIds,
    excludeSocketId,
  } = input
  if (visitIds.length === 0) return

  const worker = (await listDispatchWorkers(organizationId)).find(
    (w) => w.userId === assigneeUserId
  )
  if (!worker) throw new NotFoundError('Dispatch worker not found')

  const visitRows = await database
    .select({
      id: schema.WorkOrderVisit.id,
      latitude: schema.WorkOrderVisit.latitude,
      longitude: schema.WorkOrderVisit.longitude,
      startTime: schema.WorkOrderVisit.startTime,
      endTime: schema.WorkOrderVisit.endTime,
      timeConfirmedAt: schema.WorkOrderVisit.timeConfirmedAt,
      durationMinutes: schema.WorkOrderVisit.durationMinutes,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        inArray(schema.WorkOrderVisit.id, visitIds)
      )
    )
  const rowsByVisitId = new Map(visitRows.map((r) => [r.id, r]))

  const homePoint = await resolveRouteStart(organizationId, worker)
  const depotStart = worker.routeStartAtHome ? homePoint : null
  const depotEnd = worker.routeEndAtHome ? homePoint : null

  // Preserve the given (dispatcher-confirmed) order; drop ungeocoded stops from the waypoint
  // list fed to Directions — no leg can be drawn to/from a point with no coordinates. Those
  // stops fall back to a zero-second leg below (no travel-time signal available for them).
  const geoStops: RouteStop[] = []
  for (const visitId of visitIds) {
    const row = rowsByVisitId.get(visitId)
    if (row && row.latitude !== null && row.longitude !== null) {
      geoStops.push({ visitId, lat: row.latitude, lng: row.longitude })
    }
  }

  const geometry = await getRouteLegs(
    organizationId,
    assigneeUserId,
    dateKey,
    depotStart,
    depotEnd,
    geoStops
  )
  const legSecondsByVisitId = new Map(geometry.legs.map((leg) => [leg.toVisitId, leg.seconds]))

  let departure = firstDeparture
  for (const visitId of visitIds) {
    const row = rowsByVisitId.get(visitId)
    if (!row) continue

    const isAnchor = row.timeConfirmedAt !== null && row.startTime !== null && row.endTime !== null
    if (isAnchor) {
      // Confirmed stops are fixed (§4.4): skip the write, chain off its existing endTime. A
      // conflict (the chain's arrival here would have landed after this promised start) is not
      // detectable retroactively once we've skipped ahead — the dialog preview computes and
      // reports it client-side before confirm.
      departure = row.endTime as Date
      continue
    }

    const legSeconds = legSecondsByVisitId.get(visitId) ?? 0
    const durationMinutes = resolveVisitDurationMinutes(row)
    const startTime = new Date(departure.getTime() + legSeconds * 1000)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)

    await scheduleVisit({
      organizationId,
      userId,
      visitId,
      startTime,
      endTime,
      timeWriteKind: 'provisional',
      excludeSocketId,
    })

    departure = endTime
  }
}
