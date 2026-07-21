// packages/lib/src/geocoding/geocoder.ts
//
// MapTiler Geocoding provider (plans/dispatch/09-route-planner.md §3.7, route-planner build
// contract item 1) — env-gated, graceful fallback. Absent `MAPTILER_API_KEY` → `geocode()`
// resolves `null` (the visit stays unpinned); never throws. Distinct from `../geo/` (IP
// geolocation) — do not confuse the two modules.
//
// `geocodeStructured()` (plans/address-field/01-single-input-address-field.md §5 item 1) also
// parses MapTiler's structured `context[]` components (city/state/zip/country) instead of just
// the center point — `geocode()` delegates to it so every existing call site (dispatch
// visit-hooks, depot, route planner) keeps working unchanged.

import { createScopedLogger } from '@auxx/logger'
import type { GeocodeComponents, GeocodeResult, GeocodeStructuredResult } from './types'

const logger = createScopedLogger('geocoding')

const MAPTILER_GEOCODING_URL = 'https://api.maptiler.com/geocoding'
const REQUEST_TIMEOUT_MS = 5_000

type FetchLike = typeof fetch

/** Test-only override for the underlying `fetch` call — see {@link setGeocodeFetcherForTesting}. */
let fetchOverride: FetchLike | undefined

/**
 * Test-injection seam: override the `fetch` implementation `geocode()`/`geocodeStructured()` use,
 * so verification scripts / unit tests can stub the MapTiler response without a real API key or
 * network call. Call with `undefined` to restore the real global `fetch`. Never used by
 * production code.
 */
export function setGeocodeFetcherForTesting(fetcher: FetchLike | undefined): void {
  fetchOverride = fetcher
}

interface MapTilerContextEntry {
  /** e.g. `"postal_code.123"`, `"place.456"`, `"region.789"`, `"country.US"` — matched by prefix. */
  id?: string
  text?: string
  /** Present on `region.`/`country.` entries — e.g. `"US-TX"` (region) or `"us"` (country). */
  short_code?: string
}

interface MapTilerFeature {
  /** `[lng, lat]` — MapTiler's GeoJSON-style center point. */
  center?: [number, number]
  /** Full formatted address/place name. */
  place_name?: string
  /** Primary feature name (street name for address-type features). */
  text?: string
  /** House number, present on `address`-type features alongside `text`. */
  address?: string
  /** Match confidence, 0..1. */
  relevance?: number
  context?: MapTilerContextEntry[]
}

interface MapTilerGeocodingResponse {
  features?: MapTilerFeature[]
}

function findContext(
  context: MapTilerContextEntry[] | undefined,
  prefix: string
): MapTilerContextEntry | undefined {
  return context?.find((c) => c.id?.startsWith(prefix))
}

/** US region `short_code` is formatted `"US-TX"` — take the segment after the dash, uppercased. */
function shortCodeSuffix(shortCode: string): string {
  const parts = shortCode.split('-')
  return (parts[parts.length - 1] ?? shortCode).toUpperCase()
}

/**
 * Parse MapTiler's `context[]` into the struct's flat component shape. `street1` is derived from
 * `address` + `text` (house number + street name) — informational only, see
 * {@link GeocodeComponents}. Country short_codes are normalized to ISO alpha-2 uppercase; a US
 * region short_code (`"US-TX"`) is normalized to its 2-letter abbreviation.
 */
function parseComponents(feature: MapTilerFeature): GeocodeComponents {
  const postal = findContext(feature.context, 'postal_code.')
  const place = findContext(feature.context, 'place.')
  const region = findContext(feature.context, 'region.')
  const country = findContext(feature.context, 'country.')

  const street1 = feature.address ? `${feature.address} ${feature.text ?? ''}`.trim() : feature.text

  const state = region?.short_code ? shortCodeSuffix(region.short_code) : region?.text

  return {
    street1: street1 || undefined,
    city: place?.text,
    state,
    zipCode: postal?.text,
    country: country?.short_code?.toUpperCase() ?? country?.text,
  }
}

/**
 * Geocode a free-form address string via the MapTiler Geocoding API, behind `MAPTILER_API_KEY`,
 * returning MapTiler's structured components alongside the center point (plans/address-field
 * §5 item 1). Picks the first (best-ranked, `limit=1`) feature. Returns `null` — never throws —
 * when the key is absent, the address is empty, the request errors, times out (~5s), or no
 * feature is returned.
 */
export async function geocodeStructured(address: string): Promise<GeocodeStructuredResult | null> {
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
    const feature = data.features?.[0]
    const center = feature?.center
    if (!feature || !center || center.length !== 2) return null

    const [lng, lat] = center
    if (typeof lat !== 'number' || typeof lng !== 'number') return null

    return {
      lat,
      lng,
      components: parseComponents(feature),
      placeName: feature.place_name ?? '',
      relevance: typeof feature.relevance === 'number' ? feature.relevance : 1,
    }
  } catch (error) {
    logger.warn('MapTiler geocode request failed', { error, address: trimmed })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Geocode a free-form address string via the MapTiler Geocoding API, behind `MAPTILER_API_KEY`.
 * Picks the first feature's center. Returns `null` — never throws — when the key is absent,
 * the address is empty, the request errors, times out (~5s), or no feature is returned;
 * callers treat `null` as "leave the pin unset." Delegates to {@link geocodeStructured} so
 * existing call sites (dispatch visit-hooks, depot, route planner) are unaffected by the
 * structured-response addition.
 */
export async function geocode(address: string): Promise<GeocodeResult | null> {
  const result = await geocodeStructured(address)
  return result ? { lat: result.lat, lng: result.lng } : null
}
