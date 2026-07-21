// packages/lib/src/geocoding/index.ts
//
// Server entrypoint for address geocoding (MapTiler, env-gated). Distinct from `../geo/`
// (IP-based visitor geolocation) — see geocoder.ts's file comment.

export type { AddressNormalizedListener, NormalizedAddressStruct } from './address-normalize-hook'
export {
  normalizeAddressOnChange,
  registerAddressNormalizedListener,
} from './address-normalize-hook'
export { geocode, geocodeStructured, setGeocodeFetcherForTesting } from './geocoder'
export type { GeocodeComponents, GeocodeResult, GeocodeStructuredResult } from './types'
