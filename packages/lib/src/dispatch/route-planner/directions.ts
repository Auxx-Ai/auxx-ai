// packages/lib/src/dispatch/route-planner/directions.ts
//
// Route geometry + ETA (plans/dispatch/09-route-planner.md §C, build contract items 1/2).
// Mapbox Directions (`driving-traffic`) behind `MAPBOX_ACCESS_TOKEN`; absent key → straight-line
// fallback legs + haversine ETA @ 40km/h. Redis content-addressed cache — no invalidation, 24h
// TTL; any reorder/reassign changes the hash so the cache key itself rotates and stale keys
// simply expire unread (contract item 2).

import { createHash } from 'node:crypto'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisData, setRedisData } from '@auxx/redis'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { listDispatchWorkers } from '../workers'
import { resolveRouteStart } from './depot'
import { haversineMeters } from './suggest'
import type {
  LatLng,
  PlannerDayWindow,
  ReturnLeg,
  RouteGeometry,
  RouteLeg,
  RouteStop,
} from './types'

const logger = createScopedLogger('dispatch:route-planner:directions')

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic'
const REQUEST_TIMEOUT_MS = 8_000
const CACHE_TTL_SECONDS = 86_400
/** 40 km/h in meters/second (contract item 1's fallback ETA speed). */
const FALLBACK_SPEED_METERS_PER_SECOND = 40_000 / 3_600
const FALLBACK_MIN_LEG_SECONDS = 180

/** Deep sort-keys — never hash unsorted JSON (standing repo lesson). */
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

function hashRouteInput(
  depotStart: LatLng | null,
  depotEnd: LatLng | null,
  stops: RouteStop[]
): string {
  const input = {
    depotStart,
    depotEnd,
    stops: stops.map((s) => ({ visitId: s.visitId, lat: s.lat, lng: s.lng })),
  }
  return createHash('sha1')
    .update(JSON.stringify(sortKeysDeep(input)))
    .digest('hex')
}

/** Straight-line fallback legs (contract item 1): two-point geometry, haversine ETA @ 40km/h. */
function fallbackLegs(
  depotStart: LatLng | null,
  depotEnd: LatLng | null,
  orderedStops: RouteStop[]
): { legs: RouteLeg[]; returnLeg: ReturnLeg | null } {
  const legs: RouteLeg[] = []
  let prev: LatLng | null = depotStart
  for (const stop of orderedStops) {
    // No depot → the route starts AT the first stop: zero-second leg, matching the Mapbox
    // path where the first stop has no leg at all.
    const seconds = prev
      ? Math.max(
          FALLBACK_MIN_LEG_SECONDS,
          Math.round(haversineMeters(prev, stop) / FALLBACK_SPEED_METERS_PER_SECOND)
        )
      : 0
    legs.push({
      toVisitId: stop.visitId,
      seconds,
      geometry: prev
        ? [
            [prev.lng, prev.lat],
            [stop.lng, stop.lat],
          ]
        : [[stop.lng, stop.lat]],
    })
    prev = stop
  }

  let returnLeg: ReturnLeg | null = null
  if (depotEnd && orderedStops.length > 0) {
    const last = orderedStops[orderedStops.length - 1]!
    returnLeg = {
      seconds: Math.max(
        FALLBACK_MIN_LEG_SECONDS,
        Math.round(haversineMeters(last, depotEnd) / FALLBACK_SPEED_METERS_PER_SECOND)
      ),
      geometry: [
        [last.lng, last.lat],
        [depotEnd.lng, depotEnd.lat],
      ],
    }
  }

  return { legs, returnLeg }
}

interface MapboxDirectionsResponse {
  routes?: {
    legs?: { duration: number }[]
    geometry?: { coordinates: [number, number][] }
  }[]
}

/** One Mapbox Directions waypoint tagged with what it represents, so response legs (one per
 * consecutive waypoint pair) can be routed back to a `RouteLeg`/`ReturnLeg`/depot-start skip. */
type TaggedWaypoint =
  | { point: LatLng; kind: 'depotStart' }
  | { point: LatLng; kind: 'stop'; visitId: string }
  | { point: LatLng; kind: 'depotEnd' }

function buildWaypoints(
  depotStart: LatLng | null,
  depotEnd: LatLng | null,
  orderedStops: RouteStop[]
): TaggedWaypoint[] {
  const waypoints: TaggedWaypoint[] = []
  if (depotStart) waypoints.push({ point: depotStart, kind: 'depotStart' })
  for (const stop of orderedStops) {
    waypoints.push({ point: { lat: stop.lat, lng: stop.lng }, kind: 'stop', visitId: stop.visitId })
  }
  if (depotEnd) waypoints.push({ point: depotEnd, kind: 'depotEnd' })
  return waypoints
}

/** Mapbox `driving-traffic` legs + optional return leg, or `null` on any failure/missing token
 * (never throws). */
async function fetchMapboxLegs(
  depotStart: LatLng | null,
  depotEnd: LatLng | null,
  orderedStops: RouteStop[]
): Promise<{ legs: RouteLeg[]; returnLeg: ReturnLeg | null } | null> {
  const token = process.env.MAPBOX_ACCESS_TOKEN
  if (!token) return null

  const waypoints = buildWaypoints(depotStart, depotEnd, orderedStops)
  if (waypoints.length < 2) return null

  const coords = waypoints.map((w) => `${w.point.lng},${w.point.lat}`).join(';')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = `${MAPBOX_DIRECTIONS_URL}/${coords}?geometries=geojson&overview=full&access_token=${token}`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null

    const data = (await res.json()) as MapboxDirectionsResponse
    const route = data.routes?.[0]
    if (!route?.legs || route.legs.length === 0) return null

    // Mapbox returns one leg per consecutive waypoint pair (no per-leg geometry split) — the
    // full route polyline is attached to the first leg so the map draws one continuous line
    // per worker (return leg included); subsequent legs carry an empty geometry array.
    const fullGeometry = route.geometry?.coordinates ?? []
    const legs: RouteLeg[] = []
    let returnLeg: ReturnLeg | null = null
    route.legs.forEach((leg, i) => {
      const end = waypoints[i + 1]!
      const seconds = Math.round(leg.duration)
      const geometry = i === 0 ? fullGeometry : []
      if (end.kind === 'depotEnd') {
        returnLeg = { seconds, geometry }
      } else if (end.kind === 'stop') {
        legs.push({ toVisitId: end.visitId, seconds, geometry })
      }
    })
    return { legs, returnLeg }
  } catch (error) {
    logger.warn('Mapbox Directions request failed', { error })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Directions for one worker's ordered stop list on one day (contract's `directions.ts`):
 * Mapbox `driving-traffic` behind `MAPBOX_ACCESS_TOKEN`, else the straight-line/haversine
 * fallback (contract item 1) — never throws, always returns a usable `RouteGeometry`.
 * Content-addressed Redis cache (contract item 2): key =
 * `dispatch:route:{orgId}:{assigneeUserId}:{dateKey}:{hash}` where `hash` is a sha1 of the
 * sorted-key JSON of `{ depotStart, depotEnd, stops }` — flipping either worker route-home
 * switch changes `depotStart`/`depotEnd`, which rotates the hash and thus the cache key. 24h
 * TTL, no invalidation — the key itself rotates and stale keys just expire unread.
 */
export async function getRouteLegs(
  organizationId: string,
  assigneeUserId: string,
  dateKey: string,
  depotStart: LatLng | null,
  depotEnd: LatLng | null,
  orderedStops: RouteStop[]
): Promise<RouteGeometry> {
  const hash = hashRouteInput(depotStart, depotEnd, orderedStops)
  const cacheKey = `dispatch:route:${organizationId}:${assigneeUserId}:${dateKey}:${hash}`

  const cached = (await getRedisData(cacheKey)) as RouteGeometry | null
  if (cached) return cached

  let result: RouteGeometry
  if (orderedStops.length === 0) {
    result = { legs: [], source: 'fallback', depot: depotStart, returnLeg: null }
  } else {
    const mapboxResult = await fetchMapboxLegs(depotStart, depotEnd, orderedStops)
    if (mapboxResult) {
      result = {
        legs: mapboxResult.legs,
        source: 'mapbox',
        depot: depotStart,
        returnLeg: mapboxResult.returnLeg,
      }
    } else {
      const fallback = fallbackLegs(depotStart, depotEnd, orderedStops)
      result = {
        legs: fallback.legs,
        source: 'fallback',
        depot: depotStart,
        returnLeg: fallback.returnLeg,
      }
    }
  }

  await setRedisData(cacheKey, result, CACHE_TTL_SECONDS)
  return result
}

/**
 * Router-facing resolution for `dispatch.getRouteGeometry`: resolves the worker, its route
 * depot, and its day's stops ordered by `routeOrder` (nulls last) from the DB, then delegates
 * to {@link getRouteLegs}. Ungeocoded stops (`latitude`/`longitude` null) are dropped from the
 * waypoint list — no leg can be drawn to/from a point with no coordinates. The depot start/end
 * waypoints are the SAME resolved home point, gated independently by the worker's
 * `routeStartAtHome`/`routeEndAtHome` switches (`worker.homeBase` stays the documented future
 * per-worker seam, unread here — decision #6).
 */
export async function getRouteGeometryForWorker(
  organizationId: string,
  assigneeUserId: string,
  window: PlannerDayWindow
): Promise<RouteGeometry> {
  const worker = (await listDispatchWorkers(organizationId)).find(
    (w) => w.userId === assigneeUserId
  )
  if (!worker) throw new NotFoundError('Dispatch worker not found')

  const homePoint = await resolveRouteStart(organizationId, worker)
  const depotStart = worker.routeStartAtHome ? homePoint : null
  const depotEnd = worker.routeEndAtHome ? homePoint : null
  const { from, to, dateKey } = window

  const rows = await database
    .select()
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        eq(schema.WorkOrderVisit.assigneeUserId, assigneeUserId),
        gte(schema.WorkOrderVisit.startTime, from),
        lte(schema.WorkOrderVisit.startTime, to)
      )
    )
    .orderBy(sql`${schema.WorkOrderVisit.routeOrder} ASC NULLS LAST`)

  const orderedStops: RouteStop[] = rows
    .filter((r) => r.latitude !== null && r.longitude !== null)
    .map((r) => ({ visitId: r.id, lat: r.latitude as number, lng: r.longitude as number }))

  return getRouteLegs(organizationId, assigneeUserId, dateKey, depotStart, depotEnd, orderedStops)
}
