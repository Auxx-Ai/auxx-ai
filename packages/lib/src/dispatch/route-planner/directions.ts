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
import type { LatLng, PlannerDayWindow, RouteGeometry, RouteLeg, RouteStop } from './types'

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

function hashRouteInput(depot: LatLng | null, stops: RouteStop[]): string {
  const input = { depot, stops: stops.map((s) => ({ visitId: s.visitId, lat: s.lat, lng: s.lng })) }
  return createHash('sha1')
    .update(JSON.stringify(sortKeysDeep(input)))
    .digest('hex')
}

/** Straight-line fallback legs (contract item 1): two-point geometry, haversine ETA @ 40km/h. */
function fallbackLegs(depot: LatLng | null, orderedStops: RouteStop[]): RouteLeg[] {
  const legs: RouteLeg[] = []
  let prev: LatLng | null = depot
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
  return legs
}

interface MapboxDirectionsResponse {
  routes?: {
    legs?: { duration: number }[]
    geometry?: { coordinates: [number, number][] }
  }[]
}

/** Mapbox `driving-traffic` legs, or `null` on any failure/missing token (never throws). */
async function fetchMapboxLegs(
  depot: LatLng | null,
  orderedStops: RouteStop[]
): Promise<RouteLeg[] | null> {
  const token = process.env.MAPBOX_ACCESS_TOKEN
  if (!token) return null

  const waypoints: LatLng[] = depot ? [depot, ...orderedStops] : orderedStops
  if (waypoints.length < 2) return null

  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';')
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
    // per worker; subsequent legs carry an empty geometry array.
    const fullGeometry = route.geometry?.coordinates ?? []
    return route.legs.map((leg, i) => {
      const targetStop = depot ? orderedStops[i] : orderedStops[i + 1]
      return {
        toVisitId: targetStop!.visitId,
        seconds: Math.round(leg.duration),
        geometry: i === 0 ? fullGeometry : [],
      }
    })
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
 * sorted-key JSON of `{ depot, stops }`. 24h TTL, no invalidation — any reorder/reassign
 * changes the hash, so the key itself rotates and stale keys just expire unread.
 */
export async function getRouteLegs(
  organizationId: string,
  assigneeUserId: string,
  dateKey: string,
  depot: LatLng | null,
  orderedStops: RouteStop[]
): Promise<RouteGeometry> {
  const hash = hashRouteInput(depot, orderedStops)
  const cacheKey = `dispatch:route:${organizationId}:${assigneeUserId}:${dateKey}:${hash}`

  const cached = (await getRedisData(cacheKey)) as RouteGeometry | null
  if (cached) return cached

  let result: RouteGeometry
  if (orderedStops.length === 0) {
    result = { legs: [], source: 'fallback', depot }
  } else {
    const mapboxLegs = await fetchMapboxLegs(depot, orderedStops)
    result = mapboxLegs
      ? { legs: mapboxLegs, source: 'mapbox', depot }
      : { legs: fallbackLegs(depot, orderedStops), source: 'fallback', depot }
  }

  await setRedisData(cacheKey, result, CACHE_TTL_SECONDS)
  return result
}

/**
 * Router-facing resolution for `dispatch.getRouteGeometry`: resolves the worker, its route
 * depot, and its day's stops ordered by `routeOrder` (nulls last) from the DB, then delegates
 * to {@link getRouteLegs}. Ungeocoded stops (`latitude`/`longitude` null) are dropped from the
 * waypoint list — no leg can be drawn to/from a point with no coordinates.
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

  const depot = await resolveRouteStart(organizationId, worker)
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

  return getRouteLegs(organizationId, assigneeUserId, dateKey, depot, orderedStops)
}
