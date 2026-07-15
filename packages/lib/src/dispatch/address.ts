// packages/lib/src/dispatch/address.ts
//
// Shared `AddressStruct` JSON formatters for the dispatch surfaces. Two renderings off one
// part-extraction core: `formatAddress` (comma-joined display, null when empty — worker
// notifications, digest, visit detail) and `formatAddressForGeocode` (flat geocoder input
// string). Kept in a leaf module so both `my-schedule.ts`/`notify.ts` (display) and
// `visit-hooks.ts` (geocode) share one source without a circular import.

/** Ordered address parts, empty strings dropped by the caller. */
function addressParts(value: Record<string, unknown>): {
  street1: string
  street2: string
  city: string
  state: string
  zipCode: string
  country: string
} {
  const part = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '')
  return {
    street1: part('street1'),
    street2: part('street2'),
    city: part('city'),
    state: part('state'),
    zipCode: part('zipCode'),
    country: part('country'),
  }
}

/**
 * Single-line rendering of an `AddressStruct` JSON value for display — null when every part is
 * empty. Used by `notify.ts`/`digest.ts`/`my-schedule.ts` (worker-facing notifications, plan 19
 * §4.9).
 */
export function formatAddress(value: Record<string, unknown>): string | null {
  const p = addressParts(value)
  const line1 = [p.street1, p.street2].filter(Boolean).join(' ')
  const line2 = [p.city, p.state, p.zipCode].filter(Boolean).join(', ')
  const parts = [line1, line2, p.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/** Flat join of an `AddressStruct` JSON value — geocoder input, not a display formatter. */
export function formatAddressForGeocode(value: Record<string, unknown>): string {
  const p = addressParts(value)
  return [p.street1, p.street2, p.city, p.state, p.zipCode, p.country].filter(Boolean).join(', ')
}
