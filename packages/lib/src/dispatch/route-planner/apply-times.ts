// packages/lib/src/dispatch/route-planner/apply-times.ts
//
// "Apply times to schedule" (plans/dispatch/09-route-planner.md §E/§F, build contract item 12)
// — the only path that writes `startTime`/`endTime` from the planner. Chains each ordered
// stop's arrival off the previous stop's departure using the same Directions helper the map
// preview draws from (cache-shared), then writes each visit via the existing single-visit
// `scheduleVisit` — mirror/roll-up/broadcast fire exactly like a manual reschedule.
// `routeOrder` is left untouched (already correct from `setRouteOrder`); only the time fields
// move.

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { scheduleVisit } from '../visit-mutations'
import { listDispatchWorkers } from '../workers'
import { resolveRouteStart } from './depot'
import { getRouteLegs } from './directions'
import type { RouteStop } from './types'

/** One stop's on-site duration, in the dispatcher-confirmed order. */
export interface ApplyRouteTimesStop {
  visitId: string
  durationMinutes: number
}

/** Input for {@link applyRouteTimes}. */
export interface ApplyRouteTimesInput {
  organizationId: string
  userId: string
  assigneeUserId: string
  /** `yyyy-MM-dd` label of the planned day, client-resolved — the Directions cache-key day. */
  dateKey: string
  /** The confirmed first-departure time (editable default: worker availability day-start). */
  firstDeparture: Date
  /** Ordered stops (dispatcher-confirmed `routeOrder`) with each visit's on-site duration. */
  stops: ApplyRouteTimesStop[]
  excludeSocketId?: string
}

/**
 * Walk the ordered stops, computing each `startTime`/`endTime` from the same Directions leg
 * durations the map preview uses (contract item 12): `arrival_i = departure_{i-1} + legSeconds_i`,
 * `startTime_i = arrival_i`, `endTime_i = startTime_i + durationMinutes_i`,
 * `departure_i = endTime_i` — `departure_0 = firstDeparture`. Writes through `scheduleVisit`
 * per row, in order (each write's mirror/roll-up/broadcast fires the same as a manual
 * reschedule).
 */
export async function applyRouteTimes(input: ApplyRouteTimesInput): Promise<void> {
  const {
    organizationId,
    userId,
    assigneeUserId,
    dateKey,
    firstDeparture,
    stops,
    excludeSocketId,
  } = input
  if (stops.length === 0) return

  const worker = (await listDispatchWorkers(organizationId)).find(
    (w) => w.userId === assigneeUserId
  )
  if (!worker) throw new NotFoundError('Dispatch worker not found')

  const visitIds = stops.map((s) => s.visitId)
  const visitRows = await database
    .select({
      id: schema.WorkOrderVisit.id,
      latitude: schema.WorkOrderVisit.latitude,
      longitude: schema.WorkOrderVisit.longitude,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        inArray(schema.WorkOrderVisit.id, visitIds)
      )
    )
  const coordsByVisitId = new Map(visitRows.map((r) => [r.id, r]))

  const homePoint = await resolveRouteStart(organizationId, worker)
  const depotStart = worker.routeStartAtHome ? homePoint : null
  const depotEnd = worker.routeEndAtHome ? homePoint : null

  // Preserve the given (dispatcher-confirmed) order; drop ungeocoded stops from the waypoint
  // list fed to Directions — no leg can be drawn to/from a point with no coordinates. Those
  // stops fall back to a zero-second leg below (no travel-time signal available for them).
  const geoStops: RouteStop[] = []
  for (const stop of stops) {
    const coords = coordsByVisitId.get(stop.visitId)
    if (coords && coords.latitude !== null && coords.longitude !== null) {
      geoStops.push({ visitId: stop.visitId, lat: coords.latitude, lng: coords.longitude })
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
  for (const stop of stops) {
    const legSeconds = legSecondsByVisitId.get(stop.visitId) ?? 0
    const startTime = new Date(departure.getTime() + legSeconds * 1000)
    const endTime = new Date(startTime.getTime() + stop.durationMinutes * 60_000)

    await scheduleVisit({
      organizationId,
      userId,
      visitId: stop.visitId,
      startTime,
      endTime,
      excludeSocketId,
    })

    departure = endTime
  }
}
