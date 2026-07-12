// packages/lib/src/geocoding/geocoder.ts
//
// MapTiler Geocoding provider (plans/dispatch/09-route-planner.md §3.7, route-planner build
// contract item 1) — env-gated, graceful fallback. Absent `MAPTILER_API_KEY` → `geocode()`
// resolves `null` (the visit stays unpinned); never throws. Distinct from `../geo/` (IP
// geolocation) — do not confuse the two modules.

import { createScopedLogger } from '@auxx/logger'
import type { GeocodeResult } from './types'

const logger = createScopedLogger('geocoding')

const MAPTILER_GEOCODING_URL = 'https://api.maptiler.com/geocoding'
const REQUEST_TIMEOUT_MS = 5_000

type FetchLike = typeof fetch

/** Test-only override for the underlying `fetch` call — see {@link setGeocodeFetcherForTesting}. */
let fetchOverride: FetchLike | undefined

/**
 * Test-injection seam: override the `fetch` implementation `geocode()` uses, so verification
 * scripts / unit tests can stub the MapTiler response without a real API key or network call.
 * Call with `undefined` to restore the real global `fetch`. Never used by production code.
 */
export function setGeocodeFetcherForTesting(fetcher: FetchLike | undefined): void {
  fetchOverride = fetcher
}

interface MapTilerFeature {
  /** `[lng, lat]` — MapTiler's GeoJSON-style center point. */
  center?: [number, number]
}

interface MapTilerGeocodingResponse {
  features?: MapTilerFeature[]
}

/**
 * Geocode a free-form address string via the MapTiler Geocoding API, behind `MAPTILER_API_KEY`.
 * Picks the first feature's center. Returns `null` — never throws — when the key is absent,
 * the address is empty, the request errors, times out (~5s), or no feature is returned;
 * callers treat `null` as "leave the pin unset."
 */
export async function geocode(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim()
  const apiKey = process.env.MAPTILER_API_KEY
  if (!apiKey || !trimmed) return null

  const fetchImpl = fetchOverride ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const url = `${MAPTILER_GEOCODING_URL}/${encodeURIComponent(trimmed)}.json?key=${apiKey}&limit=1`
    const res = await fetchImpl(url, { signal: controller.signal })
    if (!res.ok) return null

    const data = (await res.json()) as MapTilerGeocodingResponse
    const center = data.features?.[0]?.center
    if (!center || center.length !== 2) return null

    const [lng, lat] = center
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    return { lat, lng }
  } catch (error) {
    logger.warn('MapTiler geocode request failed', { error, address: trimmed })
    return null
  } finally {
    clearTimeout(timeout)
  }
}
