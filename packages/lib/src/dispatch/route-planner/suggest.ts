// packages/lib/src/dispatch/route-planner/suggest.ts
//
// Suggest-route heuristic (plans/dispatch/09-route-planner.md §D, build contract item 6). Pure
// function, no I/O — nearest-neighbor seed + 2-opt local search over haversine distance, capped
// at `MAX_2OPT_PASSES` passes. Swappable later behind this same `(depot, stops) => visitId[]`
// contract (design doc §D's "future engine seam" — VROOM/Google Routes could replace the body
// without touching callers).

import type { LatLng, RouteStop } from './types'

const EARTH_RADIUS_METERS = 6_371_000
const MAX_2OPT_PASSES = 30

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

/** A stop candidate for suggestion — coordinates may be null (ungeocoded). */
export interface SuggestStopInput {
  visitId: string
  lat: number | null
  lng: number | null
}

/**
 * Suggest a stop order for one worker's day (contract item 6, design doc §D): nearest-neighbor
 * seed from the depot (or the first geocoded stop when there's no depot), then 2-opt local
 * search over haversine distance until no improving swap remains. Deterministic for a given
 * input. Stops with null coordinates (ungeocoded) are excluded from the heuristic and appended,
 * in their original relative order, at the end of the returned list.
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
  let order: RouteStop[] = []
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
  while (improved && passes < MAX_2OPT_PASSES) {
    improved = false
    passes++
    const currentTotal = totalDistance(depot, order)
    let bestOrder = order
    let bestTotal = currentTotal
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const reversed = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ]
        const total = totalDistance(depot, reversed)
        if (total < bestTotal - 1e-6) {
          bestOrder = reversed
          bestTotal = total
        }
      }
    }
    if (bestTotal < currentTotal - 1e-6) {
      order = bestOrder
      improved = true
    }
  }

  return [...order.map((s) => s.visitId), ...ungeocoded]
}
