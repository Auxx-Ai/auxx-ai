// packages/lib/src/geocoding/types.ts

/** A geocoded latitude/longitude pair. */
export interface GeocodeResult {
  lat: number
  lng: number
}

/** Structured address components MapTiler resolved for a geocoded feature (best-effort — any
 * of these may be absent depending on what MapTiler's `context[]` returned). `street1` is
 * informational only: callers implementing the address-field merge policy (plans/address-field
 * §5 decision #11) must never use it to overwrite a struct's `street1`/`street2` — the geocoder
 * owns locality (city/state/zip/country), not the street line. */
export interface GeocodeComponents {
  street1?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

/** Structured geocode response — same env-gating/timeout/null contract as {@link GeocodeResult}. */
export interface GeocodeStructuredResult {
  lat: number
  lng: number
  components: GeocodeComponents
  placeName: string
  relevance: number
}
