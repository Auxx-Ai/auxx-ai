// apps/web/src/components/dispatch/ui/route-planner/suggest-order.ts
//
// Client-side duplicate of the suggest-route heuristic (plans/dispatch/09-route-planner.md §D,
// build contract item 6) — `@auxx/lib/dispatch` has no `/client` export subpath (server-only
// deps: drizzle, redis), so the pure NN+2-opt function is ported here rather than imported. This
// mirrors the `board/types.ts` `VisitStatus` duplication precedent. Faithful port of
// `packages/lib/src/dispatch/route-planner/suggest.ts` — keep the two in sync if the heuristic
// changes; do not import the server module from client code (CLAUDE.md client-import rule).

const EARTH_RADIUS_METERS = 6_371_000
const MAX_2OPT_PASSES = 30

/** A latitude/longitude point. */
export interface LatLng {
  lat: number
  lng: number
}

/** A geocoded stop candidate — coordinates may be null (ungeocoded). */
export interface SuggestStopInput {
  visitId: string
  lat: number | null
  lng: number | null
}

interface RouteStop {
  visitId: string
  lat: number
  lng: number
}

/** Great-circle distance in meters between two points (haversine — no road network/traffic). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

function totalDistance(depot: LatLng | null, order: RouteStop[]): number {
  let total = 0
  let prev: LatLng | null = depot
  for (const stop of order) {
    if (prev) total += haversineMeters(prev, stop)
    prev = stop
  }
  return total
}

/**
 * Suggest a stop order for one worker's day (contract item 6, design doc §D): nearest-neighbor
 * seed from the depot (or the first geocoded stop when there's no depot), then 2-opt local
 * search over haversine distance until no improving swap remains (capped at
 * `MAX_2OPT_PASSES` passes). Deterministic for a given input. Stops with null coordinates
 * (ungeocoded) are excluded from the heuristic and appended, in their original relative order,
 * at the end of the returned list.
 */
export function suggestRouteOrder(depot: LatLng | null, stops: SuggestStopInput[]): string[] {
  const geocoded: RouteStop[] = []
  const ungeocoded: string[] = []
  for (const stop of stops) {
    if (stop.lat === null || stop.lng === null) {
      ungeocoded.push(stop.visitId)
    } else {
      geocoded.push({ visitId: stop.visitId, lat: stop.lat, lng: stop.lng })
    }
  }

  if (geocoded.length <= 1) {
    return [...geocoded.map((s) => s.visitId), ...ungeocoded]
  }

  // Nearest-neighbor seed.
  const remaining = [...geocoded]
  const order: RouteStop[] = []
  let anchor: LatLng | null = depot
  if (!anchor) {
    // No depot — seed from the first stop (design doc §D).
    const first = remaining.shift()
    if (first) {
      order.push(first)
      anchor = first
    }
  }
  while (remaining.length > 0 && anchor) {
    let bestIndex = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(anchor, remaining[i]!)
      if (d < bestDist) {
        bestDist = d
        bestIndex = i
      }
    }
    const [next] = remaining.splice(bestIndex, 1)
    order.push(next!)
    anchor = next!
  }

  // 2-opt local search: reverse the segment [i, j] whenever it shortens the total route.
  let improved = true
  let passes = 0
  let current = order
  while (improved && passes < MAX_2OPT_PASSES) {
    improved = false
    passes++
    const currentTotal = totalDistance(depot, current)
    let bestOrder = current
    let bestTotal = currentTotal
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const reversed = [
          ...current.slice(0, i),
          ...current.slice(i, j + 1).reverse(),
          ...current.slice(j + 1),
        ]
        const total = totalDistance(depot, reversed)
        if (total < bestTotal - 1e-6) {
          bestOrder = reversed
          bestTotal = total
        }
      }
    }
    if (bestTotal < currentTotal - 1e-6) {
      current = bestOrder
      improved = true
    }
  }

  return [...current.map((s) => s.visitId), ...ungeocoded]
}
