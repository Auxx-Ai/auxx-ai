// packages/lib/src/geocoding/index.ts
//
// Server entrypoint for address geocoding (MapTiler, env-gated). Distinct from `../geo/`
// (IP-based visitor geolocation) — see geocoder.ts's file comment.

export { geocode, setGeocodeFetcherForTesting } from './geocoder'
export type { GeocodeResult } from './types'
