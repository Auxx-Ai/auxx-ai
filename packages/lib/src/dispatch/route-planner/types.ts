// packages/lib/src/dispatch/route-planner/types.ts
//
// Shared shapes for the route planner (plans/dispatch/09-route-planner.md, build contract's
// "New backend files" §types.ts).

import type { schema } from '@auxx/database'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** A latitude/longitude point. */
export interface LatLng {
  lat: number
  lng: number
}

/**
 * One local day, resolved by the CLIENT — the planner follows `dispatch.getBoard`/
 * `listMyVisits`' convention of client-computed windows because the server is timezone-naive
 * (plain `date-fns`, no `date-fns-tz`): `from`/`to` are the day's bounds in the dispatcher's
 * local timezone, `dateKey` its `yyyy-MM-dd` label (availability lookups + the Directions
 * cache key).
 */
export interface PlannerDayWindow {
  from: Date
  to: Date
  dateKey: string
}

/** A geocoded stop fed to the suggest heuristic / directions call — pure geo, no metadata. */
export interface RouteStop {
  visitId: string
  lat: number
  lng: number
}

/** One leg of a computed route — from the previous stop (or depot) to `toVisitId`. */
export interface RouteLeg {
  toVisitId: string
  /** Travel time for this leg, in seconds. */
  seconds: number
  /** `[lng, lat]` pairs (GeoJSON coordinate order). Two-point straight line when the parent
   * `RouteGeometry.source === 'fallback'`; the full road-network polyline from Mapbox otherwise. */
  geometry: [number, number][]
}

/** The last stop → depot leg, drawn only when the worker's `routeEndAtHome` switch is on. Kept
 * out of `legs` (no `toVisitId`) so ETA math keyed by `toVisitId` (`estimateArrivalForVisit`)
 * never sees it. */
export interface ReturnLeg {
  /** Travel time for the home-return leg, in seconds. */
  seconds: number
  /** `[lng, lat]` pairs — same geometry conventions as `RouteLeg.geometry`. */
  geometry: [number, number][]
}

/** Directions result for one worker's ordered stop list (contract items 1/2). */
export interface RouteGeometry {
  legs: RouteLeg[]
  /** `'mapbox'` = real driving-traffic geometry/ETA; `'fallback'` = straight-line + haversine
   * ETA (no `MAPBOX_ACCESS_TOKEN`) — the UI styles fallback legs dashed. */
  source: 'mapbox' | 'fallback'
  /** Route-start depot point, or `null` when `routeStartAtHome` is off (or the org has no
   * business address). */
  depot: LatLng | null
  /** Route-end (return) leg, or `null` when `routeEndAtHome` is off, there's no depot, or the
   * route has no stops. */
  returnLeg: ReturnLeg | null
}

/** Slim work-order projection for the planner's visible visit set — `board.ts`'s
 * `BoardWorkOrder` extended with tags + a display address string. */
export interface PlannerWorkOrder {
  id: string
  displayName: string | null
  number: string | null
  status: string | null
  contactDisplayName: string | null
  tags: string[]
  addressText: string | null
}

/** One worker row on the planner board. */
export interface PlannerWorker {
  id: string
  userId: string
  color: string | null
  name: string | null
  email: string | null
  image: string | null
  /** Worker's availability day-start for the requested date (`resolveAvailability`, org-hours
   * fallback) — the Apply-times dialog's default first-departure time, `HH:mm` 24h local clock
   * string. `null` when the worker/org has no availability that day. */
  availabilityStart: string | null
}

/** `getRoutePlannerBoard` result (contract's `planner-board.ts`). */
export interface PlannerBoardResult {
  workers: PlannerWorker[]
  /** That day's visits — assigned + unassigned, carrying `routeOrder`/`latitude`/`longitude`. */
  visits: WorkOrderVisitRow[]
  /** Unscheduled backlog (`startTime IS NULL AND status = 'scheduled'`) — never day-filtered. */
  backlog: WorkOrderVisitRow[]
  workOrders: PlannerWorkOrder[]
  /** Org depot (business address geocode), resolved once per call — `null` with no business
   * address. Map default-center + home-marker source; independent of the per-worker route
   * start/end switches. */
  depot: LatLng | null
}
